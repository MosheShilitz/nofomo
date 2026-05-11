/**
 * POST /api/approve
 * Telegram webhook — מקבל callback_query מכפתורי ✅ ❌ ✏️
 */

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { publishToChannel, answerCallback, editMessageText, sendMessage } from "@/lib/telegram"
import { getSourceById } from "@/lib/sources"

export async function POST(req: NextRequest) {
  // Telegram webhook signature — ה-secret_token מוגדר ב-setWebhook
  // ונשלח בכל בקשה ב-header X-Telegram-Bot-Api-Secret-Token.
  // מונע מתוקף לזייף לחיצות approve/reject.
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!expectedSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 })
  }
  const providedSecret = req.headers.get("x-telegram-bot-api-secret-token")
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()

  // טיפול ב-callback_query (לחיצה על כפתור)
  if (body.callback_query) {
    const { id: callbackId, data, message } = body.callback_query
    const [action, articleId] = (data as string).split(":")

    if (action === "approve" && articleId) {
      await handleApprove(articleId, callbackId, message?.message_id)
    } else if (action === "reject" && articleId) {
      await handleReject(articleId, callbackId, message?.message_id)
    } else if (action === "edit" && articleId) {
      await handleEdit(articleId, callbackId)
    } else if (action === "approve_all") {
      await handleApproveAll(callbackId)
    }
  }

  // טיפול בהודעת טקסט — עריכת שדה
  // פורמט: EDIT:[articleId] field:ערך חדש
  // שדות: title | bottom_line | what_happened | why_matters
  if (body.message?.text) {
    const text = body.message.text as string
    if (text.startsWith("EDIT:")) {
      await handleEditMessage(text)
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
    bottom_line: article.bottom_line,
    what_happened: article.what_happened,
    why_matters: article.why_matters,
    the_problem: article.the_problem,
    the_solution: article.the_solution,
    who_affected: article.who_affected,
    use_cases: article.use_cases,
    impact_score: article.impact_score,
    signal_score: article.signal_score,
    signal_label: article.signal_label,
    category: article.category,
    summary_he: article.summary_he,
    original_url: article.original_url,
    published_at: article.published_at,
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

async function handleEdit(articleId: string, callbackId: string) {
  const { data: article } = await supabaseAdmin
    .from("articles")
    .select("id, title_he, bottom_line, what_happened, why_matters")
    .eq("id", articleId)
    .single()

  if (!article) {
    await answerCallback(callbackId, "❌ לא נמצא")
    return
  }

  await answerCallback(callbackId, "✏️ שלח עריכה")

  const instructions = `✏️ <b>עריכת ידיעה</b>
ID: <code>${article.id}</code>

<b>שדות לעריכה:</b>
• <code>title</code> — ${article.title_he}
• <code>bottom_line</code> — ${article.bottom_line ?? "—"}
• <code>what_happened</code> — ${(article.what_happened ?? "").slice(0, 80)}...
• <code>why_matters</code> — ${(article.why_matters ?? "").slice(0, 80)}...

<b>פורמט שליחה:</b>
<code>EDIT:${article.id} title:כותרת חדשה</code>
<code>EDIT:${article.id} bottom_line:שורה תחתונה חדשה</code>
<code>EDIT:${article.id} what_happened:טקסט חדש</code>
<code>EDIT:${article.id} why_matters:טקסט חדש</code>`

  await sendMessage(process.env.TELEGRAM_OWNER_CHAT_ID!, instructions)
}

async function handleEditMessage(text: string) {
  // EDIT:[articleId] field:value
  const match = text.match(/^EDIT:([a-f0-9-]+)\s+(\w+):([\s\S]+)$/)
  if (!match) {
    await sendMessage(process.env.TELEGRAM_OWNER_CHAT_ID!, "❌ פורמט שגוי. דוגמה:\n<code>EDIT:[id] title:כותרת חדשה</code>")
    return
  }

  const [, articleId, field, value] = match
  const allowedFields = ["title_he", "title", "bottom_line", "what_happened", "why_matters"]
  const dbField = field === "title" ? "title_he" : field

  if (!allowedFields.includes(dbField)) {
    await sendMessage(process.env.TELEGRAM_OWNER_CHAT_ID!, `❌ שדה לא מוכר: ${field}`)
    return
  }

  const { error } = await supabaseAdmin
    .from("articles")
    .update({ [dbField]: value.trim() })
    .eq("id", articleId)

  if (error) {
    await sendMessage(process.env.TELEGRAM_OWNER_CHAT_ID!, `❌ שגיאה: ${error.message}`)
    return
  }

  await sendMessage(process.env.TELEGRAM_OWNER_CHAT_ID!, `✅ <b>${field}</b> עודכן בהצלחה`)
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
