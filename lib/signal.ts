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
  // בסיס: כל ידיעה שעברה ניתוח Claude מקבלת 15 נקודות
  const basePts = 15

  // רכיב 1: Impact score מ-Claude (max 45) — המדד הכי אמין שיש לנו
  const impactPts = (p.impactScore - 1) * 11.25  // 1→0, 2→11, 3→22, 4→34, 5→45

  // רכיב 2: כמות מקורות (max 15)
  const sourcePts = Math.min((p.sourceCount - 1) * 7.5, 15)

  // רכיב 3: Tier-1 bonus (max 15)
  const tier1Pts = p.isFirstTier1 ? 15 : 0

  // רכיב 4: Social engagement (max 10) — log scale
  const socialPts = Math.min(Math.log10(Math.max(p.socialScore, 1)) * 4, 10)

  // רכיב 5: Expert reactions (max 10)
  const expertPts = Math.min(p.expertReactions * 2.5, 10)

  // רכיב 6: Velocity (max 5)
  const velocityPts = p.velocityMinutes < 60 ? 5 : p.velocityMinutes < 240 ? 3 : 0

  const total = basePts + impactPts + sourcePts + tier1Pts + socialPts + expertPts + velocityPts
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
