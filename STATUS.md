# Status — NoFomo

> מתעדכן בסוף כל סשן. תמיד עדכני.
>
> עודכן לאחרונה: 2026-06-17 (מעבר ראשוני לפרוטוקול האוטומטי — תוכן נגזר מ-CLAUDE.md הקיים)

## איפה אנחנו

פלטפורמת חדשות AI עברית בייצור. Pipeline end-to-end עובד. מצב פיתוח: יציבות + הרחבת תכונות.

- **Deployed:** https://nofomo-ai.vercel.app
- **GitHub:** https://github.com/MosheShilitz/nofomo
- **Telegram:** @nofomo_ai_bot (bot) · @nofomo_ai (channel)

## מה עובד (✅)

- Pipeline end-to-end (ingest → analyze → Telegram → approve → channel)
- מגוון מקורות (max 2 מאותו source_id ב-analyze)
- arXiv מוגבל ל-2 פריטים לריצה
- Preprint warning ב-Telegram ל-arXiv / PapersWithCode
- Signal Score עם משקלים מאוזנים
- עיצוב Telegram עם blockquote + bold headers

## מה ב-progress (🚧)

- (לא ידוע מהסשן הזה — יש לעדכן בסוף הסשן הבא)

## הצעד הבא (🎯)

- (לבחור מתוך רשימת "עדיין חסר" למטה לפי עדיפות)

## עדיין חסר (🔜)

- Web UI (feed page לציבור)
- ✏️ Edit flow בטלגרם
- Cross-reference (כמה מקורות כיסו אותו item)
- Email newsletter (Resend)
- דף ארכיון / מכונת זמן

## באגים ידועים (❌)

**Feeds שבורים:**
- anthropic-blog, mistral-blog, xai-blog, cohere-blog, langchain-blog: אין RSS / 404
- the-batch, bens-bites: 404
- papers-with-code: XML encoding שגוי
- reddit-*: 403 חסום
- hacker-news-ai: timeout לפעמים

## שאלות פתוחות (❓)

- האם להסיר את Simon Willison (כותב גם על דברים לא-AI)?
- האם לעבור ל-cron של Vercel Pro או להישאר עם cron-job.org?

## תלויות חיצוניות

- Supabase project: `lcnpltckplozwgbjcitq`
- Vercel (Hobby plan)
- cron-job.org — POST `/api/ingest` ו-`/api/analyze` כל שעה
- Claude API (`claude-sonnet-4-6`)
- Telegram Bot API

## רפרנסים

- `CLAUDE.md` — תיעוד מלא של הסטאק, ה-pipeline, הקבצים, וההגדרות
- `AGENTS.md` (מוטמע ב-CLAUDE.md)
- `sessions/` — סיכומי סשנים
