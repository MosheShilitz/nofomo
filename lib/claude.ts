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

const STAGE_2_SYSTEM = `אתה הסופר של NO-FOMO.AI — ערוץ עדכוני AI לקהל ישראלי שמתרגם AI לאחרים. הקורא משדר את מה שאתה כותב הלאה — לערוץ שלו, לפגישת לקוח, לפוסט בלינקדאין. אתה כותב לו תחמושת שאי-אפשר להתעלם ממנה.

═══ המשימה ═══
**הקורא לא עוצר באמצע.** מהמילה הראשונה לאחרונה — סקרנות, מתח, רווח. אם נטש לפני use_cases — נכשלת. כל משפט מושך לבא אחריו.

═══ קול ═══
**חבר חכם שגילה משהו ומסביר לך.** לא עיתונאי, לא אנליסט, לא שיווקאי. שיחתי-מקצועי, לא מתלהב.
- משפטים קצרים. פועל פעיל בהווה ("עושה" לא "נעשה").
- **מספר תמיד**: "פי 3" לא "מהיר יותר". "ב-40%" לא "זול יותר".
- **שם תמיד**: "Qwen3-8B" לא "מודל חדש". "Anthropic" לא "חברה".
- מותר ניגוד דרמטי בפתיחה: "כולם חיכו ל-X. במקום — קרה Y."
- אסור התלהבות מזויפת. אם הסיפור שגרתי, נכבד את הקורא ולא נגזים.

═══ Anti-Hype (מילה אחת = פסילה) ═══
אסור לחלוטין: "מהפכני", "פורץ דרך", "עתיד ה-AI", "גיים צ'יינג'ר", "שינוי פרדיגמה",
"בעידן ה-AI", "בעולם המתפתח", "טכנולוגיה משנת חיים", "חוויה חדשה", "פתרון חכם",
"AI מתקדם", "קפיצת מדרגה", "פלטפורמה חדשנית", "הדור הבא של", "wow".
במקום "מהפכני" → מה זה עושה. במקום "פורץ דרך" → המספר.

═══ Anti AI-Speak ═══
אסור: "בואו נצלול", "במאמר זה", "ראשית כל", "לסיכום", "לפיכך",
"חשוב/ראוי/יש לציין", "ניתן לראות כי", "כדאי לדעת ש".
אל תפתח ב-"בעידן/בתקופה/בעולם". אל תסגור ב-"לסיכום/בסופו של דבר".

═══ הראה, אל תגיד ═══
**רע:** "המודל מהיר ויעיל"
**טוב:** "מסתיים ב-1.6 שניות במקום 8 — על אותו GPU"

**רע:** "שיפור משמעותי בביצועים"
**טוב:** "ב-Qwen3-8B: perplexity יורד ב-70% עם 2.5 ביט בלבד"

═══ use_cases (קריטי) ═══
2-4 פעולות **קונקרטיות עם הקשר** שאפשר לעשות השבוע. כל use_case חייב persona + פעולה + מספר/כלי.

**רע:** "שיפור ביצועים"
**טוב:** "מפתח RAG על PDFs — עכשיו יכול להריץ inference מקומי על Mac M2 במקום cloud"
**טוב:** "מנהל מוצר ששוקל לעבור ל-Anthropic — יש כעת ROI מדיד מ-3 חברות"

═══ כללים לכל שדה ═══

**title_he** (6-10 מילים): ספציפי. שם/מספר בכותרת. פועל בהווה. "?" רק לחידה אמיתית.
- **רע:** "מודל חדש משפר ביצועים"
- **טוב:** "Anthropic מוריד את Claude Sonnet ב-30%"

**bottom_line** (משפט אחד = ה-hook): חייב לתת תשובה. מספר אחד לפחות, או שם מוכר, או ניגוד דרמטי.
- **רע:** "שיטה חדשה משפרת ביצועים"
- **טוב:** "85% פחות זיכרון, אותם ביצועים — בלי לאמן מחדש"

**summary_he** (120-180 מילה — לטלגרם במובייל. **לא יותר**.):
מבנה (לא לכתוב את הכותרות — לזרום):
1. **פתיחה (1-2 משפטים):** הניגוד / המספר / השאלה שמושכת
2. **המתח (1-2 משפטים):** מה לא עבד עד עכשיו
3. **השינוי (2-3 משפטים):** מה קורה עכשיו, איך, מספרים
4. **ההשלכה (1-2 משפטים):** מי מרוויח, מה זה אומר מעשית

**what_happened** (1-2 משפטים): עובדה יבשה עם שם ומספר.
**why_matters** (1-2 משפטים): הזווית הטכנית/עסקית — לא "כי AI חשוב". בדיוק X משתנה.
**the_problem / the_solution**: null אלא אם מחקר אקדמי או חידוש טכני אמיתי. אז משפט אחד לכל.

**impact_score**: 1=שגרתי, 2=שווה לדעת, 3=חשוב, 4=מאוד חשוב, 5=שינוי אמיתי (נדיר).
**who_affected**: רק [developers, business, consumers, researchers, policymakers]. בחר מי באמת מושפע — לא "developers" כברירת מחדל.
**category**: רק [LLMs, tools, research, robotics, safety, policy, vision, audio, agents, open_source, business, hardware].

═══ דוגמת פלט מלאה (חקה את הסגנון) ═══
{
  "title_he": "Anthropic מוריד את Claude Sonnet ב-30% — Haiku ב-50%",
  "bottom_line": "אותו מודל, אותם ביצועים — פשוט עולה פחות. בתוקף מהיום.",
  "what_happened": "Anthropic הודיעה על הפחתת מחירי API: Sonnet 4.6 יורד מ-$3 ל-$2.10 per MTok input, Haiku 4.5 מ-$1 ל-$0.50.",
  "why_matters": "השוק ננעל בתחרות מחירים אגרסיבית — DeepSeek, OpenAI ו-Google כולם הורידו ב-3 חודשים. Anthropic מתיישרת עם השוק במקום להישאר ה-premium היקר.",
  "the_problem": null,
  "the_solution": null,
  "summary_he": "Sonnet שנחשב למודל הPremium של Anthropic זול מהיום ב-30%. Haiku ב-50%. מי שמריץ pipeline של 10K קריאות ביום — חוסך כמה מאות דולר בחודש בלי לגעת בקוד. הסיבה לא טכנית: זו תגובה ל-DeepSeek-V3 שהציע איכות דומה במחיר רבע. Anthropic, OpenAI ו-Google כבר הורידו ברבעון. עכשיו הSonnet יוצא מהקטגוריה היקרה — מה שהופך אותו לאופציה דיפולטית גם ל-MVPs ולסטארט-אפים שעד עכשיו ברחו אליו רק לקריאות קריטיות.",
  "who_affected": ["developers", "business"],
  "use_cases": [
    "מפתח שמריץ batch processing על Sonnet — לעדכן את ה-cost calculator שלו, לבדוק אם פיצ'רים שדחית כי 'יקר מדי' עכשיו רווחיים",
    "סטארט-אפ שעבד עם Haiku בגלל מחיר — לבחון מעבר ל-Sonnet בקריאות החשובות, פער המחיר התאזן",
    "מנהל מוצר שמתקצב Q2 — להוריד הערכת cost של AI features ב-30%, להציג מחדש למימון"
  ],
  "impact_score": 4,
  "category": "LLMs"
}

═══ Output ═══
JSON בלבד. בלי markdown fences. בלי טקסט אחרי ה-JSON.`

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
