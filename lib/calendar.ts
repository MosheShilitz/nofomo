/**
 * Calendar gating utilities — when should the pipeline / publisher be active?
 *
 * Two gates:
 *  - isQuietHours()       — silence ingest+analyze+publish overnight (23:00–06:00 IL)
 *  - isShabbatOrHoliday() — silence channel publishing during Shabbat/Yom Tov
 */

const IL_TZ = "Asia/Jerusalem"

function getIsraelHour(now: Date = new Date()): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: IL_TZ,
    hour: "numeric",
    hour12: false,
  }).format(now)
  return Number.parseInt(formatted, 10)
}

/**
 * True between 23:00 and 06:00 Asia/Jerusalem.
 * Used by ingest+analyze to skip nighttime runs (no readers, wasted tokens).
 */
export function isQuietHours(now: Date = new Date()): boolean {
  const hour = getIsraelHour(now)
  return hour >= 23 || hour < 6
}

/**
 * Placeholder — wired in P0 #10 (Shabbat awareness).
 * Will call Hebcal API to detect Shabbat/Yom Tov in IL timezone.
 */
export function isShabbatOrHoliday(_now: Date = new Date()): boolean {
  return false
}
