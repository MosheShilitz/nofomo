/**
 * Calendar gating utilities — when should the pipeline / publisher be active?
 *
 * Two gates:
 *  - isQuietHours()       — silence ingest+analyze+publish overnight (23:00–06:00 IL)
 *  - isShabbatOrHoliday() — silence channel publishing during Shabbat/Yom Tov
 */

const IL_TZ = "Asia/Jerusalem"

interface IsraelTimeParts {
  hour: number
  dayOfWeek: number // 0 = Sunday, 6 = Saturday
}

function getIsraelTime(now: Date = new Date()): IsraelTimeParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: IL_TZ,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun"
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0"
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    hour: Number.parseInt(hourStr, 10),
    dayOfWeek: dayMap[weekday] ?? 0,
  }
}

/**
 * True between 23:00 and 06:00 Asia/Jerusalem.
 * Used by ingest+analyze to skip nighttime runs (no readers, wasted tokens).
 */
export function isQuietHours(now: Date = new Date()): boolean {
  const { hour } = getIsraelTime(now)
  return hour >= 23 || hour < 6
}

/**
 * Conservative Shabbat detector — true from Friday 16:00 IL through end of Saturday IL.
 *
 * No Hebcal call yet, so Yom Tov days (Rosh Hashana, Yom Kippur, Pesach, Sukkot etc.)
 * aren't covered. Documented in docs/SOURCES_TODO.md for follow-up.
 *
 * Used by handleApprove to defer channel publishing — articles get marked
 * 'approved_pending_shabbat' and a P1 cron will flush them after Shabbat ends.
 */
export function isShabbatOrHoliday(now: Date = new Date()): boolean {
  const { hour, dayOfWeek } = getIsraelTime(now)
  if (dayOfWeek === 6) return true // Saturday — all day
  if (dayOfWeek === 5 && hour >= 16) return true // Friday afternoon
  return false
}
