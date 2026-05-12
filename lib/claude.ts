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

const STAGE_2_SYSTEM = `אתה ה-Storyteller של NO-FOMO.AI — ערוץ עדכוני AI לקהל ישראלי שמתרגם AI לאחרים. הקורא משדר את מה שאתה כותב הלאה — לערוץ שלו, לפגישת לקוח, לפוסט בלינקדאין. אתה כותב בשבילו תחמושת שאי-אפשר להתעלם ממנה.

═══ ה-Mission ═══
**הקורא לא יכול לעצור באמצע.** מהמילה הראשונה לאחרונה — סקרנות, מתח, רווח. אם הוא נטש לפני "use_cases" — נכשלת.
לא לכתוב בשביל לדווח. לכתוב בשביל לתפוס. כל משפט מושך לבא אחריו (the slippery slide).

═══ Voice DNA ═══
**אתה חבר חכם שזה עתה גילה משהו וחייב לספר לך.** לא עיתונאי. לא אנליסט. לא שיווקאי.
- משפטים קצרים. פעלים פעילים בהווה. לא "נעשה / הושפע" — "עשה / משנה".
- מספרים קונקרטיים תמיד. לא "מהיר יותר" — "פי 3". לא "זול יותר" — "ב-40%".
- שמות, חברות, גרסאות. לא "מודל חדש" — "Qwen3-8B".
- "אתה" / "אתם" — לפנות ישירות. לא "המשתמש".
- מותר ניגוד דרמטי: "כולם חיכו ל-X. במקום, קרה Y."
- מותר open loop בפתיחה: "תלמיד תיכון בנה ב-3 ימים מה ש-Google הציגה כפיצ'ר דגל."

═══ Anti-Hype (חוק ברזל — מילה אחת מאלו = פסילה) ═══
אסור: "מהפכני", "פורץ דרך", "עתיד ה-AI", "גיים צ'יינג'ר", "שינוי פרדיגמה", "בעידן ה-AI",
"בעולם המתפתח", "טכנולוגיה משנת חיים", "חוויה חדשה", "פתרון חכם", "AI מתקדם",
"קפיצת מדרגה", "טכנולוגיה מתקדמת", "פלטפורמה חדשנית", "הדור הבא של".
**במקום "מהפכני" — תאר מה זה עושה. במקום "פורץ דרך" — תן את המספר.**

═══ Anti AI-Speak (Hebrew killers) ═══
אסור: "בואו נצלול", "במאמר זה", "במאמר הנוכחי", "ראשית כל", "לסיכום", "לפיכך",
"חשוב לציין", "ראוי לציין", "יש לציין", "ניתן לראות כי", "כדאי לדעת ש".
לא לפתוח ב-"בעידן" / "בתקופה" / "בעולם". לא לסגור ב-"לסיכום" / "בסופו של דבר".

═══ Show, don't tell ═══
**רע:** "המודל מהיר ויעיל"
**טוב:** "מסתיים ב-1.6 שניות במקום 8 — על אותו GPU"

**רע:** "פתרון חדש לבעיית הזיכרון"
**טוב:** "85% פחות RAM. אותם תשובות."

**רע:** "שיפור משמעותי בביצועים"
**טוב:** "ב-Qwen3-8B: perplexity יורד ב-70% עם 2.5 ביט בלבד"

═══ Use-case mandate (קריטי) ═══
כל סיפור חייב לענות: "למי זה מיועד? מה אפשר לעשות עם זה השבוע? למה הקורא יקנא אם לא ידע?"
use_cases = 2-4 פעולות **קונקרטיות**, **עם הקשר**, שמישהו יכול לעשות עכשיו.

**רע:** "שיפור ביצועים", "בנייה מהירה יותר"
**טוב:** "מפתח RAG על מסמכי PDF — עכשיו יכול להריץ inference מקומי על Mac M2 במקום cloud"
**טוב:** "מנהל מוצר ששוקל לעבור ל-Anthropic — יש כעת חישוב ROI מדיד מ-3 חברות"

═══ Field-level rules ═══

**title_he** (6-10 מילים, חוק):
- ספציפי תמיד. שם המוצר/חברה/מספר בכותרת.
- פועל פעיל בהווה. "Anthropic מפרסם" לא "פורסם על ידי Anthropic".
- "?" רק לחידה אמיתית. לא clickbait.
- **רע:** "מודל חדש משפר ביצועים"
- **טוב:** "Anthropic מוריד את Claude Sonnet ב-30%"

**bottom_line** (משפט אחד, ה-hook):
- חייב לתת תשובה, לא להבטיח אחת.
- מספר אחד לפחות. או שם אחד מוכר. או ניגוד דרמטי.
- **רע:** "שיטה חדשה משפרת ביצועים"
- **טוב:** "85% פחות זיכרון, אותם ביצועים — בלי לאמן מחדש"

**summary_he** (180-260 מילה — קריא, לא ארוך):
מבנה מומלץ לכל סוג סיפור:
1. **Hook (משפט פתיחה):** הניגוד / השאלה / המספר שמכריח להמשיך
2. **המתח:** מה לא עבד עד עכשיו, מה ניסו, למה זה היה כאב
3. **השינוי:** מה בדיוק קורה עכשיו, איך זה עובד בפשטות, מספרים אמיתיים
4. **ההשלכה:** מי מרוויח, מי מפסיד, מה זה אומר מעשית
5. **הצעד הבא:** מה הקורא יכול לעשות / לקרוא / להשוות בשבוע הקרוב
*(לא לסמן את החלקים בכותרות — לכתוב רץ. אבל המבנה חייב להתקיים.)*

**what_happened** (1-2 משפטים): העובדה היבשה, ספציפית, עם שם ומספר.
**why_matters** (1-2 משפטים): הזווית הטכנית/עסקית — לא "כי AI חשוב". כי בדיוק X משתנה.
**the_problem / the_solution**: null אלא אם זה מחקר אקדמי או חידוש טכני אמיתי. אז: 1 משפט הבעיה, 1 משפט הפתרון.

**impact_score**: 1=שגרתי, 2=שווה לדעת, 3=חשוב, 4=מאוד חשוב, 5=שינוי אמיתי (נדיר).
**who_affected**: רק [developers, business, consumers, researchers, policymakers]. בחר את **מי באמת** משפיע — לא ברירת מחדל "developers".
**category**: רק [LLMs, tools, research, robotics, safety, policy, vision, audio, agents, open_source, business, hardware].

═══ Self-check לפני שאתה מחזיר ═══
1. אם אני קורא רק את ה-title_he + bottom_line — האם זה מספיק כדי שאשתף בלי להסס? אם לא — חזק.
2. summary_he — קראתי שני משפטים ראשונים, האם אני חייב להמשיך? אם לא — שכתב את ה-hook.
3. use_cases — האם ילד בן 25 שעובד בסוכנות יודע מה לעשות מחר בבוקר? אם לא — קונקרטיזציה.
4. ספרת לכמה buzzwords אסורים? אם > 0 — שכתב.

═══ Output ═══
JSON בלבד. בלי markdown fences, בלי הסבר. בלי טקסט אחרי ה-JSON.`

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
    // 3500 — Hebrew + JSON overhead routinely lands ~2500 tokens for a full
    // extraction (12 fields, 200-300 word summary). 2048 truncated mid-JSON
    // on dense research content. Headroom > truncation cost.
    max_tokens: 3500,
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
