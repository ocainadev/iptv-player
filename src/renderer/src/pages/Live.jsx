import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Player, { PlayerModal } from '../components/Player'
import { CategoryList, ErrorState, Loading, Logo, formatDate, formatTime, useAsync, useIncremental, useScrollTopOn } from '../components/common'
import { ALL, filterItems, withSpecialCategories } from '../lib/catalog'

export default function Live() {
  const { source, favorites, toggleFav } = useOutletContext()
  const { data, loading, error, retry } = useAsync(
    () => Promise.all([source.categories('live'), source.items('live')]),
    [source]
  )
  const [categoryId, setCategoryId] = useState(ALL)
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState(null)
  const [catchup, setCatchup] = useState(null)
  const listRef = useScrollTopOn([categoryId, query])

  const [categories, channels] = data || [[], []]
  const sidebar = useMemo(() => withSpecialCategories(categories, channels, favorites, 'live'), [categories, channels, favorites])
  const list = useMemo(() => filterItems(channels, categoryId, favorites, 'live', query), [channels, categoryId, favorites, query])
  const { visible, hasMore, sentinel } = useIncremental(list, 200)

  if (loading) return <Loading text="Carregando canais..." />
  if (error) return <ErrorState error={error} onRetry={retry} />

  return (
    <div className="live-layout">
      <CategoryList categories={sidebar} selected={categoryId} onSelect={setCategoryId} />

      <section className="channel-list" ref={listRef}>
        <input className="search-input" placeholder="Filtrar canais" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul>
          {visible.map((c, index) => (
            <li key={c.id} className={channel?.id === c.id ? 'active' : ''}>
              <button className="channel" onClick={() => setChannel(c)}>
                <span className="channel-num">{index + 1}</span>
                <Logo src={c.logo} alt={c.name} className="channel-logo" />
                <span className="channel-name">{c.name}</span>
                {c.archive > 0 && <span className="badge" title="Catch-up disponível">⟲</span>}
              </button>
              <button className={`fav ${favorites.has(`live:${c.id}`) ? 'on' : ''}`} onClick={() => toggleFav('live', c.id)} title="Favorito">★</button>
            </li>
          ))}
        </ul>
        {hasMore && <div ref={sentinel} className="sentinel" />}
        {!list.length && <p className="muted pad">Nenhum canal.</p>}
      </section>

      <section className="live-preview">
        {channel ? (
          <>
            {/* Stop the preview during catch-up: many accounts allow one connection only. */}
            {catchup ? <div className="player" /> : <Player key={channel.id} {...source.liveUrl(channel)} isLive />}
            <h2>{channel.name}</h2>
            <Epg source={source} channel={channel} onCatchup={(p) => setCatchup(p)} />
          </>
        ) : (
          <p className="muted center-state">Escolha um canal.</p>
        )}
      </section>

      {catchup && (
        <PlayerModal
          title={`${channel.name} · ${catchup.title}`}
          url={source.catchupUrl(channel, catchup).url}
          onClose={() => setCatchup(null)}
        />
      )}
    </div>
  )
}

function Epg({ source, channel, onCatchup }) {
  const epg = useAsync(() => source.shortEpg(channel.id), [source, channel.id])
  const [showArchive, setShowArchive] = useState(false)
  useEffect(() => setShowArchive(false), [channel.id])

  return (
    <div className="epg">
      {epg.loading ? (
        <p className="muted">Carregando programação...</p>
      ) : !epg.data?.length ? (
        <p className="muted">Sem programação disponível.</p>
      ) : (
        <ul>
          {epg.data.map((p, i) => (
            <li key={p.start} className={i === 0 ? 'now' : ''}>
              <span className="time">{formatTime(p.start)} – {formatTime(p.end)}</span>
              <strong>{p.title}</strong>
              {i === 0 && p.description && <p>{p.description}</p>}
            </li>
          ))}
        </ul>
      )}

      {channel.archive > 0 && source.type === 'xtream' && (
        <div className="catchup">
          <button className="btn small" onClick={() => setShowArchive((s) => !s)}>
            {showArchive ? 'Ocultar' : 'Ver'} programas anteriores (catch-up, {channel.archive} dias)
          </button>
          {showArchive && <Archive source={source} channel={channel} onPick={onCatchup} />}
        </div>
      )}
    </div>
  )
}

function Archive({ source, channel, onPick }) {
  const archive = useAsync(() => source.archiveEpg(channel.id), [source, channel.id])
  if (archive.loading) return <p className="muted">Carregando...</p>
  if (archive.error) return <p className="error-text">{archive.error.message}</p>
  const items = (archive.data || []).filter((p) => p.hasArchive)
  if (!items.length) return <p className="muted">Nada gravado.</p>
  return (
    <ul className="archive-list">
      {items.map((p) => (
        <li key={p.start}>
          <button onClick={() => onPick(p)}>
            <span className="time">{formatDate(p.start)} {formatTime(p.start)}</span>
            <span>{p.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
