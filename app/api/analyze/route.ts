/**
 * POST /api/analyze
 * Two-stage pipeline:
 *   Stage 1 — analyzeBatch(): lean triage, Claude scores every item by anti-hype signal
 *   Stage 2 — extractStoryDetails(): parallel full Hebrew extraction on items above the threshold
 */

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { analyzeBatch, extractStoryDetails } from "@/lib/claude"
import { calcSignalScore, getSignalLabel } from "@/lib/signal"
import { sendApprovalMessage } from "@/lib/telegram"
import { getSourceById, isPreprint } from "@/lib/sources"
import { isQuietHours } from "@/lib/calendar"

export async function POST(req: NextRequest) {
  try {
    return await handlePost(req)
  } catch (err) {
    // Last-resort guard so 500s always carry a diagnostic body instead of opaque
    // "Internal Server Error". Without this, exceptions thrown before the route's
    // own try blocks (e.g. Supabase network failure) surface as bodyless 500s.
    const stack = err instanceof Error ? err.stack : undefined
    return NextResponse.json(
      { error: String(err), stack: stack?.split("\n").slice(0, 5).join("\n") },
      { status: 500 }
    )
  }
}

async function handlePost(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // שעות שקטות (23:00-06:00 IL)
  if (isQuietHours()) {
    return NextResponse.json({ skipped: "quiet_hours" })
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

  // ─── Dynamic top-N — לפי signal_score, לא מספר קבוע ─────────────────────────
  // יום שקט = 1-2 ידיעות. יום בועט (conference release) = עד 8.
  // Threshold גבוה = breaking/major בלבד; אם backlog דליל, נחזור לערך נמוך יותר.
  const PRIMARY_THRESHOLD = 55
  const FALLBACK_THRESHOLD = 35
  const MIN_ITEMS = 1
  const MAX_ITEMS = 8

  const sorted = [...batchResults].sort((a, b) => b.signal_score - a.signal_score)
  let chosen = sorted.filter((r) => r.signal_score >= PRIMARY_THRESHOLD)
  if (chosen.length < MIN_ITEMS) {
    chosen = sorted.filter((r) => r.signal_score >= FALLBACK_THRESHOLD).slice(0, MIN_ITEMS)
  }
  chosen = chosen.slice(0, MAX_ITEMS)

  const topPicks = chosen
    .map((result) => ({ batchResult: result, raw: urlToRaw.get(result.url) }))
    .filter(
      (item): item is { batchResult: typeof batchResults[0]; raw: NonNullable<typeof rawArticles[0]> } =>
        item.raw !== undefined
    )

  // כל ה-URLs שנבחרו לעיבוד מלא
  const topUrls = new Set(topPicks.map((item) => item.batchResult.url))

  // ─── שלב 2: Detail Extraction (מקביל) ────────────────────────────────────
  // extractStoryDetails רץ במקביל על כל 5 הידיעות הנבחרות

  const detailResults = await Promise.allSettled(
    topPicks.map(async ({ batchResult, raw }) => {
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

  // Persist + notify in parallel across picks. Sequential before this change
  // meant 4 picks × ~3-5s each (DB + Telegram) ≈ 15-20s. Within a single pick the
  // ordering still matters: article insert → telegram → approval_queue insert.
  await Promise.allSettled(
    detailResults.map(async (settled) => {
      if (settled.status === "rejected") {
        results.errors.push(`extractStoryDetails failed: ${String(settled.reason)}`)
        return
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
          results.errors.push(`insert topPicks: ${insertError?.message}`)
          return
        }

        // Bulk-update raw_articles in one query: the pick itself + any merged URLs.
        const processedIds = [
          raw.id,
          ...(batchResult.merged_urls ?? [])
            .map((u) => urlToRaw.get(u)?.id)
            .filter((id): id is number => id !== undefined),
        ]
        await supabaseAdmin
          .from("raw_articles")
          .update({ processed: true })
          .in("id", processedIds)

        results.processed++

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
    })
  )

  // סמן את כל השאר כ-skipped (לא עברו את ה-triage).
  // Bulk insert + bulk update — one round-trip each instead of 2×N. With ~11
  // skipped per run and ~100ms latency to Supabase, this saves ~2s per run.
  const skippedRaws = rawArticles.filter((a) => !topUrls.has(a.original_url))
  if (skippedRaws.length > 0) {
    const skippedRows = skippedRaws.map((raw) => ({
      source_id: raw.source_id,
      original_url: raw.original_url,
      title_en: raw.title_en,
      title_he: raw.title_en,
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
    }))
    await Promise.allSettled([
      supabaseAdmin.from("articles").insert(skippedRows),
      supabaseAdmin
        .from("raw_articles")
        .update({ processed: true })
        .in("id", skippedRaws.map((r) => r.id)),
    ])
  }

  return NextResponse.json(results)
}
