# Sources TODO — מה שעדיין לא מכוסה ב-pipeline

עדכון: 2026-05-11

## מקורות תיוקפים שאין להם RSS

| מקור | סטטוס | מה ניסיתי | מה צריך |
|------|--------|-----------|---------|
| **Anthropic news** | חסום | sitemap.xml זמין + רשימת `/news/` URLs; אבל ה-pages הם CSR Next.js — `og:description` ו-`meta name="description"` מחזירים default generic ("Anthropic is an AI safety company"); אין JSON-LD | Headless browser (Playwright on Vercel Edge?) או poll the API endpoint ישירות אם תמצא כזה |
| **Mistral news** | לא נבדק | — | Same flow — sitemap → individual pages → likely CSR |
| **xAI news** | לא נבדק | — | Same |
| **Cohere blog** | לא נבדק | — | Likely has RSS; need to probe |

## פלטפורמות מבוססות handle (creators)

| פלטפורמה | סטטוס | מה ניסיתי | מה צריך |
|----------|--------|-----------|---------|
| **Twitter/X creators** | חסום | Twitter API חינמי כבר לא תומך ב-read. RSSHub.app מחזיר 403. Nitter instances לרוב down. | Self-host Nitter, paid API (twitterAPI.io), או לוותר |
| **Telegram channels** | חסום | rsshub.app `/telegram/channel/{handle}` מחזיר 403 — public instance מוגבל | Self-host RSSHub, או להפוך את הבוט הקיים ל-subscriber של ערוצים → לקרוא דרך getUpdates |

## פתרון אפשרי בעתיד — Self-host RSSHub

עלות נמוכה (~$5/חודש על Railway/Fly.io), פותח גם Twitter (אם יש credentials) וגם Telegram channels.
זמן הקמה: ~2 שעות.

## פתרון נוסף — Headless scraper

Playwright + Vercel Cron Function (16MB limit). אפשרי אבל cold-start איטי.
זמן פיתוח: ~4-6 שעות לscraper גנרי + selectors per site.
