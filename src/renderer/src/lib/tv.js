import { useEffect } from 'react'
import { registerPlugin } from '@capacitor/core'
import { applyTvMargin, getTvMargin } from './tvMargin'
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
    applyTvMargin(getTvMargin())
    window.addEventListener('app:back', onBackWhileEditing, true)
    window.addEventListener('keydown', onOkKey, true)
    window.addEventListener('focusin', onFieldFocus, true)
    window.addEventListener('focusin', onPosterFocus, true)
    startFieldButtons()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keydown', onEnterOnField, true)
    window.addEventListener('focusout', onFieldBlur)
  }
}

// Text fields: arriving with the arrows only highlights the field; the on-screen
// keyboard opens when OK is pressed. Otherwise every field crossed on the way
// would pop the keyboard up and steal the arrow keys.
const FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="hidden"]), textarea'
const isField = (el) => el?.matches?.(FIELD)

// Every text field gets a real <button class="tv-field"> in front of it (the input itself is
// hidden, read-only and out of the focus order). The D-pad lands on the button, and OK activates
// it through the ordinary button click path, which opens the system keyboard for that field.
// That way opening the keyboard does not depend on how the remote's OK key reaches JavaScript
// on an <input>, and crossing a field with the arrows never pops the keyboard up.
function enhanceField(el) {
  if (el.__tvBtn) return
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `tv-field ${el.className}`
  if (el.dataset.tvVertical !== undefined) btn.dataset.tvVertical = ''
  btn.addEventListener('click', () => openSystemKeyboard(el))
  el.after(btn)
  el.__tvBtn = btn
  el.readOnly = true
  el.tabIndex = -1
  el.inputMode = 'none'
  el.classList.add('tv-field-input')
  if (document.activeElement === el) btn.focus()
}

function syncField(el) {
  const btn = el.__tvBtn
  const text = el.value ? (el.type === 'password' ? '•'.repeat(el.value.length) : el.value) : el.placeholder || ''
  if (btn.textContent !== text) btn.textContent = text
  btn.classList.toggle('empty', !el.value)
  btn.disabled = el.disabled
}

const enhanced = new Set()
function refreshFieldButtons() {
  document.querySelectorAll(FIELD).forEach((el) => {
    enhanceField(el)
    if (el.__tvBtn) enhanced.add(el)
  })
  for (const el of enhanced) {
    if (!el.isConnected) {
      el.__tvBtn?.remove()
      enhanced.delete(el)
    } else syncField(el)
  }
}

function startFieldButtons() {
  let scheduled = false
  const tick = () => {
    scheduled = false
    refreshFieldButtons()
  }
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true
      requestAnimationFrame(tick)
    }
  }).observe(document.body, { childList: true, subtree: true })
  document.addEventListener('input', () => refreshFieldButtons(), true)
  setInterval(refreshFieldButtons, 400) // values set by React without an input event
  refreshFieldButtons()
}

// Anything that focuses a hidden input (autoFocus, initial focus, form validation) lands on its
// button instead, unless the field is being edited with the system keyboard.
function onFieldFocus(e) {
  const el = e.target
  if (el.__tvBtn && el.dataset.tvEditing !== '1') el.__tvBtn.focus()
}

// Some remotes deliver OK as keyCode 23 (DPAD_CENTER) or 96 (BUTTON_A) without a usable `key`:
// make those activate the focused button like Enter does.
function onOkKey(e) {
  if (e.repeat || (e.keyCode !== 23 && e.keyCode !== 96 && e.key !== 'GamepadA')) return
  if (document.querySelector('.tv-calibration')) return
  const a = document.activeElement
  if (!a?.matches?.('button, a[href], [role="button"]')) return
  e.preventDefault()
  e.stopImmediatePropagation()
  a.click()
}

const isOk = (e) => e.key === 'Enter' || e.keyCode === 13 || e.keyCode === 23

// Edits a field with the system keyboard: the real input replaces its button while the keyboard
// is up, and the focus request happens inside the button's click, which Android needs to show it.
function openSystemKeyboard(el) {
  if (!el || el.disabled) return
  el.dataset.tvEditing = '1'
  el.readOnly = false
  el.tabIndex = 0
  el.inputMode = 'text'
  el.classList.remove('tv-field-input')
  if (el.__tvBtn) el.__tvBtn.style.display = 'none'
  el.focus()
  try {
    el.setSelectionRange(el.value.length, el.value.length)
  } catch {
    // some input types have no selection
  }
}

// Back to the button once editing ends; `next` moves on to the next field or the form's submit.
function finishEditing(el, next) {
  let to = el.__tvBtn || el
  if (next && el.form) {
    const all = [...el.form.querySelectorAll(FIELD)]
    const after = all[all.indexOf(el) + 1]
    to = after?.__tvBtn || after || el.form.querySelector('.btn.primary') || to
  }
  el.blur() // onFieldBlur puts the button back
  setTimeout(() => {
    to.focus()
    to.scrollIntoView?.({ block: 'nearest' })
  }, 0)
}

// Enter on a field being edited (the keyboard's Done/Next) finishes it instead of submitting.
function onEnterOnField(e) {
  const el = document.activeElement
  if (!isOk(e) || !isField(el) || el.dataset.tvEditing !== '1') return
  e.preventDefault()
  e.stopPropagation()
  finishEditing(el, true)
}

// Back (after the keyboard itself was dismissed) leaves the field before it leaves the screen.
function onBackWhileEditing(e) {
  const el = document.activeElement
  if (!isField(el) || el.dataset.tvEditing !== '1') return
  e.preventDefault()
  e.stopImmediatePropagation()
  finishEditing(el, false)
}

function onFieldBlur(e) {
  const el = e.target
  if (!isField(el) || !el.__tvBtn) return
  delete el.dataset.tvEditing
  el.readOnly = true
  el.tabIndex = -1
  el.inputMode = 'none'
  el.classList.add('tv-field-input')
  el.__tvBtn.style.display = ''
  // Focus lost without going anywhere (keyboard closed): land on the button, not on nothing.
  if (!e.relatedTarget) el.__tvBtn.focus()
}

// tabindex="-1" opts an element out of the remote's focus order (e.g. the logo link, the
// favorite star on a poster).
const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select, textarea, [tabindex]:not([tabindex="-1"])'
const DIRECTIONS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

// Cheap on purpose (no getComputedStyle): it runs for every focusable element on each key press,
// and the TV boxes are slow. display:none has no client rects; hidden players are .exo-hide.
function isVisible(el) {
  return el.getClientRects().length > 0 && !el.closest('.exo-hide')
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
    // Filter fields are reached from above/below only: sideways moves skip them.
    if (horizontal && el.dataset.tvVertical !== undefined) continue
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
    // Tie-break: a wide element above/below a row lands on its first item, not the middle one.
    const tie = horizontal ? Math.abs(dy) : from.width > rect.width * 1.5 ? Math.abs(rect.left - from.left) : Math.abs(dx)
    const score = Math.max(0, aheadGap) + 3 * sideGap + 0.1 * tie
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  return best
}

// Poster grids and the category list are navigated by position in the list, not by geometry:
// a grid scrolled so that the row above is partly out of the scroller made the top menu the
// "closest" element above, so UP jumped to the menu. Everything else still uses findNext.
const POSTER = '.poster-grid .poster > a'
let lastPoster = null // last focused grid poster, where DOWN from the menu/filter returns

function onPosterFocus(e) {
  if (e.target.matches?.(POSTER)) lastPoster = e.target
}

const visibleGrids = () => [...document.querySelectorAll('.poster-grid')].filter((g) => g.getClientRects().length)
const gridColumns = (items) => {
  // The link is positioned inside its card: compare the cards' offsets.
  const top = items[0].parentElement.offsetTop
  let n = 0
  while (n < items.length && items[n].parentElement.offsetTop === top) n++
  return Math.max(1, n)
}
const categoryStop = () => document.querySelector('.category-list .active') || document.querySelector('.category-list button')

// Returns the poster to focus, or null (stay), or undefined (leave it to the generic search).
function gridMove(active, direction) {
  const grid = active.closest('.poster-grid')
  const items = [...grid.querySelectorAll('.poster > a')]
  const idx = items.indexOf(active)
  if (idx < 0) return undefined
  const cols = gridColumns(items)
  const grids = visibleGrids()
  const at = grids.indexOf(grid)
  if (direction === 'right') return items[idx + 1] || null
  if (direction === 'left') {
    if (idx % cols === 0) return categoryStop() || items[idx - 1] || null
    return items[idx - 1]
  }
  if (direction === 'up') {
    if (idx >= cols) return items[idx - cols]
    const prev = grids[at - 1] && [...grids[at - 1].querySelectorAll('.poster > a')]
    if (!prev?.length) return undefined // first row: filter field, then the top menu
    const pc = gridColumns(prev)
    const lastRow = Math.floor((prev.length - 1) / pc) * pc
    return prev[Math.min(lastRow + (idx % cols), prev.length - 1)]
  }
  // down
  if (idx + cols < items.length) return items[idx + cols]
  if (Math.floor(idx / cols) < Math.floor((items.length - 1) / cols)) return items[items.length - 1]
  const next = grids[at + 1] && [...grids[at + 1].querySelectorAll('.poster > a')]
  return next?.length ? next[Math.min(idx % cols, next.length - 1)] : null
}

// Keeps the focused item inside a comfortable band of its scroller and scrolls only when it
// leaves that band, by about one row: gentle and predictable, and never twice.
function reveal(el) {
  const sc = el.closest('.catalog-main, .channel-list, .category-list, .live-preview')
  if (!sc || sc.scrollHeight <= sc.clientHeight) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return
  }
  const c = sc.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const margin = c.height * 0.12
  const below = r.bottom > c.bottom - margin
  if (r.top < c.top + margin || below) {
    // About one row: moving down leaves the item a bit past the middle, moving up before it.
    sc.scrollTop += r.top + r.height / 2 - (c.top + c.height * (below ? 0.55 : 0.35))
  }
}

function focusAndReveal(el) {
  if (isField(el)) el.inputMode = 'none'
  el.focus({ preventScroll: true }) // the browser's own scroll would add to ours
  if (el.matches(POSTER)) lastPoster = el
  reveal(el)
}

function onKeyDown(e) {
  const direction = DIRECTIONS[e.key]
  if (!direction || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
  // The fullscreen player handles its own keys (seek, pause).
  if (document.querySelector('.player.native-fs:not(.menu-open):not(.bar-focus)')) return

  const active = document.activeElement
  // (focus events do not fire while the window itself is unfocused, so note it here as well)
  if (active?.matches?.(POSTER)) lastPoster = active
  // In a text field left/right move the caret; up/down leave the field.
  if (active?.matches?.('input, textarea') && (direction === 'left' || direction === 'right')) return

  // From the category sidebar, RIGHT goes to the first item of the list (the filter field and the
  // top bar are not "to the right" of it in any useful sense).
  if (direction === 'right' && active?.closest?.('.category-list')) {
    const first = [...document.querySelectorAll('.poster > a, .channel')].find(isVisible)
    if (first) {
      e.preventDefault()
      focusAndReveal(first)
      return
    }
  }

  // Poster grid: by position in the grid.
  if (active?.matches?.(POSTER)) {
    const target = gridMove(active, direction)
    if (target !== undefined) {
      e.preventDefault()
      if (target) focusAndReveal(target)
      return
    }
  }
  // Category list: up/down by position (the ends fall through to the generic search).
  if ((direction === 'up' || direction === 'down') && active?.closest?.('.category-list')) {
    const all = [...active.closest('.category-list').querySelectorAll('button')]
    const target = all[all.indexOf(active) + (direction === 'down' ? 1 : -1)]
    if (target) {
      e.preventDefault()
      focusAndReveal(target)
      return
    }
  }

  // A modal (the player) keeps the focus inside it.
  const scope = document.querySelector('.player-modal') || document
  // Grid posters and category buttons are handled above; only the category in use (and the
  // current element) stay in the candidate list, so a key press measures a handful of elements.
  const stop = categoryStop()
  const items = [...scope.querySelectorAll(FOCUSABLE)].filter(
    (el) => (el === active || el === stop || !el.closest('.poster-grid, .category-list')) && isVisible(el)
  )
  if (!items.length) return

  const current = items.includes(active) ? active : null
  let next = current ? findNext(items, current, direction) : items[0]
  // DOWN from the menu, the filter or a list above a grid: into the grid, on the poster that
  // was focused last (else the first one), when the grid is what lies right below.
  if (current && direction === 'down' && !active.closest('.poster-grid')) {
    // Document order, not geometry: the grid may be scrolled up behind the menu.
    const grid = visibleGrids().find((g) => active.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING)
    const gridFirst = grid && (active.closest('.topbar') || !next || next.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_PRECEDING)
    if (gridFirst) {
      next = (lastPoster?.isConnected && grid.contains(lastPoster) && lastPoster) || grid.querySelector('.poster > a')
    }
  }
  e.preventDefault()
  if (next) focusAndReveal(next)
}

// TV only: gives the screen an initial focus (the remote does nothing without one). `selector`
// picks the main action; nothing happens if something already has the focus, so coming back to
// a screen never steals it from the user. `ready` waits for async content.
export function useInitialFocus(selector, ready = true) {
  useEffect(() => {
    if (!ready || !isTvMode()) return
    const active = document.activeElement
    if (active && active !== document.body && active.closest('main, .page-center')) return
    const el = [].concat(selector).map((s) => document.querySelector(s)).find(Boolean)
    // A text field only highlights; the keyboard opens on OK (see onEnterOnField).
    if (el && isField(el)) el.inputMode = 'none'
    el?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, String(selector)])
}
