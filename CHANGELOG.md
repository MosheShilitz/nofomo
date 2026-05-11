# Changelog

יומן שינויים של NO FOMO AI. הכי חדש למעלה. לוג מלא: `git log --oneline`.

---

## 2026-05-11 — Hardening session

### 🔐 Security
- **CRON_SECRET rotated + מחיקה מ-CLAUDE.md.** הסוד הישן `nofomo-secret-2024` היה גלוי במסמך commit-ed. כעת ב-Vercel env בלבד.
- **Telegram webhook signature verification.** `/api/approve` היה endpoint ציבורי שמקבל כל callback. כעת דורש `X-Telegram-Bot-Api-Secret-Token` תקין.

### ⚡ Performance & Cost
- **Prompt caching ב-Stage 2.** system prompt זהה ב-5 קריאות מקבילות → cache_control: ephemeral → חיסכון ~80% על input tokens.
- **שעות שקטות 23:00–06:00 IL.** `/api/ingest` ו-`/api/analyze` חוזרים מוקדם בלילה — אין קוראים, אין סיבה לבזבז טוקנים.
- **Dynamic top-N במקום 5 קבוע.** Stage 1 כעת מדרג את כל הפריטים, ה-route בוחר signal_score≥55 (max 8). יום שקט = 1-2, יום בועט = 8.

### 🎯 Quality
- **Editorial overhaul של system prompt.** voice: שיחתי-מקצועי במקום יבש/צהוב. Use-case mandate (למי זה, מה לעשות). אנטי-AI-speak (אסור "בעידן ה-AI" וכד'). דוגמאות לuse_cases טובים/רעים.
- **Pre-filter רלוונטיות AI ב-ingest.** ~40 keywords (AI/LLM/GPT/Claude/transformer/embedding/multimodal/agentic + 5 בעברית). חוסם את ה"זבל לא קשור" של Simon Willison.
- **Zod validation על תגובות Claude.** מונע DB corruption מ-`impact_score: 6` או category לא חוקי.

### 🕯️ Shabbat awareness
- שישי 16:00 IL → שבת EOD: handleApprove שומר כ-`approved_pending_shabbat` במקום לפרסם. P1 יוסיף cron מוצ"ש שיוציא automatic.

### 📝 Docs
- `CHANGELOG.md` (הקובץ הזה) — נוצר.
- `docs/SOURCES_TODO.md` — תיעוד הניסיונות לכסות מקורות ללא RSS (Twitter, Telegram channels, Anthropic news) ומה דרוש להמשך.
- `.gitignore` — `settings.local.json` של Claude Code לא נדבק יותר ל-tracking.

### ⏸️ Deferred
- **Twitter creators + Telegram channels + scraping של Anthropic/Mistral/xAI.** כל הנתיבים החינמיים חסומים. דורש self-hosted RSSHub או headless browser. תועד ב-`docs/SOURCES_TODO.md`.

---

## עד 2026-05-11

ראה `git log --oneline` עד commit `c6cba94` (sync: product updates + archive feature).
