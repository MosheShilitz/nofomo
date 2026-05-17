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
import { isQuietHours } from "@/lib/calendar"
import { isAIRelated } from "@/lib/relevance"

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

  // שעות שקטות (23:00-06:00 IL) — אין קוראים, אין סיבה לבזבז
  if (isQuietHours()) {
    return NextResponse.json({ skipped: "quiet_hours" })
  }

  const sources = getIngestionSources()
  const results = { fetched: 0, saved: 0, skipped: 0, off_topic: 0, errors: [] as string[] }

  // Process each source in parallel. Without this, ingest is O(sources × feed_latency)
  // which easily exceeds cron-job.org's 30s timeout. With Promise.allSettled it's
  // bounded by the slowest single feed (~10s thanks to parser.timeout).
  await Promise.allSettled(
    sources.map(async (source) => {
      if (!source.rss) return

      try {
        const feed = await parser.parseURL(source.rss)

        // הגבל לפי סוג מקור: preprint=2, tier2=5, שאר=10
        const itemLimit = PREPRINT_SOURCE_IDS.has(source.id) ? 2
          : source.tier === 2 ? 5
          : 10

        const items = feed.items.slice(0, itemLimit).filter((i) => i.link && i.title)
        if (items.length === 0) return

        // Batch dedup: one query for the whole feed instead of N point lookups.
        const urls = items.map((i) => i.link as string)
        const { data: existingRows } = await supabaseAdmin
          .from("raw_articles")
          .select("original_url")
          .in("original_url", urls)
        const existingUrls = new Set((existingRows ?? []).map((r) => r.original_url))

        for (const item of items) {
          results.fetched++

          if (existingUrls.has(item.link as string)) {
            results.skipped++
            continue
          }

          const content =
            (item as { "content:encoded"?: string })["content:encoded"] ||
            item.content ||
            item.summary ||
            item.contentSnippet ||
            ""

          // סינון רלוונטיות — אם לא ב-AI, אל תכניס לתור
          if (!isAIRelated(item.title as string, content)) {
            results.off_topic++
            continue
          }

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
    })
  )

  return NextResponse.json(results)
}
