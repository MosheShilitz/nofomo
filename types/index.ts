export interface Article {
  id: string
  source_id: string
  original_url: string
  title_en: string | null
  title_he: string
  summary_he: string
  what_happened: string
  why_matters: string
  who_affected: string[]
  use_cases: string[]
  impact_score: 1 | 2 | 3 | 4 | 5
  signal_score: number
  signal_label: "breaking" | "major" | "noteworthy" | "normal"
  category: string
  cluster_id: string | null
  published_at: string
  indexed_at: string
  approval_status: "pending" | "approved" | "rejected"
  approved_at: string | null
}

export interface ArticleWithSource extends Article {
  source: {
    id: string
    display_name: string
    profile_url: string
    favicon_url: string
    label: string
    twitter_handle?: string
    tagline: string
  }
  cross_refs?: CrossRef[]
  who_first?: WhoFirst
}

export interface CrossRef {
  source_id: string
  source_display_name: string
  source_favicon: string
  url: string
  seen_at: string
  lag_minutes: number
}

export interface WhoFirst {
  source_id: string
  source_display_name: string
  seen_at: string
}

export interface ApprovalQueueItem {
  id: string
  article: ArticleWithSource
  telegram_message_id: number | null
  sent_at: string
}
