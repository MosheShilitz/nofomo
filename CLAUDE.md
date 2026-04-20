@AGENTS.md

# NO-FOMO.AI — Project Context for Claude

## מה זה?
פלטפורמת חדשות AI עברית אוטומטית. אוספת מ-100+ מקורות, מנתחת עם Claude, שולחת לאישור בטלגרם, מפרסמת לערוץ.

**Deployed:** https://nofomo-ai.vercel.app  
**GitHub:** https://github.com/MosheShilitz/nofomo  
**Telegram Bot:** @nofomo_ai_bot  
**Telegram Channel:** @nofomo_ai  

---

## Stack
- **Frontend/Backend:** Next.js 14 App Router + TypeScript + Tailwind
- **DB:** Supabase (PostgreSQL) — project: `lcnpltckplozwgbjcitq`
- **AI:** Claude API (`claude-sonnet-4-6`) — ניתוח, תרגום, סיכום עברי
- **Notifications:** Telegram Bot API — approval flow + channel publish
- **Deploy:** Vercel (Hobby plan — ללא crons, משתמשים ב-cron-job.org)
- **Crons:** cron-job.org — POST /api/ingest ו-/api/analyze כל שעה

---

## Pipeline
```
cron-job.org (כל שעה)
  → POST /api/ingest   — אוסף RSS → raw_articles (processed=false)
  → POST /api/analyze  — לוקח 5 מגוונים → Claude → articles → Telegram
  → בוט: ✅ approve → publishToChannel(@nofomo_ai)
                ❌ reject → מסמן rejected
```

---

## קבצים מרכזיים

| קובץ | תפקיד |
|------|--------|
| `lib/sources.ts` | 110+ מקורות עם RSS, tier, credit |
| `lib/claude.ts` | Prompt + AnalysisResult interface |
| `lib/signal.ts` | Signal Score algorithm (0-100) |
| `lib/telegram.ts` | sendApprovalMessage + publishToChannel |
| `lib/supabase.ts` | Supabase client |
| `app/api/ingest/route.ts` | RSS collection → raw_articles |
| `app/api/analyze/route.ts` | Claude analysis → articles + Telegram |
| `app/api/approve/route.ts` | Telegram webhook — ✅/❌ buttons |

---

## DB Tables (Supabase)
- `raw_articles` — ידיעות גולמיות מ-RSS (processed: bool)
- `articles` — ידיעות מנותחות עם כל שדות Claude
- `approval_queue` — תור אישור עם telegram_message_id
- `sources` — (לא בשימוש עדיין, מוגדר ב-sources.ts)

---

## הגדרות חשובות

**Authorization:** כל API endpoint דורש `Authorization: Bearer CRON_SECRET`  
**CRON_SECRET:** `nofomo-secret-2024`  
**Telegram Webhook:** רשום ל-`https://nofomo-ai.vercel.app/api/approve`

**לבדיקה מקומית:**
```powershell
# שרת
npm run dev

# ingest
Invoke-WebRequest -Uri "http://localhost:3000/api/ingest" -Method POST -Headers @{"Authorization"="Bearer nofomo-secret-2024"} -UseBasicParsing | Select-Object -ExpandProperty Content

# analyze
Invoke-WebRequest -Uri "http://localhost:3000/api/analyze" -Method POST -Headers @{"Authorization"="Bearer nofomo-secret-2024"} -UseBasicParsing | Select-Object -ExpandProperty Content
```

---

## מצב נוכחי

### עובד ✅
- Pipeline end-to-end (ingest → analyze → Telegram → approve → channel)
- מגוון מקורות (max 2 מאותו source_id ב-analyze)
- arXiv מוגבל ל-2 פריטים לריצה (לא מציף)
- Preprint warning ב-Telegram לארXiv/PapersWithCode
- Signal Score בעל משקלים מאוזנים
- עיצוב Telegram עם blockquote + bold headers

### feeds שבורים (ידועים) ❌
- anthropic-blog: אין RSS רשמי
- mistral-blog: אין RSS רשמי
- xai-blog: 404
- cohere-blog: לא RSS סטנדרטי
- langchain-blog: 404
- the-batch: 404
- bens-bites: 404
- papers-with-code: XML encoding שגוי
- reddit-*: 403 חסום
- hacker-news-ai: timeout לפעמים

### עדיין חסר 🔜
- Web UI (feed page לציבור)
- ✏️ edit flow בטלגרם
- Cross-reference (כמה מקורות כיסו אותו item)
- Email newsletter (Resend)
- דף ארכיון / מכונת זמן

---

## טיפים חשובים
- **Simon Willison** כותב גם על דברים לא-AI — לשקול הסרה או סינון
- **analyze** מביא 30 ידיעות, מסנן max 2 מאותו מקור, לוקח 5 — כדי להבטיח גיוון
- **cutoff:** analyze מעבד רק ידיעות מ-48 השעות האחרונות
- **Telegram blockquote** — bottom_line מוצג כ-blockquote (נראה יפה)
- הבוט צריך להיות **Admin** בערוץ @nofomo_ai כדי שפרסום יעבוד
