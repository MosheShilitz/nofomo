/**
 * POST /api/ingest
 * רץ כל שעה (Vercel Cron) — אוסף RSS feeds ושומר ב-DB
 *
 * Authorization: Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server"
import Parser from "rss-parser"
import { supabaseAdmin } from "@/lib/supabase"
import { getIngestionSources, PREPRINT_SOURCE_IDS } from "@/lib/sources"

const parser = new Parser({
  customFields: {
    item: ["summary", "content:encoded", "description"],
  },
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; NoFomoBot/1.0; +https://no-fomo.ai)",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
  },
  timeout: 10000,
})

export async function POST(req: NextRequest) {
  // בדוק authorization
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sources = getIngestionSources()
  const results = { fetched: 0, saved: 0, skipped: 0, errors: [] as string[] }

  for (const source of sources) {
    if (!source.rss) continue

    try {
      const feed = await parser.parseURL(source.rss)

      // הגבל לפי סוג מקור: preprint=2, tier2=5, שאר=10
      const itemLimit = PREPRINT_SOURCE_IDS.has(source.id) ? 2
        : source.tier === 2 ? 5
        : 10
      for (const item of feed.items.slice(0, itemLimit)) {
        if (!item.link || !item.title) continue
        results.fetched++

        // בדוק אם כבר קיים
        const { data: existing } = await supabaseAdmin
          .from("raw_articles")
          .select("id")
          .eq("original_url", item.link)
          .single()

        if (existing) {
          results.skipped++
          continue
        }

        const content =
          (item as { "content:encoded"?: string })["content:encoded"] ||
          item.content ||
          item.summary ||
          item.contentSnippet ||
          ""

        // שמור raw article לתור עיבוד
        const { error } = await supabaseAdmin.from("raw_articles").insert({
          source_id: source.id,
          original_url: item.link,
          title_en: item.title,
          content_raw: content.slice(0, 5000),
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          processed: false,
        })

        if (error) {
          results.errors.push(`${source.id}: ${error.message}`)
        } else {
          results.saved++
        }
      }
    } catch (err) {
      results.errors.push(`${source.id}: ${String(err)}`)
    }
  }

  return NextResponse.json(results)
}
