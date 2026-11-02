import { registerPlugin } from '@capacitor/core'
import { isNative } from './native'

// Native plugin (android/.../TvModePlugin.java): is this an Android TV / Fire TV?
const TvMode = registerPlugin('TvMode')

// TV mode = remote-control interface: focus ring, D-pad navigation, bigger text.
// Besides real TVs it can be forced for testing: add ?tv to the URL or set
// localStorage.tvMode = '1'.
export const isTvMode = () => document.documentElement.classList.contains('tv')

export async function initTvMode() {
  let tv = false
  try {
    tv = new URLSearchParams(window.location.search).has('tv') || localStorage.getItem('tvMode') === '1'
  } catch {
    // storage blocked: fall through to the native check
  }
  if (!tv && isNative) {
    try {
      tv = (await TvMode.isTv()).value === true
    } catch {
      // plugin missing: treat as not a TV
    }
  }
  if (tv) {
    document.documentElement.classList.add('tv')
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keydown', onEnterOnField, true)
    window.addEventListener('focusout', onFieldBlur)
  }
}

// Text fields: arriving with the arrows only highlights the field; the on-screen
// keyboard opens when OK is pressed. Otherwise every field crossed on the way
// would pop the keyboard up and steal the arrow keys.
const isField = (el) => el?.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea')

let refocusing = false

function onEnterOnField(e) {
  const el = document.activeElement
  if (e.key !== 'Enter' || !isField(el) || el.dataset.tvEditing === '1') return
  e.preventDefault()
  e.stopPropagation()
  // Re-focus so the WebView asks for the keyboard with the new input mode.
  refocusing = true
  el.blur()
  el.inputMode = 'text'
  el.focus()
  refocusing = false
  el.dataset.tvEditing = '1'
}

function onFieldBlur(e) {
  if (refocusing || !isField(e.target)) return
  delete e.target.dataset.tvEditing
  e.target.inputMode = 'none'
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
const DIRECTIONS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

function isVisible(el) {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

// Distance between two intervals on one axis; 0 when they overlap.
const gap = (a1, a2, b1, b2) => Math.max(0, Math.max(a1, b1) - Math.min(a2, b2))

// Picks the focusable element closest in the pressed direction, measured
// between the edges: the empty space ahead counts once, missing overlap on the
// other axis counts three times. A wide field above a small button wins over a
// narrow one further up, and a grid moves straight along its rows and columns.
// The distance between centers only breaks ties.
function findNext(items, current, direction) {
  const from = current.getBoundingClientRect()
  const fromCenter = center(from)
  const horizontal = direction === 'left' || direction === 'right'
  let best = null
  let bestScore = Infinity
  for (const el of items) {
    if (el === current) continue
    const rect = el.getBoundingClientRect()
    const to = center(rect)
    const dx = to.x - fromCenter.x
    const dy = to.y - fromCenter.y
    const ahead = { left: dx < 0, right: dx > 0, up: dy < 0, down: dy > 0 }[direction]
    if (!ahead) continue
    const aheadGap = {
      left: from.left - rect.right,
      right: rect.left - from.right,
      up: from.top - rect.bottom,
      down: rect.top - from.bottom
    }[direction]
    const sideGap = horizontal
      ? gap(from.top, from.bottom, rect.top, rect.bottom)
      : gap(from.left, from.right, rect.left, rect.right)
    const score = Math.max(0, aheadGap) + 3 * sideGap + 0.1 * (horizontal ? Math.abs(dy) : Math.abs(dx))
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  return best
}

function onKeyDown(e) {
  const direction = DIRECTIONS[e.key]
  if (!direction || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
  // The fullscreen player handles its own keys (seek, pause).
  if (document.querySelector('.player.native-fs:not(.menu-open):not(.bar-focus)')) return

  const active = document.activeElement
  // In a text field left/right move the caret; up/down leave the field.
  if (active?.matches?.('input, textarea') && (direction === 'left' || direction === 'right')) return

  // A modal (the player) keeps the focus inside it.
  const scope = document.querySelector('.player-modal') || document
  const items = [...scope.querySelectorAll(FOCUSABLE)].filter(isVisible)
  if (!items.length) return

  const current = items.includes(active) ? active : null
  const next = current ? findNext(items, current, direction) : items[0]
  e.preventDefault()
  if (!next) return
  if (isField(next)) next.inputMode = 'none'
  next.focus()
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
