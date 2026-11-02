import { useDeferredValue, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { ErrorState, Loading, useAsync } from '../components/common'
import { PlayerModal } from '../components/Player'
import { PosterGrid } from './Catalog'
import { normalize } from '../lib/catalog'

const LIMIT = 60

// Searches live channels, movies and series by name at once.
export default function Search() {
  const { profile, source, favorites, toggleFav } = useOutletContext()
  const { data, loading, error, retry } = useAsync(
    () => Promise.all(['live', 'movie', 'series'].map((k) => source.items(k).catch(() => []))),
    [source]
  )
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [channel, setChannel] = useState(null)

  const results = useMemo(() => {
    const q = normalize(deferred)
    if (q.length < 2 || !data) return null
    const match = (list) => list.filter((i) => normalize(i.name).includes(q))
    const [live, movie, series] = data.map(match)
    return { live, movie, series }
  }, [deferred, data])

  if (loading) return <Loading text="Preparando busca..." />
  if (error) return <ErrorState error={error} onRetry={retry} />

  const base = `/p/${profile.id}`
  return (
    <div className="search-page">
      <input autoFocus className="search-input big" placeholder="Buscar canais, filmes e séries" value={query} onChange={(e) => setQuery(e.target.value)} />

      {results && (
        <>
          <Section title="TV ao vivo" count={results.live.length}>
            <div className="chip-list">
              {results.live.slice(0, LIMIT).map((c) => (
                <button key={c.id} className="chip" onClick={() => setChannel(c)}>{c.name}</button>
              ))}
            </div>
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
