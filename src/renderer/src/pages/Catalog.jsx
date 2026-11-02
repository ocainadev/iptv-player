import { useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { CategoryList, ErrorState, Loading, Logo, useAsync, useIncremental, useScrollTopOn } from '../components/common'
import { ALL, filterItems, withSpecialCategories } from '../lib/catalog'

// Poster grid for movies or series, with a category sidebar.
export default function Catalog({ kind }) {
  const { profile, source, favorites, toggleFav } = useOutletContext()
  const { data, loading, error, retry } = useAsync(
    () => Promise.all([source.categories(kind), source.items(kind)]),
    [source, kind]
  )
  const [categoryId, setCategoryId] = useState(ALL)
  const [query, setQuery] = useState('')
  const mainRef = useScrollTopOn([categoryId, query, kind])

  const [categories, items] = data || [[], []]
  const sidebar = useMemo(() => withSpecialCategories(categories, items, favorites, kind), [categories, items, favorites, kind])
  const list = useMemo(() => filterItems(items, categoryId, favorites, kind, query), [items, categoryId, favorites, kind, query])

  if (loading) return <Loading text={kind === 'movie' ? 'Carregando filmes...' : 'Carregando séries...'} />
  if (error) return <ErrorState error={error} onRetry={retry} />

  return (
    <div className="catalog-layout">
      <CategoryList categories={sidebar} selected={categoryId} onSelect={setCategoryId} />
      <section className="catalog-main" ref={mainRef}>
        <input className="search-input" placeholder="Filtrar" value={query} onChange={(e) => setQuery(e.target.value)} />
        <PosterGrid items={list} kind={kind} base={`/p/${profile.id}`} favorites={favorites} toggleFav={toggleFav} />
      </section>
    </div>
  )
}

export function PosterGrid({ items, kind, base, favorites, toggleFav }) {
  const { visible, hasMore, sentinel } = useIncremental(items)
  if (!items.length) return <p className="muted pad">Nada encontrado.</p>
  return (
    <>
      <div className="poster-grid">
        {visible.map((item) => (
          <div key={item.id} className="poster">
            <Link to={`${base}/${item.kind || kind}/${encodeURIComponent(item.id)}`}>
              <Logo src={item.logo} alt={item.name} className="poster-img" />
              <span className="poster-title">{item.name}</span>
              {item.rating && Number(item.rating) > 0 && <span className="rating">★ {Number(item.rating).toFixed(1)}</span>}
            </Link>
            {toggleFav && (
              <button
                className={`fav ${favorites.has(`${item.kind || kind}:${item.id}`) ? 'on' : ''}`}
                onClick={() => toggleFav(item.kind || kind, item.id)}
                title="Favorito"
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
