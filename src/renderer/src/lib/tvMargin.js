// TV "title-safe" margin: many TVs crop the edges of the picture (overscan), so in TV mode
// every screen keeps this percentage of the width/height free on each side. The CSS reads it
// through --tv-pct (see html.tv in styles.css); the user can calibrate it on the profile screen.
const KEY = 'tvMargin'
export const DEFAULT_MARGIN = 4
export const MAX_MARGIN = 10

export function getTvMargin() {
  try {
    const saved = Number(localStorage.getItem(KEY))
    if (localStorage.getItem(KEY) !== null && saved >= 0 && saved <= MAX_MARGIN) return saved
  } catch {
    // storage blocked: use the default
  }
  return DEFAULT_MARGIN
}

export function applyTvMargin(pct) {
  document.documentElement.style.setProperty('--tv-pct', String(pct))
}

export function saveTvMargin(pct) {
  try {
    localStorage.setItem(KEY, String(pct))
  } catch {
    // keep the applied value for this session
  }
  applyTvMargin(pct)
}
