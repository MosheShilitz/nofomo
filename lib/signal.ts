/**
 * Signal Score Algorithm (0–100)
 * מחשב עד כמה ידיעה "חשובה" לפי מספר פרמטרים
 */

export interface SignalParams {
  sourceCount: number       // כמה מקורות כיסו את הידיעה
  isFirstTier1: boolean     // האם המקור הראשון הוא Tier-1
  socialScore: number       // HN points + Reddit upvotes + RT count (0–1000+)
  expertReactions: number   // כמה חשבונות מהרשימה שלנו ציינו את זה (0–10)
  velocityMinutes: number   // כמה מהר הגיעה ל-3 מקורות (פחות = חזק יותר)
  impactScore: number       // impact_score מ-Claude (1–5)
}

export function calcSignalScore(p: SignalParams): number {
  // רכיב 1: כמות מקורות (max 25)
  const sourcePts = Math.min(p.sourceCount * 5, 25)

  // רכיב 2: Tier-1 bonus (max 10)
  const tier1Pts = p.isFirstTier1 ? 10 : 0

  // רכיב 3: Social engagement (max 20) — log scale
  const socialPts = Math.min(Math.log10(Math.max(p.socialScore, 1)) * 8, 20)

  // רכיב 4: Expert reactions (max 20)
  const expertPts = Math.min(p.expertReactions * 5, 20)

  // רכיב 5: Velocity (max 15) — ככל שמהיר יותר, ציון גבוה יותר
  const velocityPts = p.velocityMinutes < 30
    ? 15
    : p.velocityMinutes < 120
    ? 10
    : p.velocityMinutes < 360
    ? 5
    : 0

  // רכיב 6: Impact score מ-Claude (max 10)
  const impactPts = (p.impactScore - 1) * 2.5

  const total = sourcePts + tier1Pts + socialPts + expertPts + velocityPts + impactPts
  return Math.round(Math.min(total, 100))
}

export function getSignalLabel(score: number): "breaking" | "major" | "noteworthy" | "normal" {
  if (score >= 80) return "breaking"
  if (score >= 60) return "major"
  if (score >= 40) return "noteworthy"
  return "normal"
}

export const SIGNAL_EMOJI: Record<string, string> = {
  breaking: "🔴",
  major: "🟠",
  noteworthy: "🟡",
  normal: "⚪",
}
