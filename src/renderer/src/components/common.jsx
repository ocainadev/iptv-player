import { useEffect, useRef, useState } from 'react'

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
  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
}

// Renders a long list in pages of `step`, adding more when the sentinel
// scrolls into view. Keeps catalogs with thousands of items responsive.
export function useIncremental(items, step = 120) {
  const [count, setCount] = useState(step)
  const sentinel = useRef(null)

  useEffect(() => setCount(step), [items, step])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setCount((c) => c + step)
    }, { rootMargin: '600px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [items, step])

  return { visible: items.slice(0, count), hasMore: count < items.length, sentinel }
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
          <span>{c.name}</span>
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
