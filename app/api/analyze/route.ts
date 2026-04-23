/**
 * POST /api/analyze
 * Two-stage pipeline:
 *   Stage 1 — analyzeBatch(): lean triage, Claude picks top 5 by anti-hype signal
 *   Stage 2 — extractStoryDetails(): parallel full Hebrew extraction on the 5 winners
 */

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { analyzeBatch, extractStoryDetails } from "@/lib/claude"
import { calcSignalScore, getSignalLabel } from "@/lib/signal"
import { sendApprovalMessage } from "@/lib/telegram"
import { getSourceById, isPreprint } from "@/lib/sources"

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // מצא עד 30 articles לא מעובדים מ-48 השעות האחרונות
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data: candidates, error } = await supabaseAdmin
    .from("raw_articles")
    .select("*")
    .eq("processed", false)
    .gte("published_at", cutoff)
    .order("published_at", { ascending: false })
    .limit(30)

  if (error || !candidates?.length) {
    return NextResponse.json({ processed: 0 })
  }

  // מקסימום 2 מכל source_id, נבחר עד 15 לניתוח
  const seenSources = new Map<string, number>()
  const rawArticles = candidates.filter((a) => {
    const count = seenSources.get(a.source_id) ?? 0
    if (count >= 2) return false
    seenSources.set(a.source_id, count + 1)
    return true
  }).slice(0, 15)

  const results = { processed: 0, sent_to_approval: 0, errors: [] as string[] }

  // ─── שלב 1: Batch Triage ──────────────────────────────────────────────────
  // Claude בוחר Top 5 לפי anti-hype signal score — קריאה אחת מהירה

  let batchResults
  try {
    batchResults = await analyzeBatch(
      rawArticles.map((a) => ({
        url: a.original_url,
        title: a.title_en,
        content: a.content_raw,
        source_name: getSourceById(a.source_id)?.credit.display_name ?? a.source_id,
      }))
    )
  } catch (err) {
    return NextResponse.json({ error: `Batch triage failed: ${String(err)}`, processed: 0 }, { status: 500 })
  }

  if (!batchResults?.length) {
    return NextResponse.json({ processed: 0, message: "Batch returned empty" })
  }

  // בנה map מ-URL → raw article לאיתור מהיר
  const urlToRaw = new Map(rawArticles.map((a) => [a.original_url, a]))

  // Top 5 מה-batch — מותאמות ל-raw articles
  const top5 = batchResults.slice(0, 5).map((result) => ({
    batchResult: result,
    raw: urlToRaw.get(result.url),
  })).filter((item): item is { batchResult: typeof batchResults[0]; raw: NonNullable<typeof rawArticles[0]> } =>
    item.raw !== undefined
  )

  // כל ה-URLs שנבחרו ל-top5
  const topUrls = new Set(top5.map((item) => item.batchResult.url))

  // ─── שלב 2: Detail Extraction (מקביל) ────────────────────────────────────
  // extractStoryDetails רץ במקביל על כל 5 הידיעות הנבחרות

  const detailResults = await Promise.allSettled(
    top5.map(async ({ batchResult, raw }) => {
      const source = getSourceById(raw.source_id)
      const details = await extractStoryDetails(
        raw.title_en,
        raw.content_raw,
        raw.original_url,
        // אם Claude מיזג כמה URLs — נוסיף את התוכן שלהם כ-context
        batchResult.merged_urls
          ?.map((u) => urlToRaw.get(u)?.content_raw)
          .filter(Boolean)
          .join("\n\n---\n\n") || undefined
      )
      return { batchResult, raw, source, details }
    })
  )

  // ─── שמור ל-DB ו-Telegram ─────────────────────────────────────────────────

  // שמור top 5 (fulfilled)
  for (const settled of detailResults) {
    if (settled.status === "rejected") {
      results.errors.push(`extractStoryDetails failed: ${String(settled.reason)}`)
      continue
    }

    const { batchResult, raw, source, details } = settled.value

    const signalScore = calcSignalScore({
      sourceCount: 1 + (batchResult.merged_urls?.length ?? 0),
      isFirstTier1: source?.tier === 1,
      socialScore: 0,
      expertReactions: 0,
      velocityMinutes: 999,
      impactScore: details.impact_score,
    })
    const signalLabel = getSignalLabel(signalScore)

    try {
      const { data: article, error: insertError } = await supabaseAdmin
        .from("articles")
        .insert({
          source_id: raw.source_id,
          original_url: raw.original_url,
          title_en: raw.title_en,
          title_he: details.title_he,
          bottom_line: details.bottom_line,
          summary_he: details.summary_he,
          what_happened: details.what_happened,
          why_matters: details.why_matters,
          the_problem: details.the_problem,
          the_solution: details.the_solution,
          who_affected: details.who_affected,
          use_cases: details.use_cases,
          impact_score: details.impact_score,
          signal_score: signalScore,
          signal_label: signalLabel,
          category: details.category,
          published_at: raw.published_at,
          approval_status: "pending",
        })
        .select()
        .single()

      if (insertError || !article) {
        results.errors.push(`insert top5: ${insertError?.message}`)
        continue
      }

      await supabaseAdmin.from("raw_articles").update({ processed: true }).eq("id", raw.id)

      // Mark merged sources as processed too
      if (batchResult.merged_urls) {
        for (const mergedUrl of batchResult.merged_urls) {
          const mergedRaw = urlToRaw.get(mergedUrl)
          if (mergedRaw) {
            await supabaseAdmin.from("raw_articles").update({ processed: true }).eq("id", mergedRaw.id)
          }
        }
      }

      results.processed++

      // שלח לאישור בטלגרם
      const msgId = await sendApprovalMessage({
        is_preprint: isPreprint(raw.source_id),
        id: article.id,
        title_he: details.title_he,
        bottom_line: details.bottom_line,
        what_happened: details.what_happened,
        why_matters: details.why_matters,
        the_problem: details.the_problem,
        the_solution: details.the_solution,
        who_affected: details.who_affected,
        use_cases: details.use_cases,
        impact_score: details.impact_score,
        signal_score: signalScore,
        signal_label: signalLabel,
        category: details.category,
        original_url: raw.original_url,
        published_at: raw.published_at,
        source_display_name: source?.credit.display_name ?? raw.source_id,
        cross_refs_count: batchResult.merged_urls?.length ?? 0,
        first_source: source?.credit.display_name,
      })

      await supabaseAdmin.from("approval_queue").insert({
        article_id: article.id,
        status: "pending",
        telegram_message_id: msgId ?? null,
        sent_at: new Date().toISOString(),
      })

      results.sent_to_approval++
    } catch (err) {
      results.errors.push(`article ${raw.id}: ${String(err)}`)
      await supabaseAdmin.from("raw_articles").update({ processed: true }).eq("id", raw.id)
    }
  }

  // סמן את כל השאר כ-skipped (לא עברו את ה-triage)
  const skippedRaws = rawArticles.filter((a) => !topUrls.has(a.original_url))
  for (const raw of skippedRaws) {
    try {
      await supabaseAdmin
        .from("articles")
        .insert({
          source_id: raw.source_id,
          original_url: raw.original_url,
          title_en: raw.title_en,
          title_he: raw.title_en, // no Hebrew — skipped before extraction
          summary_he: "",
          what_happened: "",
          why_matters: "",
          who_affected: [],
          use_cases: [],
          impact_score: 1,
          signal_score: 0,
          signal_label: "normal",
          category: "tools",
          published_at: raw.published_at,
          approval_status: "skipped",
        })
        .select()
        .single()

      await supabaseAdmin.from("raw_articles").update({ processed: true }).eq("id", raw.id)
    } catch {
      // Silently skip — DB insert failures for skipped items are not critical
    }
  }

  return NextResponse.json(results)
}
