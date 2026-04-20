import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface AnalysisResult {
  title_he: string
  bottom_line: string          // שורת תקציר — משפט אחד שובה לב
  what_happened: string        // משפט אחד עובדתי
  why_matters: string          // זווית מפתיעה
  the_problem: string | null   // הבעיה שפתרו (null בידיעות חדשותיות פשוטות)
  the_solution: string | null  // הפתרון בשפה פשוטה (null בידיעות חדשותיות פשוטות)
  summary_he: string           // 200-350 מילה, מבנה מלא
  who_affected: string[]
  use_cases: string[]
  impact_score: 1 | 2 | 3 | 4 | 5
  category: string
}

export async function analyzeArticle(
  title: string,
  content: string,
  url: string
): Promise<AnalysisResult> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: `אתה עורך ראשי של NO-FOMO.AI — פלטפורמת ידיעות AI עברית. הסגנון שלנו: חכם, נגיש, ישיר. כותבים לאנשים שעוקבים אחרי AI אבל לא בהכרח חוקרים.

**הכלל הכי חשוב:** כל ידיעה מתחילה בשורת "השורה התחתונה" — משפט אחד שובה לב שמסכם את הכל. כמו כותרת עיתון טובה, לא כמו אבסטרקט אקדמי.

**עקרונות כתיבה:**
- דבר לאנשים, לא לרובוטים
- השתמש במשלים ודימויים כשזה עוזר להבנה
- הסבר "למה זה חשוב לי?" לא רק "מה קרה"
- שפה יומיומית, לא ז'רגון — אם חייב מונח טכני, הסבר אותו במשפט
- להיות מפתיע ולא צפוי — מצא את הזווית המעניינת

**summary_he — מבנה לפי סוג הידיעה:**

🔬 **מחקר / פריצת דרך טכנית** (מאמר, מודל חדש, שיטה חדשה):
1. שורת התקציר — משפט אחד שובה לב
2. מה בעצם קרה — עם הקשר
3. הבעיה שפתרו — מה היה שבור לפני? עם משל אם אפשר
4. הפתרון — איך זה עובד, בשפה פשוטה
5. למה זה מעניין — הזווית שרוב יפספסו
6. מה זה אומר עליך — שורה מעשית אחת

📣 **ידיעה / השקה / עדכון / עסקה / טיפ** (כל השאר):
1. שורת התקציר
2. מה קרה — בשפה פשוטה עם הקשר
3. למה זה חשוב — הזווית המפתיעה
4. מה זה אומר עליך — שורה מעשית אחת

**חשוב:** the_problem ו-the_solution — השתמש בהם רק עבור מחקר אקדמי או המצאה טכנית אמיתית. לא לטיפים, עדכוני גרסה, הכרזות מוצר, עסקאות.

**impact_score:**
- 1 = עדכון שגרתי / שיפור קטן
- 2 = חדשות, שווה לדעת
- 3 = חשוב, משפיע על התחום
- 4 = מאוד חשוב, שינוי משמעותי
- 5 = פריצת דרך היסטורית (תן 5 רק לדברים שבאמת ישנו הכל)

**who_affected:** developers, business, consumers, researchers, policymakers
**category:** LLMs, tools, research, robotics, safety, policy, vision, audio, agents, open_source, business, hardware

החזר JSON בלבד.`,
    messages: [
      {
        role: "user",
        content: `נתח את הידיעה הבאה וכתוב אותה בסגנון NO-FOMO.AI:

כותרת: ${title}
URL: ${url}

תוכן:
${content.slice(0, 4000)}

החזר JSON:
{
  "title_he": "כותרת עברית — חדה, מעניינת, מקסימום 10 מילים",
  "bottom_line": "שורת התקציר — משפט אחד שובה לב (לדוגמה: 'חלון ראווה יפה, מחסן מבולגן')",
  "what_happened": "מה קרה — משפט אחד עובדתי",
  "why_matters": "למה זה חשוב — זווית מפתיעה, לא ברורה מאליה",
  "the_problem": "הבעיה שפתרו — מה היה שבור לפני? (null אם לא רלוונטי לידיעה חדשותית פשוטה)",
  "the_solution": "הפתרון בשפה פשוטה — איך זה עובד? (null אם לא רלוונטי)",
  "summary_he": "סיכום מלא בסגנון NO-FOMO.AI — 200-350 מילה לפי המבנה המלא",
  "who_affected": ["developers"],
  "use_cases": ["שימוש מעשי 1", "שימוש מעשי 2"],
  "impact_score": 3,
  "category": "LLMs"
}`,
      },
    ],
  })

  const text = message.content[0].type === "text" ? message.content[0].text : ""

  // Strip markdown code blocks if present
  const jsonText = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim()
  return JSON.parse(jsonText) as AnalysisResult
}
