import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { CategoryList, ErrorState, Loading, Logo, useAsync, useIncremental, useRestoreScroll, useScrollTopOn } from '../components/common'
import { ALL, filterItems, withSpecialCategories } from '../lib/catalog'
import { useBrowseState } from '../lib/browseState'
import { isTvMode, useInitialFocus } from '../lib/tv'

// Poster grid for movies or series, with a category sidebar.
export default function Catalog({ kind }) {
  // key: another profile must start from its own saved state.
  const { profile } = useOutletContext()
  return <CatalogView key={profile.id} kind={kind} />
}

function CatalogView({ kind }) {
  const { profile, source, favorites, toggleFav } = useOutletContext()
  const { initial, save } = useBrowseState(profile.id, kind)
  const { data, loading, error, retry } = useAsync(
    () => Promise.all([source.categories(kind), source.items(kind)]),
    [source, kind]
  )
  const [savedCategory, setCategoryId] = useState(initial.categoryId)
  const [query, setQuery] = useState(initial.query)
  const mainRef = useScrollTopOn([savedCategory, query, kind])

  const [categories, items] = data || [[], []]
  const sidebar = useMemo(() => withSpecialCategories(categories, items, favorites, kind, source.type === 'm3u'), [categories, items, favorites, kind, source])
  // The saved category may be gone (the list was updated): fall back to "Todos".
  const categoryId = !loading && !sidebar.some((c) => c.id === savedCategory) ? ALL : savedCategory
  const list = useMemo(() => filterItems(items, categoryId, favorites, kind, query), [items, categoryId, favorites, kind, query])
  const onScroll = useRestoreScroll(mainRef, initial.scroll, (scroll) => save({ scroll }), !loading)

  // Changing the category or the filter shows the top of a new list.
  const pickCategory = (id) => {
    setCategoryId(id)
    setQuery('')
    save({ categoryId: id, query: '', scroll: 0, count: 0, focusId: '' })
  }
  // TV: focus the poster that was focused before leaving, else the first one.
  const focusSel = [initial.focusId && `.poster > a[data-item="${CSS.escape(initial.focusId)}"]`, '.poster > a'].filter(Boolean)
  useInitialFocus(focusSel, !loading && !!list.length)
  const focusTimer = useRef(null)
  const onFocus = (e) => {
    const id = e.target.closest?.('[data-item]')?.dataset.item
    if (!id) return
    // Remembering the focus writes to storage: do it once the remote stops moving.
    clearTimeout(focusTimer.current)
    focusTimer.current = setTimeout(() => save({ focusId: id }), 300)
  }
  const changeQuery = (value) => {
    setQuery(value)
    save({ query: value, scroll: 0, count: 0 })
  }

  if (loading) return <Loading text={kind === 'movie' ? 'Carregando filmes...' : 'Carregando séries...'} />
  if (error) return <ErrorState error={error} onRetry={retry} />

  return (
    <div className="catalog-layout">
      <CategoryList categories={sidebar} selected={categoryId} onSelect={pickCategory} />
      <section className="catalog-main" ref={mainRef} onScroll={onScroll} onFocus={onFocus}>
        <input className="search-input" data-tv-vertical placeholder="Filtrar" value={query} onChange={(e) => changeQuery(e.target.value)} />
        <PosterGrid
          items={list}
          kind={kind}
          base={`/p/${profile.id}`}
          favorites={favorites}
          toggleFav={toggleFav}
          initialCount={initial.count}
          onCount={(count) => save({ count })}
        />
      </section>
    </div>
  )
}

export function PosterGrid({ items, kind, base, favorites, toggleFav, initialCount, onCount }) {
  const { visible, count, hasMore, sentinel } = useIncremental(items, 120, initialCount || 120)
  useEffect(() => onCount?.(count), [count]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return <p className="muted pad">Nada encontrado.</p>
  return (
    <>
      <div className="poster-grid">
        {visible.map((item) => (
          <div key={item.id} className="poster">
            <Link to={`${base}/${item.kind || kind}/${encodeURIComponent(item.id)}`} data-item={item.id} title={item.name}>
              <Logo src={item.logo} alt={item.name} className="poster-img" />
              <span className="poster-title">{item.name}</span>
              {item.rating && Number(item.rating) > 0 && <span className="rating">★ {Number(item.rating).toFixed(1)}</span>}
            </Link>
            {toggleFav && (
              <button
                className={`fav ${favorites.has(`${item.kind || kind}:${item.id}`) ? 'on' : ''}`}
                onClick={() => toggleFav(item.kind || kind, item.id)}
                title="Favorito"
                aria-label={favorites.has(`${item.kind || kind}:${item.id}`) ? `Remover ${item.name} dos favoritos` : `Favoritar ${item.name}`}
                tabIndex={isTvMode() ? -1 : undefined}
              >
                ★
              </button>
            )}
          </div>
        ))}
      </div>
      {hasMore && <div ref={sentinel} className="sentinel" />}
    </>
  )
}
