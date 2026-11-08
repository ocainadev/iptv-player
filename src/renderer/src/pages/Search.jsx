import { useDeferredValue, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ErrorState, Loading, Logo, useAsync } from '../components/common'
import { PlayerModal } from '../components/Player'
import { PosterGrid } from './Catalog'
import { displayName, normalize } from '../lib/catalog'

const LIMIT = 60

// Searches live channels, movies and series by name at once.
export default function Search() {
  const { profile, source, favorites, toggleFav } = useOutletContext()
  const { data, loading, error, retry } = useAsync(
    () => Promise.all([...['live', 'movie', 'series'].map((k) => source.items(k).catch(() => [])), source.categories('live').catch(() => [])]),
    [source]
  )
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [channel, setChannel] = useState(null)

  const results = useMemo(() => {
    const q = normalize(deferred)
    if (q.length < 2 || !data) return null
    const match = (list) => list.filter((i) => normalize(i.name).includes(q))
    const [live, movie, series] = data.slice(0, 3).map(match)
    return { live, movie, series }
  }, [deferred, data])
  const liveInfo = useMemo(() => {
    const names = new Map((data?.[3] || []).map((c) => [c.id, c.name]))
    const number = new Map((data?.[0] || []).map((c, i) => [c.id, i + 1]))
    return (c) => ({ number: number.get(c.id), category: displayName(c.category || names.get(c.categoryIds?.[0]) || '') })
  }, [data])
  const typed = normalize(deferred).length
  const empty = results && !results.live.length && !results.movie.length && !results.series.length

  if (loading) return <Loading text="Preparando busca..." />
  if (error) return <ErrorState error={error} onRetry={retry} />

  const base = `/p/${profile.id}`
  return (
    <div className="search-page">
      <input autoFocus data-tv-vertical className="search-input big" placeholder="Buscar canais, filmes e séries" value={query} onChange={(e) => setQuery(e.target.value)} />

      {typed < 2 && <p className="muted pad">Digite ao menos 2 letras para buscar.</p>}
      {empty && <p className="muted pad">Nenhum resultado para “{deferred.trim()}”.</p>}
      {results && (
        <>
          <Section title="TV ao vivo" count={results.live.length}>
            <ul className="search-live">
              {results.live.slice(0, LIMIT).map((c) => {
                const { number, category } = liveInfo(c)
                return (
                  <li key={c.id}>
                    <button className="channel" onClick={() => setChannel(c)}>
                      <span className="channel-num">{number}</span>
                      <Logo src={c.logo} alt="" className="channel-logo" />
                      <span className="channel-name" title={c.name}>{c.name}</span>
                      {category && <small className="muted channel-cat">{category}</small>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </Section>
          <Section title="Filmes" count={results.movie.length}>
            <PosterGrid items={results.movie.slice(0, LIMIT)} kind="movie" base={base} favorites={favorites} toggleFav={toggleFav} />
          </Section>
          <Section title="Séries" count={results.series.length}>
            <PosterGrid items={results.series.slice(0, LIMIT)} kind="series" base={base} favorites={favorites} toggleFav={toggleFav} />
          </Section>
        </>
      )}

      {channel && <PlayerModal title={channel.name} {...source.liveUrl(channel)} isLive onClose={() => setChannel(null)} />}
    </div>
  )
}

function Section({ title, count, children }) {
  if (!count) return null
  return (
    <section>
      <h2>{title} <small className="muted">{count > LIMIT ? `${LIMIT} de ${count}` : count}</small></h2>
      {children}
    </section>
  )
}
