# NO-FOMO.AI — מדריך התקנה

## סדר הפעולות (כ-20 דקות)

---

## שלב 1 — Claude API Key (5 דקות)

1. כנס ל-https://console.anthropic.com
2. Sign up / Log in
3. **API Keys** → **Create Key**
4. העתק והדבק ב-`.env.local`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

---

## שלב 2 — Supabase (10 דקות)

1. כנס ל-https://supabase.com → **Start your project**
2. **New project** — בחר שם: `nofomo`
3. **Settings → API** — העתק:
   - `URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

4. **SQL Editor** — הדבק והרץ את ה-Schema הבא:

```sql
-- טבלת raw articles (לפני ניתוח)
create table raw_articles (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  original_url text unique not null,
  title_en text,
  content_raw text,
  published_at timestamptz,
  processed boolean default false,
  created_at timestamptz default now()
);

-- טבלת articles מנותחים
create table articles (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  original_url text unique not null,
  title_en text,
  title_he text not null,
  summary_he text not null,
  what_happened text not null,
  why_matters text not null,
  who_affected text[] default '{}',
  use_cases text[] default '{}',
  impact_score smallint check (impact_score between 1 and 5),
  signal_score smallint default 0,
  signal_label text default 'normal',
  category text,
  cluster_id uuid,
  published_at timestamptz,
  indexed_at timestamptz default now(),
  approval_status text default 'pending',
  approved_at timestamptz
);

-- אשכולות cross-reference
create table story_clusters (
  id uuid primary key default gen_random_uuid(),
  first_source_id text,
  first_seen_at timestamptz,
  canonical_article_id uuid references articles(id),
  article_ids uuid[] default '{}'
);

-- תור אישורים
create table approval_queue (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references articles(id) on delete cascade,
  status text default 'pending',
  telegram_message_id bigint,
  sent_at timestamptz default now(),
  decided_at timestamptz
);

-- סטטיסטיקות מקורות (leaderboard)
create table source_stats (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  period text not null,  -- week | month | all
  first_count int default 0,
  avg_lag_minutes float default 0,
  article_count int default 0,
  updated_at timestamptz default now(),
  unique(source_id, period)
);

-- ציר זמן
create table ai_timeline (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  model_or_event text not null,
  company text,
  category text,
  description_he text,
  impact_score smallint,
  article_id uuid references articles(id),
  created_at timestamptz default now()
);

-- benchmark scenarios
create table benchmark_scenarios (
  id uuid primary key default gen_random_uuid(),
  name_he text not null,
  name_en text,
  prompt text not null,
  category text,
  created_at timestamptz default now()
);

-- benchmark results
create table benchmark_results (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid references benchmark_scenarios(id),
  model_name text not null,
  model_version text,
  result_text text,
  score smallint,
  tested_at timestamptz default now()
);

-- weekly polls
create table weekly_polls (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  telegram_poll_id text,
  article_ids uuid[] default '{}',
  results jsonb default '{}',
  winner_article_id uuid references articles(id),
  closed_at timestamptz
);

-- API keys
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  key_hash text unique not null,
  tier text default 'free',
  requests_today int default 0,
  created_at timestamptz default now(),
  last_used_at timestamptz
);

-- Indexes לביצועים
create index idx_articles_approval on articles(approval_status);
create index idx_articles_published on articles(published_at desc);
create index idx_articles_signal on articles(signal_score desc);
create index idx_articles_category on articles(category);
create index idx_raw_processed on raw_articles(processed);
```

---

## שלב 3 — Telegram Bot (5 דקות)

### יצירת Bot:
1. פתח Telegram → חפש **@BotFather**
2. שלח: `/newbot`
3. שם: `NO-FOMO AI`
4. Username: `nofomo_ai_bot` (או כל שם פנוי)
5. BotFather ישלח **token** — העתק ל-`.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=123456789:ABC...
   ```

### מצא את ה-Chat ID שלך:
1. חפש **@userinfobot** בטלגרם
2. שלח כל הודעה
3. הוא יחזיר `Id: 123456789` — העתק ל-`.env.local`:
   ```
   TELEGRAM_OWNER_CHAT_ID=123456789
   ```

### יצירת ערוץ:
1. Telegram → New Channel
2. שם: `NO-FOMO AI`
3. Username: `@nofomo_ai` (או כל שם פנוי)
4. הוסף את ה-bot שלך כ-**Admin** עם הרשאת פרסום
5. ב-`.env.local`:
   ```
   TELEGRAM_CHANNEL_ID=@nofomo_ai
   ```

---

## שלב 4 — הרצה מקומית

```bash
cd "C:\Users\moshes_combix\Desktop\Claude Projects\nofomo"
npm run dev
```

פתח http://localhost:3000

---

## שלב 5 — רישום Telegram Webhook

לאחר deploy ל-Vercel, רשום את ה-webhook:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-app.vercel.app/api/approve
```

---

## בדיקה ראשונה — Pipeline מלא

```bash
# 1. הרץ ingestion (אסוף RSS)
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer <CRON_SECRET>"

# 2. הרץ analysis (Claude מנתח)
curl -X POST http://localhost:3000/api/analyze \
  -H "Authorization: Bearer <CRON_SECRET>"
```

אם הכל עובד — תקבל הודעת Telegram עם כפתורי ✅ ❌ ✏️

---

## Checklist

- [ ] `.env.local` מלא עם כל ה-keys
- [ ] Supabase schema הורץ
- [ ] Telegram bot נוצר + channel נוצר
- [ ] Bot הוסף כ-admin לערוץ
- [ ] `npm run dev` רץ
- [ ] `/api/ingest` מחזיר תוצאות
- [ ] `/api/analyze` מחזיר תוצאות
- [ ] הודעת Telegram הגיעה לנייד
