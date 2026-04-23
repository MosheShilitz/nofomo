import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchResult {
  url: string
  original_title: string
  signal_score: number
  merged_urls?: string[]
}

export interface StoryDetails {
  title_he: string
  bottom_line: string
  what_happened: string
  why_matters: string
  the_problem: string | null
  the_solution: string | null
  summary_he: string
  who_affected: string[]
  use_cases: string[]
  impact_score: 1 | 2 | 3 | 4 | 5
  category: string
}

// Backwards compat
export type AnalysisResult = StoryDetails

function parseJSON<T>(text: string): T {
  const clean = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim()
  return JSON.parse(clean) as T
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
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    system: `You are the Senior Tech Editor for NO-FOMO.AI. Your ONLY job right now is TRIAGE.

ANTI-HYPE SIGNAL SCORING RUBRIC (0-100):
Base score: 50
+30: Open-source/open-weights model release, new SOTA research with benchmarks, new developer APIs/tools
+20: Direct measurable developer impact (API price cuts, major regulatory shifts, real technical breakthroughs)
-50 PENALTY: PR buzzwords ("Revolutionary," "Game-changer," "groundbreaking," "The future of AI")
-30 PENALTY: Unverified rumors, generic opinion pieces, incremental minor updates, marketing fluff

DEDUPLICATION: If multiple items cover the SAME event, merge into ONE entry. Use the most authoritative URL (official blog > research > media > newsletter).

Return ONLY a valid JSON array of the TOP 5 items by signal_score. No explanations. No markdown fences.`,
    messages: [
      {
        role: "user",
        content: `Process this batch. Return top 5 as JSON array only:\n\n${articlesText}\n\nFormat: [{"url":"...","original_title":"...","signal_score":75,"merged_urls":["other url if merged"]}]`,
      },
    ],
  })

  const text = message.content[0].type === "text" ? message.content[0].text : "[]"
  return parseJSON<BatchResult[]>(text)
}

// ─── Stage 2: Detail Extraction ───────────────────────────────────────────────
// רץ על כל אחת מ-5 הידיעות הנבחרות — מחלץ תוכן מלא בעברית

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
    max_tokens: 2048,
    system: `אתה עורך טכני בכיר של NO-FOMO.AI. כותב לקהל של מפתחים ואנשי AI מקצועיים.

חוק ברזל — Anti-Hype:
אסור להשתמש ב: "מהפכני", "פורץ דרך", "עתיד ה-AI", "גיים צ'יינג'ר", "שינוי פרדיגמה", או כל מקבילה עברית.
שפה: טכנית, עובדתית, ישירה. משפטים קצרים. אין שיווק.

מבנה summary_he לפי סוג ידיעה:

מחקר / מודל חדש:
1. שורת התקציר — מה זה עושה בפועל
2. הבעיה שפתרו — מה לא עבד לפני
3. הפתרון הטכני — איך זה עובד
4. למה זה חשוב — השלכה מדידה
5. מה זה אומר למפתח

הכרזה / עדכון / כלי חדש:
1. שורת התקציר
2. מה בדיוק השתנה — מספרים וכלים, לא תיאורים כלליים
3. למה זה רלוונטי — השלכה מעשית
4. מה עושים עם זה עכשיו

the_problem ו-the_solution: רק למחקר אקדמי או חידוש טכני אמיתי. null לכל השאר.
impact_score: 1=שגרתי, 2=שווה לדעת, 3=חשוב, 4=מאוד חשוב, 5=שינוי אמיתי (נדיר מאוד)
who_affected: רק מתוך [developers, business, consumers, researchers, policymakers]
category: רק מתוך [LLMs, tools, research, robotics, safety, policy, vision, audio, agents, open_source, business, hardware]

החזר JSON בלבד.`,
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
  return parseJSON<StoryDetails>(text)
}

// Backwards compat — used in older code paths
export async function analyzeArticle(
  title: string,
  content: string,
  url: string
): Promise<AnalysisResult> {
  return extractStoryDetails(title, content, url)
}
