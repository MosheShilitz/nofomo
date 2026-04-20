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

  // מקסימום 2 מכל source_id, סך הכל 5
  const seenSources = new Map<string, number>()
  const rawArticles = candidates.filter((a) => {
    const count = seenSources.get(a.source_id) ?? 0
    if (count >= 2) return false
    seenSources.set(a.source_id, count + 1)
    return true
  }).slice(0, 5)

  const results = { processed: 0, errors: [] as string[] }

  for (const raw of rawArticles) {
    try {
      // נתח עם Claude
      const analysis = await analyzeArticle(
        raw.title_en,
        raw.content_raw,
        raw.original_url
      )

      // חשב Signal Score (בסיסי — מקור אחד, ללא cross-ref עדיין)
      const source = getSourceById(raw.source_id)
      const signalScore = calcSignalScore({
        sourceCount: 1,
        isFirstTier1: source?.tier === 1,
        socialScore: 0,
        expertReactions: 0,
        velocityMinutes: 999,
        impactScore: analysis.impact_score,
      })
      const signalLabel = getSignalLabel(signalScore)

      // שמור article מנותח
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
          approval_status: "pending",
        })
        .select()
        .single()

      if (insertError || !article) {
        results.errors.push(`insert: ${insertError?.message}`)
        continue
      }

      // סמן raw כ-processed
      await supabaseAdmin
        .from("raw_articles")
        .update({ processed: true })
        .eq("id", raw.id)

      // שלח לאישור ב-Telegram
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
        source_display_name: source?.credit.display_name ?? raw.source_id,
        cross_refs_count: 0,
        first_source: source?.credit.display_name,
      })

      // שמור approval queue entry
      await supabaseAdmin.from("approval_queue").insert({
        article_id: article.id,
        status: "pending",
        telegram_message_id: msgId ?? null,
        sent_at: new Date().toISOString(),
      })

      results.processed++
    } catch (err) {
      results.errors.push(`article ${raw.id}: ${String(err)}`)
      // סמן כ-processed בכל מקרה כדי לא לתקוע את התור
      await supabaseAdmin
        .from("raw_articles")
        .update({ processed: true })
        .eq("id", raw.id)
    }
  }

  return NextResponse.json(results)
}
