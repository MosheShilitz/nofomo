import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Schemas (Zod) ────────────────────────────────────────────────────────────

const BatchResultSchema = z.object({
  url: z.string(),
  original_title: z.string(),
  signal_score: z.number().min(0).max(100),
  merged_urls: z.array(z.string()).optional(),
})

const BatchResultArraySchema = z.array(BatchResultSchema)

const WhoAffectedEnum = z.enum([
  "developers",
  "business",
  "consumers",
  "researchers",
  "policymakers",
])

const CategoryEnum = z.enum([
  "LLMs",
  "tools",
  "research",
  "robotics",
  "safety",
  "policy",
  "vision",
  "audio",
  "agents",
  "open_source",
  "business",
  "hardware",
])

const StoryDetailsSchema = z.object({
  title_he: z.string().min(1),
  bottom_line: z.string().min(1),
  what_happened: z.string().min(1),
  why_matters: z.string().min(1),
  the_problem: z.string().nullable(),
  the_solution: z.string().nullable(),
  summary_he: z.string().min(1),
  who_affected: z.array(WhoAffectedEnum),
  use_cases: z.array(z.string()),
  impact_score: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  category: CategoryEnum,
})

// ─── Types (derived from schemas) ─────────────────────────────────────────────

export type BatchResult = z.infer<typeof BatchResultSchema>
export type StoryDetails = z.infer<typeof StoryDetailsSchema>

// Backwards compat
export type AnalysisResult = StoryDetails

function parseAndValidate<T extends z.ZodType>(schema: T, text: string): z.infer<T> {
  const clean = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(clean)
  } catch (e) {
    throw new Error(`Claude returned invalid JSON: ${(e as Error).message}\nRaw: ${clean.slice(0, 200)}`)
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Claude response failed schema validation: ${issues}`)
  }
  return result.data
}

// ─── Stage 1: Batch Triage ────────────────────────────────────────────────────
// שולח batch של ידיעות, מקבל חזרה Top 5 עם signal score בלבד
// קריאה אחת מהירה — ללא תרגום, ללא עברית

export async function analyzeBatch(
  articles: Array<{ url: string; title: string; content: string; source_name: string }>
): Promise<BatchResult[]> {
  const articlesText = articles
    .map(
      (a, i) =>
        `[${i + 1}] SOURCE: ${a.source_name}\nURL: ${a.url}\nTITLE: ${a.title}\nCONTENT: ${a.content.slice(0, 600)}`
    )
    .join("\n\n---\n\n")

  const message = await client.messages.create({
    // Haiku for triage: scoring + dedup is a classifier-shaped task. Sonnet is
    // overkill and ~3-5x slower. Keep Sonnet for Stage 2 (full Hebrew extraction).
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: `You are the Senior Tech Editor for NO-FOMO.AI. Your ONLY job right now is TRIAGE.

ANTI-HYPE SIGNAL SCORING RUBRIC (0-100):
Base score: 50
+30: Open-source/open-weights model release, new SOTA research with benchmarks, new developer APIs/tools
+20: Direct measurable developer impact (API price cuts, major regulatory shifts, real technical breakthroughs)
-50 PENALTY: PR buzzwords ("Revolutionary," "Game-changer," "groundbreaking," "The future of AI")
-30 PENALTY: Unverified rumors, generic opinion pieces, incremental minor updates, marketing fluff

DEDUPLICATION: If multiple items cover the SAME event, merge into ONE entry. Use the most authoritative URL (official blog > research > media > newsletter).

Score EVERY item, don't pre-filter. Downstream code applies the signal threshold.
Return a JSON array of EVERY item, sorted by signal_score DESC. No explanations. No markdown fences.`,
    messages: [
      {
        role: "user",
        content: `Process this batch. Return ALL items sorted by signal_score DESC as JSON array only:\n\n${articlesText}\n\nFormat: [{"url":"...","original_title":"...","signal_score":75,"merged_urls":["other url if merged"]}]`,
      },
    ],
  })

  const text = message.content[0].type === "text" ? message.content[0].text : "[]"
  return parseAndValidate(BatchResultArraySchema, text)
}

// ─── Stage 2: Detail Extraction ───────────────────────────────────────────────
// רץ על כל אחת מ-5 הידיעות הנבחרות — מחלץ תוכן מלא בעברית
// System prompt cached (ephemeral) — חיסכון ~80% כשהקריאות חופפות ב-5 דקות

const STAGE_2_SYSTEM = `אתה עורך של NO-FOMO.AI — ערוץ עדכוני AI לקהל ישראלי שמתרגם AI לאחרים (מפתחים, מנהלי מוצר, יזמים, מפיצי תוכן).

הקורא לוקח את מה שאתה כותב ומשדר אותו הלאה — לערוץ הטלגרם שלו, לפגישת לקוח, לפוסט בלינקדאין. אתה כותב בשבילו תחמושת.

═══ Voice ═══
שיחתי-מקצועי, לא יבש כמעיתון ולא צהוב כפרסומת. כותב כמו אדם חכם שמסביר לחבר.
משפטים קצרים. הסבר ב-2 משפטים מה שעיתון כותב ב-5.
מותר: לפנות לקורא ב-"אתה", להשתמש ב-"זה אומר ש...", "בפועל".
אסור: סלוגנים, ביטויים מתורגמים מאנגלית, ניסוחים פאתטיים.

═══ Anti-Hype (חוק ברזל) ═══
אסור לחלוטין: "מהפכני", "פורץ דרך", "עתיד ה-AI", "גיים צ'יינג'ר", "שינוי פרדיגמה",
"בעידן ה-AI", "בעולם המתפתח", "טכנולוגיה משנת חיים", "חוויה חדשה", "פתרון חכם".
אם אין מספרים או הוכחות — אל תגדיר משהו כ"משמעותי" או "פורץ".

═══ Anti AI-Speak ═══
לא להשתמש בנוסחאות מתורגמות מאנגלית כמו "Let's dive in" → "בואו נצלול".
לא להתחיל סיכומים ב-"במאמר זה" / "במאמר הנוכחי".
לא לסיים ב-"לסיכום" — לסיים בצעד הבא ספציפי.

═══ Use-case mandate ═══
כל סיפור חייב לענות: "למי זה מיועד? מה אפשר לעשות עם זה? למה הקורא ירצה לדעת?"
זה ה-DNA של הערוץ. אם אתה לא יודע — אתה לא מספיק הבנת את הסיפור.

use_cases: 2-4 פעולות קונקרטיות שמישהו יכול לעשות עכשיו.
דוגמה טובה: "מפתח שבונה chatbot RAG — עכשיו יכול לעדכן את ה-context לכל שיחה בעלות חצי"
דוגמה רעה: "שיפור ביצועים בעבודה עם AI"

═══ מבנה summary_he ═══

מחקר / מודל / טכנולוגיה חדשה:
1. משפט פתיחה: מה זה עושה בפועל
2. מה הבעיה שפתרו (מה לא עבד עד עכשיו)
3. איך זה עובד — בפשטות, בלי מתמטיקה
4. למה זה חשוב — מספרים, השלכה
5. מה הקורא יכול לעשות עם זה השבוע

הכרזת מוצר / API / כלי:
1. משפט פתיחה: מה בדיוק שוחרר
2. מה השתנה ספציפית — מספרים, כלים, פיצ'רים
3. מי זה מיועד לו — קונקרטית
4. צעד הבא — קישור / mongol / איך מתחילים

═══ Field-level rules ═══
title_he: 6-10 מילים. עובדתי. בלי "?" סקרני אלא רק אם זה באמת שאלה פתוחה.
bottom_line: משפט אחד שמסכם את הסיפור למישהו עסוק.
the_problem ו-the_solution: רק אם זה מחקר אקדמי / חידוש טכני אמיתי. null לכל השאר.
impact_score: 1=שגרתי, 2=שווה לדעת, 3=חשוב, 4=מאוד חשוב, 5=שינוי אמיתי (נדיר מאוד).
who_affected: רק מתוך [developers, business, consumers, researchers, policymakers]. אל תזרוק "developers" כברירת מחדל — חשוב מי באמת מושפע.
category: רק מתוך [LLMs, tools, research, robotics, safety, policy, vision, audio, agents, open_source, business, hardware].

═══ Output ═══
החזר JSON בלבד. בלי markdown fences, בלי הסבר.`

export async function extractStoryDetails(
  title: string,
  content: string,
  url: string,
  mergedContent?: string
): Promise<StoryDetails> {
  const fullContent = mergedContent
    ? `מקור ראשי:\n${content}\n\nהקשר נוסף ממקורות נוספים:\n${mergedContent}`
    : content

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    // 2048 — Hebrew encodes ~2x tokens/char vs English. 1200 truncated mid-JSON.
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: STAGE_2_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `נתח:

כותרת: ${title}
URL: ${url}

תוכן:
${fullContent.slice(0, 5000)}

JSON:
{
  "title_he": "כותרת עברית — עובדתית, מקסימום 10 מילים",
  "bottom_line": "מה זה אומר בפועל — משפט אחד למפתח",
  "what_happened": "עובדה אחת ברורה — מה קרה",
  "why_matters": "למה זה חשוב — זווית טכנית, לא שיווקית",
  "the_problem": "הבעיה הטכנית שפתרו / null",
  "the_solution": "הפתרון הטכני בשפה פשוטה / null",
  "summary_he": "200-300 מילה עובדתיות ומובנות",
  "who_affected": ["developers"],
  "use_cases": ["שימוש מעשי 1", "שימוש מעשי 2"],
  "impact_score": 3,
  "category": "LLMs"
}`,
      },
    ],
  })

  const text = message.content[0].type === "text" ? message.content[0].text : ""
  return parseAndValidate(StoryDetailsSchema, text)
}

// Backwards compat — used in older code paths
export async function analyzeArticle(
  title: string,
  content: string,
  url: string
): Promise<AnalysisResult> {
  return extractStoryDetails(title, content, url)
}
