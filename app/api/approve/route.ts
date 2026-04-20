/**
 * POST /api/approve
 * Telegram webhook — מקבל callback_query מכפתורי ✅ ❌ ✏️
 */

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { publishToChannel, answerCallback, editMessageText } from "@/lib/telegram"
import { getSourceById } from "@/lib/sources"

export async function POST(req: NextRequest) {
  const body = await req.json()

  // טיפול ב-callback_query (לחיצה על כפתור)
  if (body.callback_query) {
    const { id: callbackId, data, message } = body.callback_query
    const [action, articleId] = (data as string).split(":")

    if (action === "approve" && articleId) {
      await handleApprove(articleId, callbackId, message?.message_id)
    } else if (action === "reject" && articleId) {
      await handleReject(articleId, callbackId, message?.message_id)
    } else if (action === "approve_all") {
      await handleApproveAll(callbackId)
    }
  }

  return NextResponse.json({ ok: true })
}

async function handleApprove(articleId: string, callbackId: string, messageId?: number) {
  // מצא את ה-article
  const { data: article } = await supabaseAdmin
    .from("articles")
    .select("*")
    .eq("id", articleId)
    .single()

  if (!article) {
    await answerCallback(callbackId, "❌ לא נמצא")
    return
  }

  const source = getSourceById(article.source_id)

  // פרסם לערוץ
  await publishToChannel({
    title_he: article.title_he,
    what_happened: article.what_happened,
    why_matters: article.why_matters,
    who_affected: article.who_affected,
    use_cases: article.use_cases,
    impact_score: article.impact_score,
    signal_score: article.signal_score,
    signal_label: article.signal_label,
    category: article.category,
    summary_he: article.summary_he,
    original_url: article.original_url,
    source_display_name: source?.credit.display_name ?? article.source_id,
    source_profile_url: source?.credit.profile_url ?? article.original_url,
  })

  // עדכן status ב-DB
  await supabaseAdmin
    .from("articles")
    .update({ approval_status: "approved", approved_at: new Date().toISOString() })
    .eq("id", articleId)

  await supabaseAdmin
    .from("approval_queue")
    .update({ status: "approved", decided_at: new Date().toISOString() })
    .eq("article_id", articleId)

  await answerCallback(callbackId, "✅ פורסם לערוץ!")

  // עדכן את הודעת הטלגרם
  if (messageId) {
    await editMessageText(
      process.env.TELEGRAM_OWNER_CHAT_ID!,
      messageId,
      `✅ <b>פורסם</b>\n${article.title_he}`
    )
  }
}

async function handleReject(articleId: string, callbackId: string, messageId?: number) {
  await supabaseAdmin
    .from("articles")
    .update({ approval_status: "rejected" })
    .eq("id", articleId)

  await supabaseAdmin
    .from("approval_queue")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("article_id", articleId)

  await answerCallback(callbackId, "❌ נדחה")

  const { data: article } = await supabaseAdmin
    .from("articles")
    .select("title_he")
    .eq("id", articleId)
    .single()

  if (messageId && article) {
    await editMessageText(
      process.env.TELEGRAM_OWNER_CHAT_ID!,
      messageId,
      `❌ <b>נדחה</b>\n${article.title_he}`
    )
  }
}

async function handleApproveAll(callbackId: string) {
  const { data: pendingItems } = await supabaseAdmin
    .from("articles")
    .select("id")
    .eq("approval_status", "pending")

  if (!pendingItems?.length) {
    await answerCallback(callbackId, "אין פריטים ממתינים")
    return
  }

  for (const item of pendingItems) {
    await handleApprove(item.id, callbackId)
  }

  await answerCallback(callbackId, `✅ אושרו ${pendingItems.length} פריטים!`)
}
