import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { displayName } from '../lib/catalog'

export function Loading({ text = 'Carregando...' }) {
  return (
    <div className="center-state">
      <div className="spinner" />
      <p>{text}</p>
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="center-state">
      <p className="error-text">{error?.message || String(error)}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Tentar de novo</button>}
    </div>
  )
}

// Runs an async loader and tracks loading/error state. `deps` re-run it.
export function useAsync(loader, deps) {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    loader()
      .then((data) => !cancelled && setState({ loading: false, error: null, data }))
      .catch((error) => !cancelled && setState({ loading: false, error, data: null }))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  return { ...state, retry: () => setAttempt((n) => n + 1) }
}

export function Logo({ src, alt, className = '' }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <div className={`logo-fallback ${className}`}>{alt?.slice(0, 2).toUpperCase()}</div>
  // Providers answer "no photo" with a 1x1 or tiny image: treat it like a broken one.
  const onLoad = (e) => e.currentTarget.naturalWidth < 20 && setFailed(true)
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} onLoad={onLoad} />
}

// Renders a long list in pages of `step`, adding more when the sentinel
// scrolls into view. Keeps catalogs with thousands of items responsive.
// `start` is the count to begin with (restoring a scrolled list), used for the first
// non-empty list; any later change of `items` goes back to one page.
export function useIncremental(items, step = 120, start = step) {
  const [count, setCount] = useState(Math.max(start, step))
  const sentinel = useRef(null)
  const lastItems = useRef(items)
  const startUsed = useRef(items.length > 0)

  useEffect(() => {
    if (lastItems.current === items) return
    lastItems.current = items
    if (items.length && !startUsed.current) {
      startUsed.current = true
      setCount(Math.max(start, step))
    } else setCount(step)
  }, [items, step, start])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setCount((c) => c + step)
    }, { rootMargin: '600px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [items, step])

  return { visible: items.slice(0, count), count, hasMore: count < items.length, sentinel }
}

// Scrolls the referenced element back to the top whenever `deps` change, so
// switching category shows the start of the new list, not the old position.
export function useScrollTopOn(deps) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

// Keeps a scroll container's position in sync with the saved browse state: restores it once
// (after the first paint with content) and saves it while the user scrolls.
export function useRestoreScroll(ref, scroll, onScroll, ready) {
  const restored = useRef(false)
  useLayoutEffect(() => {
    if (!ready || restored.current) return
    restored.current = true
    if (ref.current && scroll) ref.current.scrollTop = scroll
  }, [ready, ref, scroll])
  const frame = useRef(0)
  return (e) => {
    const top = e.currentTarget.scrollTop
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => onScroll(top))
  }
}

export function CategoryList({ categories, selected, onSelect }) {
  return (
    <nav className="category-list">
      {categories.map((c) => (
        <button
          key={c.id}
          className={c.id === selected ? 'active' : ''}
          onClick={() => onSelect(c.id)}
          title={c.name}
        >
          <span>{displayName(c.name)}</span>
          {c.count !== undefined && <small>{c.count}</small>}
        </button>
      ))}
    </nav>
  )
}

export function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(ms) {
  return new Date(ms).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' })
}
