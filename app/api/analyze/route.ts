/**
 * POST /api/analyze
 * לוקח raw articles לא מעובדים, מנתח עם Claude, שולח לתור אישור
 */

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { analyzeArticle } from "@/lib/claude"
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

  // מקסימום 2 מכל source_id, נבחר 12 לניתוח
  const seenSources = new Map<string, number>()
  const rawArticles = candidates.filter((a) => {
    const count = seenSources.get(a.source_id) ?? 0
    if (count >= 2) return false
    seenSources.set(a.source_id, count + 1)
    return true
  }).slice(0, 12)

  // שלב א: נתח את כולם עם Claude
  const analyzed: Array<{
    raw: typeof rawArticles[0]
    analysis: Awaited<ReturnType<typeof analyzeArticle>>
    signalScore: number
    signalLabel: ReturnType<typeof getSignalLabel>
    source: ReturnType<typeof getSourceById>
  }> = []

  const results = { processed: 0, sent_to_approval: 0, errors: [] as string[] }

  for (const raw of rawArticles) {
    try {
      const analysis = await analyzeArticle(raw.title_en, raw.content_raw, raw.original_url)
      const source = getSourceById(raw.source_id)
      const signalScore = calcSignalScore({
        sourceCount: 1,
        isFirstTier1: source?.tier === 1,
        socialScore: 0,
        expertReactions: 0,
        velocityMinutes: 999,
        impactScore: analysis.impact_score,
      })
      analyzed.push({ raw, analysis, signalScore, signalLabel: getSignalLabel(signalScore), source })
    } catch (err) {
      results.errors.push(`analyze ${raw.id}: ${String(err)}`)
      await supabaseAdmin.from("raw_articles").update({ processed: true }).eq("id", raw.id)
    }
  }

  // שלב ב: מיין לפי signal score — שלח רק Top 5 לאישור
  const sorted = analyzed.sort((a, b) => b.signalScore - a.signalScore)
  const topFive = new Set(sorted.slice(0, 5).map((a) => a.raw.id))

  for (const { raw, analysis, signalScore, signalLabel, source } of analyzed) {
    const sendToTelegram = topFive.has(raw.id)

    try {
      const { data: article, error: insertError } = await supabaseAdmin
        .from("articles")
        .insert({
          source_id: raw.source_id,
          original_url: raw.original_url,
          title_en: raw.title_en,
          title_he: analysis.title_he,
          summary_he: analysis.summary_he,
          what_happened: analysis.what_happened,
          why_matters: analysis.why_matters,
          who_affected: analysis.who_affected,
          use_cases: analysis.use_cases,
          impact_score: analysis.impact_score,
          signal_score: signalScore,
          signal_label: signalLabel,
          category: analysis.category,
          published_at: raw.published_at,
          approval_status: sendToTelegram ? "pending" : "skipped",
        })
        .select()
        .single()

      if (insertError || !article) {
        results.errors.push(`insert: ${insertError?.message}`)
        continue
      }

      await supabaseAdmin.from("raw_articles").update({ processed: true }).eq("id", raw.id)
      results.processed++

      if (!sendToTelegram) continue

      // שלח רק Top 5 לאישור בטלגרם
      const msgId = await sendApprovalMessage({
        is_preprint: isPreprint(raw.source_id),
        id: article.id,
        title_he: analysis.title_he,
        bottom_line: analysis.bottom_line,
        what_happened: analysis.what_happened,
        why_matters: analysis.why_matters,
        the_problem: analysis.the_problem,
        the_solution: analysis.the_solution,
        who_affected: analysis.who_affected,
        use_cases: analysis.use_cases,
        impact_score: analysis.impact_score,
        signal_score: signalScore,
        signal_label: signalLabel,
        category: analysis.category,
        original_url: raw.original_url,
        published_at: raw.published_at,
        source_display_name: source?.credit.display_name ?? raw.source_id,
        cross_refs_count: 0,
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

  return NextResponse.json(results)
}
