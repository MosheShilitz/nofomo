"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import Link from "next/link"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Article {
  id: string
  title_he: string
  title_en: string | null
  bottom_line: string | null
  what_happened: string
  why_matters: string
  the_problem: string | null
  the_solution: string | null
  summary_he: string | null
  category: string
  signal_score: number
  signal_label: string
  impact_score: number
  who_affected: string[]
  use_cases: string[]
  source_id: string
  original_url: string
  published_at: string
}

// ─── Data maps ────────────────────────────────────────────────────────────────

const SIG: Record<string, { label: string; color: string; bg: string }> = {
  breaking:   { label: "BREAKING", color: "oklch(50% 0.21 25)",  bg: "oklch(97.5% 0.018 25)"  },
  major:      { label: "חשוב",     color: "oklch(48% 0.16 65)",  bg: "oklch(97.5% 0.016 65)"  },
  noteworthy: { label: "מעניין",   color: "oklch(50% 0.21 280)", bg: "oklch(97.5% 0.012 280)" },
  normal:     { label: "עדכון",    color: "oklch(50% 0.01 260)", bg: "oklch(97.5% 0.004 260)" },
}

const CAT: Record<string, { label: string; color: string }> = {
  LLMs:        { label: "LLMs",        color: "oklch(50% 0.21 280)" },
  tools:       { label: "כלים",        color: "oklch(46% 0.16 160)" },
  research:    { label: "מחקר",        color: "oklch(48% 0.19 300)" },
  safety:      { label: "בטיחות",      color: "oklch(50% 0.21 25)"  },
  robotics:    { label: "רובוטיקה",    color: "oklch(48% 0.2 310)"  },
  vision:      { label: "Vision",      color: "oklch(48% 0.2 340)"  },
  audio:       { label: "Audio",       color: "oklch(48% 0.16 65)"  },
  agents:      { label: "Agents",      color: "oklch(49% 0.19 245)" },
  open_source: { label: "Open Source", color: "oklch(45% 0.17 155)" },
  business:    { label: "עסקי",        color: "oklch(49% 0.18 50)"  },
  hardware:    { label: "Hardware",    color: "oklch(46% 0.01 260)"  },
  policy:      { label: "מדיניות",     color: "oklch(48% 0.2 310)"  },
}

const WHO: Record<string, string> = {
  developers: "מפתחים", business: "עסקים",
  consumers: "צרכנים", researchers: "חוקרים", policymakers: "מדיניות",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("he-IL", {
    timeZone: "Asia/Jerusalem", day: "numeric", month: "long", year: "numeric",
  })

const timeAgo = (d: string) => {
  const diff = Date.now() - new Date(d).getTime()
  const h = Math.floor(diff / 3600000)
  const m = Math.floor(diff / 60000)
  if (m < 2) return "עכשיו"
  if (m < 60) return `לפני ${m} ד׳`
  if (h < 24) return `לפני ${h} ש׳`
  const days = Math.floor(h / 24)
  if (days === 1) return "אתמול"
  if (days < 7) return `לפני ${days} ימים`
  return new Date(d).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "short" })
}

const getFrom = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - (n + 1) * 7)
  return d.toISOString().slice(0, 10)
}

const weekLabel = (n: number) => {
  if (n === 0) return "השבוע"
  if (n === 1) return "שבוע שעבר"
  if (n === 2) return "שבועיים"
  if (n === 4) return "חודש"
  if (n === 8) return "חודשיים"
  const d = new Date(); d.setDate(d.getDate() - n * 7)
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "short" })
}

const WEEKS = [0, 1, 2, 4, 8, 12, 16]

// ─── Icons ────────────────────────────────────────────────────────────────────

const IcoX = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12"/>
  </svg>
)
const IcoExternal = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/>
  </svg>
)
const IcoSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>
)
const IcoClock = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
)

// ─── Signal Badge ─────────────────────────────────────────────────────────────

function SigBadge({ score, label }: { score: number; label: string }) {
  const s = SIG[label] ?? SIG.normal
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: s.bg, borderRadius: 20,
      padding: "4px 12px 4px 10px",
      fontFamily: "'Rubik', sans-serif",
      fontSize: 13, fontWeight: 600,
      color: s.color,
      letterSpacing: "0.01em", flexShrink: 0,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flexShrink: 0 }} aria-hidden="true" />
      {s.label}
      <span style={{ fontWeight: 500, opacity: 0.7, fontSize: 12 }}>· {score}</span>
    </span>
  )
}

// ─── Ticker ───────────────────────────────────────────────────────────────────

function Ticker({ articles }: { articles: Article[] }) {
  const items = [...articles.slice(0, 8), ...articles.slice(0, 8)]
  return (
    <div style={{
      background: "oklch(16% 0.012 260)", height: 34,
      display: "flex", alignItems: "center", overflow: "hidden",
    }}>
      <div style={{
        flexShrink: 0, padding: "0 16px",
        fontFamily: "'Rubik', sans-serif",
        fontSize: 10, fontWeight: 700, letterSpacing: "0.22em",
        color: "oklch(50% 0.21 25)",
        borderLeft: "1px solid oklch(25% 0.01 260)",
        height: "100%", display: "flex", alignItems: "center",
      }}>LIVE</div>
      <div style={{ overflow: "hidden", flex: 1 }}>
        <div style={{ display: "flex", gap: 48, whiteSpace: "nowrap", animation: "ticker 55s linear infinite" }}>
          {items.map((a, i) => {
            const sig = SIG[a.signal_label] ?? SIG.normal
            return (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "'Rubik', sans-serif", fontSize: 12, color: "oklch(68% 0.008 255)" }}>
                <span style={{ fontWeight: 700, color: sig.color }}>{a.signal_score}</span>
                {a.title_he}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

function Drawer({ article, onClose }: { article: Article; onClose: () => void }) {
  const sig = SIG[article.signal_label] ?? SIG.normal
  const cat = CAT[article.category]

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", h)
    document.body.style.overflow = "hidden"
    return () => { document.removeEventListener("keydown", h); document.body.style.overflow = "" }
  }, [onClose])

  const sections: { key: keyof Article; label: string }[] = [
    { key: "what_happened", label: "מה קרה" },
    { key: "the_problem",   label: "הבעיה שפתרו" },
    { key: "the_solution",  label: "הפתרון" },
    { key: "why_matters",   label: "למה זה חשוב" },
    { key: "summary_he",    label: "סיכום מורחב" },
  ]

  return (
    <div
      onClick={onClose}
      role="dialog" aria-modal="true" aria-label={article.title_he}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "oklch(20% 0.01 260 / 0.35)",
        backdropFilter: "blur(6px)",
        display: "flex", justifyContent: "flex-start",
        animation: "ovIn 0.2s ease",
      }}
    >
      <aside
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(680px, 100vw)", height: "100vh",
          background: "oklch(99.5% 0.004 255)",
          display: "flex", flexDirection: "column",
          boxShadow: "4px 0 32px oklch(20% 0.01 260 / 0.12)",
          animation: "drIn 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 24px", borderBottom: "1px solid oklch(91% 0.005 255)",
          display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
        }}>
          <SigBadge score={article.signal_score} label={article.signal_label} />
          {cat && (
            <span style={{
              fontFamily: "'Rubik', sans-serif",
              fontSize: 12, fontWeight: 600, color: cat.color,
              background: cat.color.replace("oklch(", "oklch(").replace("%)", "% / 0.1)"),
              padding: "3px 10px", borderRadius: 20,
            }}>{cat.label}</span>
          )}
          <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 13, color: "var(--t3)", marginRight: "auto" }}>
            {fmtDate(article.published_at)}
          </span>
          <button onClick={onClose} aria-label="סגור" style={{
            width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
            background: "oklch(95% 0.005 255)", border: "none",
            borderRadius: 10, cursor: "pointer", color: "var(--t2)",
            transition: "background 0.15s, color 0.15s",
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "oklch(16% 0.012 260)"; (e.currentTarget as HTMLElement).style.color = "white" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "oklch(95% 0.005 255)"; (e.currentTarget as HTMLElement).style.color = "var(--t2)" }}
          ><IcoX /></button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "32px 28px 80px", direction: "rtl" }}>
          <h1 style={{
            fontFamily: "'Rubik', sans-serif",
            fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 800,
            color: "var(--t1)", lineHeight: 1.3, marginBottom: 20,
          }}>{article.title_he}</h1>

          {article.bottom_line && (
            <p style={{
              fontFamily: "'Rubik', sans-serif",
              fontSize: 18, fontStyle: "italic", fontWeight: 400,
              color: "var(--t2)", lineHeight: 1.75,
              background: sig.bg, borderRadius: 12,
              padding: "16px 20px", marginBottom: 28,
            }}>{article.bottom_line}</p>
          )}

          {/* Score */}
          <div style={{
            display: "flex", gap: 28, padding: "18px 22px",
            background: "oklch(97% 0.006 255)", borderRadius: 14,
            marginBottom: 32, border: "1px solid oklch(91% 0.005 255)",
          }}>
            <div>
              <div style={{ fontFamily: "'Rubik', sans-serif", fontSize: 11, fontWeight: 600, color: "var(--t3)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
                Signal Score
              </div>
              <div style={{ fontFamily: "'Rubik', sans-serif", fontSize: 36, fontWeight: 800, color: sig.color, lineHeight: 1 }}>
                {article.signal_score}
                <span style={{ fontSize: 15, fontWeight: 400, color: "var(--t3)" }}>/100</span>
              </div>
            </div>
            <div style={{ width: 1, background: "oklch(91% 0.005 255)" }} />
            <div>
              <div style={{ fontFamily: "'Rubik', sans-serif", fontSize: 11, fontWeight: 600, color: "var(--t3)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
                Impact
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} style={{ width: 22, height: 8, borderRadius: 4, background: i < article.impact_score ? sig.color : "oklch(91% 0.005 255)" }} />
                ))}
              </div>
            </div>
          </div>

          {/* Content sections */}
          {sections.map(({ key, label }) => {
            const val = article[key] as string | null
            if (!val) return null
            return (
              <div key={key} style={{ marginBottom: 26 }}>
                <div style={{
                  fontFamily: "'Rubik', sans-serif",
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.16em",
                  textTransform: "uppercase", color: "var(--t3)",
                  marginBottom: 10, display: "flex", alignItems: "center", gap: 10,
                }}>
                  {label}
                  <span style={{ flex: 1, height: 1, background: "oklch(91% 0.005 255)" }} />
                </div>
                <p style={{ fontFamily: "'Rubik', sans-serif", fontSize: 16, color: "var(--t2)", lineHeight: 1.85, fontWeight: 400 }}>
                  {val}
                </p>
              </div>
            )
          })}

          {article.who_affected?.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontFamily: "'Rubik', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--t3)", marginBottom: 10 }}>
                על מי משפיע
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {article.who_affected.map(w => (
                  <span key={w} style={{
                    padding: "5px 14px", background: "oklch(97% 0.006 255)",
                    border: "1px solid oklch(91% 0.005 255)", borderRadius: 20,
                    fontFamily: "'Rubik', sans-serif", fontSize: 14, color: "var(--t2)",
                  }}>{WHO[w] ?? w}</span>
                ))}
              </div>
            </div>
          )}

          {article.use_cases?.length > 0 && (
            <div style={{ marginBottom: 36 }}>
              <div style={{ fontFamily: "'Rubik', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--t3)", marginBottom: 12 }}>
                שימושים מעשיים
              </div>
              {article.use_cases.map((u, i) => (
                <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
                  <span style={{ color: "var(--accent)", fontWeight: 700, marginTop: 1, flexShrink: 0 }}>›</span>
                  <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 15, color: "var(--t2)", lineHeight: 1.6 }}>{u}</span>
                </div>
              ))}
            </div>
          )}

          <a href={article.original_url} target="_blank" rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%", padding: "16px",
              background: "var(--accent)", color: "oklch(99% 0 0)",
              textDecoration: "none", borderRadius: 14,
              fontFamily: "'Rubik', sans-serif", fontSize: 16, fontWeight: 700,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.9" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1" }}
          >
            קרא את הידיעה המלאה
            <IcoExternal />
          </a>
        </div>
      </aside>
    </div>
  )
}

// ─── Hero Card ────────────────────────────────────────────────────────────────

function HeroCard({ a, onClick }: { a: Article; onClick: () => void }) {
  const sig = SIG[a.signal_label] ?? SIG.normal
  const cat = CAT[a.category]
  const [hov, setHov] = useState(false)

  return (
    <article style={{
      background: "oklch(100% 0 0)",
      borderRadius: 20,
      boxShadow: hov
        ? "0 8px 32px oklch(20% 0.01 260 / 0.1), 0 0 0 1px oklch(85% 0.006 255)"
        : "0 1px 4px oklch(20% 0.01 260 / 0.06), 0 0 0 1px oklch(91% 0.005 255)",
      transition: "box-shadow 0.2s ease, transform 0.2s ease",
      transform: hov ? "translateY(-2px)" : "translateY(0)",
      cursor: "pointer",
    }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <button onClick={onClick} style={{
        background: "none", border: "none", cursor: "pointer",
        textAlign: "right", width: "100%",
        padding: "32px 36px 28px",
        display: "flex", flexDirection: "column", gap: 18,
      }}>
        {/* Meta row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <SigBadge score={a.signal_score} label={a.signal_label} />
          {cat && (
            <span style={{
              fontFamily: "'Rubik', sans-serif",
              fontSize: 12, fontWeight: 600, color: cat.color,
              padding: "3px 10px", borderRadius: 20,
              background: cat.color.replace("oklch(", "oklch(").replace("%)", "% / 0.1)"),
            }}>{cat.label}</span>
          )}
          <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 13, color: "var(--t3)", marginRight: "auto" }}>
            {timeAgo(a.published_at)}
          </span>
        </div>

        {/* Headline */}
        <h2 style={{
          fontFamily: "'Rubik', sans-serif",
          fontSize: "clamp(28px, 3.5vw, 46px)", fontWeight: 800,
          color: "var(--t1)", lineHeight: 1.3, textAlign: "right",
        }}>{a.title_he}</h2>

        {/* Bottom line */}
        {a.bottom_line && (
          <p style={{
            fontFamily: "'Rubik', sans-serif",
            fontSize: "clamp(16px, 1.8vw, 20px)", fontWeight: 400,
            color: "var(--t2)", lineHeight: 1.75, textAlign: "right",
          }}>{a.bottom_line}</p>
        )}

        {/* Excerpt */}
        {a.what_happened && (
          <p style={{
            fontFamily: "'Rubik', sans-serif",
            fontSize: 15, color: "var(--t3)", lineHeight: 1.75, textAlign: "right",
          }}>
            {a.what_happened.slice(0, 200) + (a.what_happened.length > 200 ? "…" : "")}
          </p>
        )}

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          paddingTop: 18, borderTop: "1px solid oklch(94% 0.005 255)",
        }}>
          {a.who_affected?.slice(0, 3).map(w => (
            <span key={w} style={{
              padding: "4px 12px",
              background: "oklch(97% 0.006 255)",
              border: "1px solid oklch(91% 0.005 255)",
              borderRadius: 20, fontSize: 13, color: "var(--t2)",
              fontFamily: "'Rubik', sans-serif",
            }}>{WHO[w] ?? w}</span>
          ))}
          <span style={{ marginRight: "auto", fontFamily: "'Rubik', sans-serif", fontSize: 15, fontWeight: 600, color: "var(--accent)" }}>
            קרא עוד ←
          </span>
        </div>
      </button>
    </article>
  )
}

// ─── Feature Card ─────────────────────────────────────────────────────────────

function FeatureCard({ a, onClick }: { a: Article; onClick: () => void }) {
  const sig = SIG[a.signal_label] ?? SIG.normal
  const cat = CAT[a.category]
  const [hov, setHov] = useState(false)

  return (
    <article style={{
      background: "oklch(100% 0 0)",
      borderRadius: 16,
      boxShadow: hov
        ? "0 6px 24px oklch(20% 0.01 260 / 0.09), 0 0 0 1px oklch(85% 0.006 255)"
        : "0 1px 4px oklch(20% 0.01 260 / 0.05), 0 0 0 1px oklch(91% 0.005 255)",
      transition: "box-shadow 0.2s ease, transform 0.2s ease",
      transform: hov ? "translateY(-2px)" : "translateY(0)",
      cursor: "pointer",
      display: "flex", flexDirection: "column",
    }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <button onClick={onClick} style={{
        background: "none", border: "none", cursor: "pointer",
        textAlign: "right", width: "100%",
        padding: "22px 24px 20px",
        display: "flex", flexDirection: "column", gap: 12, flex: 1,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <SigBadge score={a.signal_score} label={a.signal_label} />
          {cat && (
            <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 12, fontWeight: 600, color: cat.color }}>
              {cat.label}
            </span>
          )}
          <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 12, color: "var(--t3)", marginRight: "auto" }}>
            {timeAgo(a.published_at)}
          </span>
        </div>

        <h3 style={{
          fontFamily: "'Rubik', sans-serif",
          fontSize: "clamp(18px, 2.2vw, 22px)", fontWeight: 700,
          color: "var(--t1)", lineHeight: 1.4, textAlign: "right",
        }}>{a.title_he}</h3>

        {(a.bottom_line ?? a.what_happened) && (
          <p style={{
            fontFamily: "'Rubik', sans-serif", fontSize: 14, color: "var(--t2)",
            lineHeight: 1.75, textAlign: "right",
          }}>
            {(a.bottom_line ?? a.what_happened ?? "").slice(0, 130) + "…"}
          </p>
        )}

        {/* Score bar at bottom */}
        <div style={{
          marginTop: "auto", paddingTop: 14,
          borderTop: "1px solid oklch(94% 0.005 255)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ flex: 1, height: 3, background: "oklch(93% 0.005 255)", borderRadius: 2 }}>
            <div style={{ width: `${a.signal_score}%`, height: "100%", background: sig.color, borderRadius: 2 }} />
          </div>
          <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 12, fontWeight: 700, color: sig.color, flexShrink: 0 }}>
            {a.signal_score}
          </span>
        </div>
      </button>
    </article>
  )
}

// ─── Compact Card ─────────────────────────────────────────────────────────────

function CompactCard({ a, onClick }: { a: Article; onClick: () => void }) {
  const sig = SIG[a.signal_label] ?? SIG.normal
  const cat = CAT[a.category]
  const [hov, setHov] = useState(false)

  return (
    <article style={{
      background: "oklch(100% 0 0)",
      borderRadius: 14,
      boxShadow: hov
        ? "0 4px 18px oklch(20% 0.01 260 / 0.08), 0 0 0 1px oklch(85% 0.006 255)"
        : "0 1px 3px oklch(20% 0.01 260 / 0.04), 0 0 0 1px oklch(91% 0.005 255)",
      transition: "box-shadow 0.18s ease, transform 0.18s ease",
      transform: hov ? "translateY(-1px)" : "translateY(0)",
      cursor: "pointer",
    }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <button onClick={onClick} style={{
        background: "none", border: "none", cursor: "pointer",
        textAlign: "right", width: "100%",
        padding: "16px 18px",
        display: "flex", alignItems: "flex-start", gap: 14,
      }}>
        {/* Score pillar */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 2 }}>
          <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 20, fontWeight: 800, lineHeight: 1, color: sig.color }}>
            {a.signal_score}
          </span>
          <div style={{ width: 2, height: 30, borderRadius: 1, background: sig.color, opacity: 0.2 }} />
        </div>

        {/* Text */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {cat && (
              <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 11, fontWeight: 600, color: cat.color }}>
                {cat.label}
              </span>
            )}
            <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 11, color: "var(--t3)" }}>
              {timeAgo(a.published_at)}
            </span>
          </div>
          <h3 style={{
            fontFamily: "'Rubik', sans-serif",
            fontSize: "clamp(14px, 1.4vw, 16px)", fontWeight: 700,
            lineHeight: 1.45, color: "var(--t1)", textAlign: "right",
          }}>{a.title_he}</h3>
        </div>
      </button>
    </article>
  )
}

// ─── Archive Row ──────────────────────────────────────────────────────────────

function ArchiveRow({ a, onClick }: { a: Article; onClick: () => void }) {
  const sig = SIG[a.signal_label] ?? SIG.normal
  const cat = CAT[a.category]
  const [hov, setHov] = useState(false)

  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "13px 20px", borderBottom: "1px solid oklch(94% 0.005 255)",
        cursor: "pointer",
        background: hov ? "oklch(98% 0.006 255)" : "transparent",
        transition: "background 0.12s",
      }}
    >
      <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 14, fontWeight: 700, color: sig.color, flexShrink: 0, minWidth: 32, textAlign: "center" }}>
        {a.signal_score}
      </span>
      <div style={{ width: 40, height: 3, background: "oklch(91% 0.005 255)", borderRadius: 2, flexShrink: 0 }}>
        <div style={{ width: `${a.signal_score}%`, height: "100%", background: sig.color, borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 15, fontWeight: 600, color: "var(--t1)", flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {a.title_he}
      </span>
      {cat && (
        <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 12, fontWeight: 600, color: cat.color, flexShrink: 0 }}>
          {cat.label}
        </span>
      )}
      <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 13, color: "var(--t3)", flexShrink: 0 }}>
        {timeAgo(a.published_at)}
      </span>
    </div>
  )
}

// ─── Loading / Empty ──────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "120px 0" }} role="status">
      <div style={{ width: 32, height: 32, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 15, color: "var(--t3)" }}>טוען ידיעות...</span>
    </div>
  )
}

function Empty({ query }: { query: string }) {
  return (
    <div style={{ textAlign: "center", padding: "120px 0" }}>
      <p style={{ fontFamily: "'Rubik', sans-serif", fontSize: 20, color: "var(--t2)", fontWeight: 500 }}>
        {query ? `אין תוצאות עבור "${query}"` : "אין ידיעות בתקופה זו"}
      </p>
    </div>
  )
}

// ─── Section Divider ──────────────────────────────────────────────────────────

function SectionDivider({ label, count }: { label: string; count?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
      <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 13, fontWeight: 600, color: "var(--t3)", letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {count !== undefined && (
        <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 13, color: "var(--t3)" }}>
          {count} ידיעות
        </span>
      )}
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ArchivePage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading]   = useState(true)
  const [cat, setCat]           = useState<string | null>(null)
  const [week, setWeek]         = useState(0)
  const [q, setQ]               = useState("")
  const [selected, setSelected] = useState<Article | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const p = new URLSearchParams({ limit: "200", from: getFrom(week) })
    if (cat) p.set("category", cat)
    fetch(`/api/articles?${p}`)
      .then(r => r.json())
      .then(d => { if (alive) { setArticles(d.articles ?? []); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [cat, week])

  const filtered = useMemo(() => {
    if (!q.trim()) return articles
    const s = q.toLowerCase()
    return articles.filter(a =>
      (a.title_he ?? "").toLowerCase().includes(s) ||
      (a.what_happened ?? "").toLowerCase().includes(s) ||
      (a.title_en ?? "").toLowerCase().includes(s)
    )
  }, [articles, q])

  const usedCats = useMemo(() =>
    [...new Set(articles.map(a => a.category))].filter(Boolean), [articles])

  const closeDrawer = useCallback(() => setSelected(null), [])

  // Layout split: hero → featured 2-up → compact grid → archive rows
  const hero     = filtered[0] ?? null
  const featured = filtered.slice(1, 3)
  const compact  = filtered.slice(3, 9)
  const rows     = filtered.slice(9)

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault(); inputRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700;800;900&display=swap');

        :root {
          --bg:     oklch(97% 0.006 255);
          --surface:oklch(100% 0 0);
          --border: oklch(91% 0.005 255);
          --t1:     oklch(16% 0.012 260);
          --t2:     oklch(44% 0.012 260);
          --t3:     oklch(62% 0.008 255);
          --accent: oklch(50% 0.21 280);
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { -webkit-text-size-adjust: 100%; }
        body {
          background: var(--bg) !important;
          color: var(--t1) !important;
          direction: rtl !important;
          font-family: 'Rubik', sans-serif !important;
          min-height: 100vh !important;
          -webkit-font-smoothing: antialiased;
        }

        @keyframes ovIn   { from { opacity: 0; }                  to { opacity: 1; } }
        @keyframes drIn   { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes ticker { from { transform: translateX(0); }     to { transform: translateX(-50%); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        button:focus-visible, a:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 3px;
          border-radius: 8px;
        }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: oklch(85% 0.006 255); border-radius: 3px; }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation: none !important; transition: none !important; }
        }

        .hscroll { overflow-x: auto; scrollbar-width: none; }
        .hscroll::-webkit-scrollbar { display: none; }

        .week-tab {
          font-family: 'Rubik', sans-serif;
          font-size: 14px;
          background: none; border: none; cursor: pointer;
          padding: 0 18px; height: 50px; white-space: nowrap;
          color: var(--t3); transition: color 0.15s;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px; font-weight: 500;
          display: flex; align-items: center; gap: 6px;
        }
        .week-tab:hover { color: var(--t2); }
        .week-tab.on { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }

        .cat-btn {
          font-family: 'Rubik', sans-serif;
          font-size: 13px; font-weight: 500;
          padding: 6px 16px; border-radius: 20px;
          border: 1.5px solid var(--border);
          background: none; cursor: pointer;
          white-space: nowrap;
          color: var(--t3); transition: all 0.15s;
        }
        .cat-btn:hover { border-color: oklch(80% 0.008 255); color: var(--t2); }
        .cat-btn.on { background: var(--accent); border-color: var(--accent); color: oklch(99% 0 0); }

        .nav-link {
          font-family: 'Rubik', sans-serif;
          font-size: 14px; font-weight: 500;
          color: var(--t3); text-decoration: none;
          padding: 6px 14px; border-radius: 8px;
          transition: color 0.15s, background 0.15s;
        }
        .nav-link:hover { color: var(--t1); background: oklch(95% 0.006 255); }
        .nav-link.active { color: var(--t1); font-weight: 600; }

        .featured-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }
        .compact-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 12px;
        }
        @media (max-width: 768px) {
          .featured-grid { grid-template-columns: 1fr; }
          .compact-grid  { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg)", direction: "rtl" }}>

        {/* ── TICKER ── */}
        {!loading && articles.length > 0 && <Ticker articles={articles} />}

        {/* ── HEADER ── */}
        <header style={{
          background: "oklch(100% 0 0)",
          borderBottom: "1px solid var(--border)",
          position: "sticky", top: 0, zIndex: 30,
        }}>
          <div style={{ maxWidth: 1360, margin: "0 auto", padding: "0 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20, height: 64 }}>

              {/* Brand */}
              <Link href="/" style={{ textDecoration: "none", flexShrink: 0 }}>
                <span style={{
                  fontFamily: "'Rubik', sans-serif",
                  fontSize: 22, fontWeight: 900,
                  color: "var(--t1)", letterSpacing: "-0.03em",
                }}>
                  NO‑FOMO<span style={{ color: "var(--accent)" }}>.</span>AI
                </span>
              </Link>

              {/* Nav */}
              <nav style={{ display: "flex", gap: 2, alignItems: "center" }} aria-label="ניווט">
                <Link href="/" className="nav-link">פיד</Link>
                <a href="/archive" className="nav-link active">ארכיון</a>
              </nav>

              <div style={{ flex: 1 }} />

              {/* Count */}
              {!loading && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <IcoClock />
                  <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 14, fontWeight: 600, color: "var(--t2)" }}>
                    מכונת הזמן
                  </span>
                  <span style={{
                    fontFamily: "'Rubik', sans-serif", fontSize: 13, color: "var(--t3)",
                    background: "var(--bg)", border: "1px solid var(--border)",
                    padding: "3px 10px", borderRadius: 20,
                  }}>
                    {filtered.length} ידיעות
                  </span>
                </div>
              )}

              {/* Telegram */}
              <a href="https://t.me/nofomo_ai" target="_blank" rel="noopener noreferrer"
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  background: "#229ED9", color: "oklch(99% 0 0)",
                  padding: "9px 18px", borderRadius: 24,
                  textDecoration: "none", flexShrink: 0,
                  fontFamily: "'Rubik', sans-serif", fontSize: 14, fontWeight: 600,
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.85" }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                </svg>
                הצטרפו לערוץ
              </a>
            </div>
          </div>
        </header>

        {/* ── FILTER BAR ── */}
        <div style={{
          background: "oklch(100% 0 0)",
          borderBottom: "1px solid var(--border)",
          position: "sticky", top: 64, zIndex: 20,
        }}>
          <div style={{ maxWidth: 1360, margin: "0 auto", padding: "0 28px" }}>
            <div style={{ display: "flex", alignItems: "center", minHeight: 50 }}>

              {/* Week tabs */}
              <nav className="hscroll" style={{ display: "flex", borderLeft: "1px solid var(--border)" }} aria-label="בחירת תקופה">
                {WEEKS.map(w => (
                  <button key={w} className={`week-tab ${week === w ? "on" : ""}`}
                    onClick={() => setWeek(w)} aria-pressed={week === w}>
                    {weekLabel(w)}
                  </button>
                ))}
              </nav>

              <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0, margin: "0 12px" }} />

              {/* Categories */}
              <div className="hscroll" style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, overflow: "auto" }}>
                <button className={`cat-btn ${!cat ? "on" : ""}`} onClick={() => setCat(null)}>הכל</button>
                {usedCats.map(c => {
                  const info = CAT[c]
                  return (
                    <button key={c} className={`cat-btn ${cat === c ? "on" : ""}`}
                      onClick={() => setCat(cat === c ? null : c)}
                      style={cat !== c && info ? { color: info.color, borderColor: info.color.replace("oklch(", "oklch(").replace("%)", "% / 0.4)") } : {}}
                    >{info?.label ?? c}</button>
                  )
                })}
              </div>

              <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0, margin: "0 12px" }} />

              {/* Search */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--t3)", display: "flex", flexShrink: 0 }}><IcoSearch /></span>
                <input
                  ref={inputRef}
                  type="search" placeholder="חיפוש..." value={q}
                  onChange={e => setQ(e.target.value)} dir="rtl"
                  aria-label="חיפוש בארכיון"
                  style={{
                    background: "none", border: "none", outline: "none",
                    fontFamily: "'Rubik', sans-serif", fontSize: 14,
                    color: "var(--t1)", width: 140,
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── MAIN ── */}
        <main style={{ maxWidth: 1360, margin: "0 auto", padding: "28px 28px 100px" }} aria-label="ארכיון ידיעות">

          {loading ? (
            <Spinner />
          ) : filtered.length === 0 ? (
            <Empty query={q} />
          ) : (
            <div style={{ animation: "fadeUp 0.35s cubic-bezier(0.22, 1, 0.36, 1)", display: "flex", flexDirection: "column", gap: 32 }}>

              {/* Hero */}
              {hero && (
                <section aria-label="ידיעה מובילה">
                  <SectionDivider label="ידיעה מובילה" />
                  <HeroCard a={hero} onClick={() => setSelected(hero)} />
                </section>
              )}

              {/* Featured 2-up */}
              {featured.length > 0 && (
                <section aria-label="ידיעות בולטות">
                  <SectionDivider label="ידיעות בולטות" />
                  <div className="featured-grid">
                    {featured.map(a => <FeatureCard key={a.id} a={a} onClick={() => setSelected(a)} />)}
                  </div>
                </section>
              )}

              {/* Compact grid */}
              {compact.length > 0 && (
                <section aria-label="עוד ידיעות">
                  <SectionDivider label="עוד מהתקופה" />
                  <div className="compact-grid">
                    {compact.map(a => <CompactCard key={a.id} a={a} onClick={() => setSelected(a)} />)}
                  </div>
                </section>
              )}

              {/* Archive rows */}
              {rows.length > 0 && (
                <section aria-label="כל הידיעות">
                  <SectionDivider label="ארכיון" count={rows.length} />
                  <div style={{
                    background: "oklch(100% 0 0)",
                    borderRadius: 16,
                    boxShadow: "0 1px 4px oklch(20% 0.01 260 / 0.05), 0 0 0 1px var(--border)",
                    overflow: "hidden",
                  }}>
                    {rows.map(a => <ArchiveRow key={a.id} a={a} onClick={() => setSelected(a)} />)}
                  </div>
                </section>
              )}
            </div>
          )}
        </main>

        {/* ── FOOTER ── */}
        <footer style={{ background: "oklch(100% 0 0)", borderTop: "1px solid var(--border)", padding: "20px 28px" }}>
          <div style={{ maxWidth: 1360, margin: "0 auto", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 17, fontWeight: 900, color: "var(--t1)", letterSpacing: "-0.02em" }}>
              NO‑FOMO<span style={{ color: "var(--accent)" }}>.</span>AI
            </span>
            <span style={{ fontFamily: "'Rubik', sans-serif", fontSize: 13, color: "var(--t3)" }}>ארכיון ידיעות AI</span>
            <div style={{ flex: 1 }} />
            <a href="https://t.me/nofomo_ai" target="_blank" rel="noopener noreferrer"
              style={{ fontFamily: "'Rubik', sans-serif", fontSize: 13, color: "var(--t3)", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#229ED9" }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--t3)" }}
            >@nofomo_ai</a>
          </div>
        </footer>

        {/* DRAWER */}
        {selected && <Drawer article={selected} onClose={closeDrawer} />}
      </div>
    </>
  )
}
