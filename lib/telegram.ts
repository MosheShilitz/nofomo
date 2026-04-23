/**
 * Telegram Bot — approval flow + channel publishing
 */

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID!
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID!

const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`

async function telegramRequest(method: string, body: object) {
  const res = await fetch(`${BASE_URL}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description ?? JSON.stringify(data)}`)
  }
  return data
}

// ─── שלח הודעת אישור לבעל הפרויקט ───────────────────────────────

export async function sendApprovalMessage(article: {
  id: string
  title_he: string
  bottom_line?: string
  what_happened: string
  why_matters: string
  the_problem?: string | null
  the_solution?: string | null
  who_affected: string[]
  use_cases: string[]
  impact_score: number
  signal_score: number
  signal_label: string
  category: string
  original_url: string
  published_at?: string
  source_display_name: string
  cross_refs_count: number
  first_source?: string
  is_preprint?: boolean
}) {
  const signalEmoji = {
    breaking: "🔴",
    major: "🟠",
    noteworthy: "🟡",
    normal: "⚪",
  }[article.signal_label] ?? "⚪"

  const starsMap: Record<number, string> = {
    1: "⭐",
    2: "⭐⭐",
    3: "⭐⭐⭐",
    4: "⭐⭐⭐⭐",
    5: "⭐⭐⭐⭐⭐",
  }
  const stars = starsMap[article.impact_score] ?? "⭐"

  const who = article.who_affected.join(" · ")
  const uses = article.use_cases.map((u) => `› ${u}`).join("\n")

  const sourceLine = article.cross_refs_count > 0
    ? `🔍 ${article.cross_refs_count} מקורות${article.first_source ? ` · 🥇 ${article.first_source}` : ""}`
    : `📡 ${article.source_display_name}`

  const bottomLine = article.bottom_line
    ? `\n<blockquote>${article.bottom_line}</blockquote>\n`
    : ""

  const preprintWarning = article.is_preprint
    ? `\n⚠️ <b>Preprint</b> — טרם עבר ביקורת עמיתים\n`
    : ""

  const problemSection = article.the_problem
    ? `\n<b>הבעיה שפתרו</b>\n${article.the_problem}\n`
    : ""

  const solutionSection = article.the_solution
    ? `\n<b>הפתרון</b>\n${article.the_solution}\n`
    : ""

  const dateStr = article.published_at ? `  ·  🕐 ${formatDate(article.published_at)}` : ""

  const text = `${signalEmoji} <b>${article.signal_score}/100</b>  ·  ${stars} ${article.impact_score}/5  ·  🆕 לאישור${dateStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>${article.title_he}</b>
${bottomLine}${preprintWarning}
<b>מה קרה</b>
${article.what_happened}
${problemSection}${solutionSection}
<b>למה זה חשוב</b>
${article.why_matters}

👥 ${who}
${uses}

${sourceLine}  ·  ${article.original_url}`

  // כפתורי inline
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ פרסם", callback_data: `approve:${article.id}` },
        { text: "❌ דחה", callback_data: `reject:${article.id}` },
        { text: "✏️ ערוך", callback_data: `edit:${article.id}` },
      ],
    ],
  }

  const result = await telegramRequest("sendMessage", {
    chat_id: OWNER_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup,
  })

  return result?.result?.message_id as number | undefined
}

// ─── שלח batch summary ─────────────────────────────────────────────

export async function sendBatchSummary(count: number, topItems: { title_he: string; signal_score: number }[]) {
  const top = topItems
    .slice(0, 3)
    .map((a, i) => `  ${i + 1}. ${a.title_he} (Signal: ${a.signal_score})`)
    .join("\n")

  const text = `📦 <b>${count} פריטים ממתינים לאישורך</b>\n\nTop Signal:\n${top}`

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ אשר הכל", callback_data: "approve_all" },
        { text: "👀 בדוק אחד אחד", callback_data: "review_one_by_one" },
      ],
    ],
  }

  return telegramRequest("sendMessage", {
    chat_id: OWNER_CHAT_ID,
    text,
    parse_mode: "HTML",
    reply_markup,
  })
}

// ─── פרסם לערוץ ────────────────────────────────────────────────────

export async function publishToChannel(article: {
  title_he: string
  bottom_line?: string
  what_happened: string
  why_matters: string
  the_problem?: string | null
  the_solution?: string | null
  who_affected: string[]
  use_cases: string[]
  impact_score: number
  signal_score: number
  signal_label: string
  category: string
  summary_he: string
  original_url: string
  source_display_name: string
  source_profile_url: string
  published_at?: string
}) {
  const signalEmoji = {
    breaking: "🔴 BREAKING",
    major: "🟠 חשוב",
    noteworthy: "🟡 מעניין",
    normal: "⚪ עדכון",
  }[article.signal_label] ?? "⚪ עדכון"

  const starsMap: Record<number, string> = {
    1: "⭐", 2: "⭐⭐", 3: "⭐⭐⭐", 4: "⭐⭐⭐⭐", 5: "⭐⭐⭐⭐⭐",
  }
  const stars = starsMap[article.impact_score] ?? "⭐"

  const categoryMap: Record<string, string> = {
    LLMs: "🧠 LLMs", tools: "🛠️ כלים", research: "🔬 מחקר",
    safety: "🛡️ בטיחות", robotics: "🤖 רובוטיקה", vision: "👁️ Vision",
    audio: "🎵 Audio", agents: "🤖 Agents", open_source: "📦 Open Source",
    business: "💼 עסקי", hardware: "💾 Hardware", policy: "⚖️ מדיניות",
  }
  const cat = categoryMap[article.category] ?? article.category
  const dateStr = article.published_at ? `  ·  ${formatDate(article.published_at)}` : ""

  const who = article.who_affected.join(" · ")
  const uses = article.use_cases.map((u) => `› ${u}`).join("\n")

  const bottomLine = article.bottom_line
    ? `\n<blockquote>${article.bottom_line}</blockquote>\n`
    : ""

  const problemSection = article.the_problem
    ? `\n<b>הבעיה שפתרו</b>\n${article.the_problem}\n`
    : ""

  const solutionSection = article.the_solution
    ? `\n<b>הפתרון</b>\n${article.the_solution}\n`
    : ""

  const text = `${signalEmoji}  ·  ${cat}${dateStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>${article.title_he}</b>
${bottomLine}
<b>מה קרה</b>
${article.what_happened}
${problemSection}${solutionSection}
<b>למה זה חשוב</b>
${article.why_matters}

━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 ${who}
${uses}

${stars} ${article.impact_score}/5  ·  Signal ${article.signal_score}  ·  📡 ${article.source_display_name}

${article.original_url}

<i>NO-FOMO.AI — לא תפספסו כלום | @nofomo_ai</i>`

  return telegramRequest("sendMessage", {
    chat_id: CHANNEL_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  })
}

// ─── ענה על callback (כפתורי approval) ────────────────────────────

export async function answerCallback(callback_query_id: string, text: string) {
  return telegramRequest("answerCallbackQuery", {
    callback_query_id,
    text,
    show_alert: false,
  })
}

export async function editMessageText(chat_id: string, message_id: number, text: string) {
  return telegramRequest("editMessageText", {
    chat_id,
    message_id,
    text,
    parse_mode: "HTML",
  })
}
