/**
 * GET /api/articles
 * מחזיר את כל הידיעות המאושרות — לארכיון, חיפוש, ושאילתות
 *
 * Query params:
 *   ?limit=50        (ברירת מחדל: 50, מקסימום: 200)
 *   ?category=LLMs   (סינון לפי קטגוריה)
 *   ?from=2026-04-01 (מתאריך)
 *   ?format=csv      (פורמט CSV במקום JSON)
 */

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200)
  const category = searchParams.get("category")
  const from = searchParams.get("from")
  const format = searchParams.get("format")

  let query = supabaseAdmin
    .from("articles")
    .select("id, title_he, title_en, what_happened, why_matters, summary_he, category, signal_score, signal_label, impact_score, who_affected, use_cases, source_id, original_url, published_at, approval_status, created_at")
    .eq("approval_status", "approved")
    .order("published_at", { ascending: false })
    .limit(limit)

  if (category) query = query.eq("category", category)
  if (from) query = query.gte("published_at", from)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (format === "csv") {
    const headers = ["id", "title_he", "title_en", "category", "signal_score", "impact_score", "source_id", "original_url", "published_at"]
    const rows = (data ?? []).map((a) =>
      headers.map((h) => `"${String((a as Record<string, unknown>)[h] ?? "").replace(/"/g, '""')}"`).join(",")
    )
    const csv = [headers.join(","), ...rows].join("\n")
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nofomo-articles-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  return NextResponse.json({ count: data?.length ?? 0, articles: data ?? [] })
}
