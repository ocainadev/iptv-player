import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Player, { PlayerModal } from '../components/Player'
import { CategoryList, ErrorState, Loading, Logo, formatDate, formatTime, useAsync, useIncremental, useRestoreScroll, useScrollTopOn } from '../components/common'
import { ALL, filterItems, withSpecialCategories } from '../lib/catalog'
import { useBrowseState } from '../lib/browseState'
import { useInitialFocus } from '../lib/tv'

export default function Live() {
  // key: another profile must start from its own saved state.
  const { profile } = useOutletContext()
  return <LiveView key={profile.id} />
}

function LiveView() {
  const { profile, source, favorites, toggleFav } = useOutletContext()
  const { initial, save } = useBrowseState(profile.id, 'live')
  const { data, loading, error, retry } = useAsync(
    () => Promise.all([source.categories('live'), source.items('live')]),
    [source]
  )
  const [savedCategory, setCategoryId] = useState(initial.categoryId)
  const [query, setQuery] = useState(initial.query)
  const [channel, setChannel] = useState(null)
  const [catchup, setCatchup] = useState(null)
  const listRef = useScrollTopOn([savedCategory, query])

  const [categories, channels] = data || [[], []]
  const sidebar = useMemo(() => withSpecialCategories(categories, channels, favorites, 'live', source.type === 'm3u'), [categories, channels, favorites, source])
  // The saved category may be gone (the list was updated): fall back to "Todos".
  const categoryId = !loading && !sidebar.some((c) => c.id === savedCategory) ? ALL : savedCategory
  const onScroll = useRestoreScroll(listRef, initial.scroll, (scroll) => save({ scroll }), !loading)
  const list = useMemo(() => filterItems(channels, categoryId, favorites, 'live', query), [channels, categoryId, favorites, query])
  const { visible, hasMore, sentinel } = useIncremental(list, 200, initial.count || 200)

  useEffect(() => { if (!loading) save({ count: visible.length }) }, [visible.length, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Changing the category or the filter shows the top of a new list.
  const pickCategory = (id) => {
    setCategoryId(id)
    setQuery('')
    save({ categoryId: id, query: '', scroll: 0, count: 0, focusId: '' })
  }
  // TV: focus the channel that was focused before leaving, else the first one.
  const focusSel = [initial.focusId && `.channel[data-item="${CSS.escape(initial.focusId)}"]`, '.channel'].filter(Boolean)
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

  if (loading) return <Loading text="Carregando canais..." />
  if (error) return <ErrorState error={error} onRetry={retry} />
  if (!channels.length) {
    return (
      <div className="center-state">
        <h2>Esta lista não tem canais ao vivo</h2>
        <p className="muted">Ela só traz filmes e séries. Adicione uma lista com canais para assistir TV ao vivo.</p>
      </div>
    )
  }

  return (
    <div className="live-layout">
      <CategoryList categories={sidebar} selected={categoryId} onSelect={pickCategory} />

      <section className="channel-list" ref={listRef} onScroll={onScroll} onFocus={onFocus}>
        <input className="search-input" data-tv-vertical placeholder="Filtrar canais" value={query} onChange={(e) => changeQuery(e.target.value)} />
        <ul>
          {visible.map((c, index) => (
            <li key={c.id} className={channel?.id === c.id ? 'active' : ''}>
              <button className="channel" data-item={c.id} onClick={() => setChannel(c)}>
                <span className="channel-num">{index + 1}</span>
                <Logo src={c.logo} alt={c.name} className="channel-logo" />
                <span className="channel-name" title={c.name}>{c.name}</span>
                {c.archive > 0 && <span className="badge" title="Catch-up disponível">⟲</span>}
              </button>
              <button className={`fav ${favorites.has(`live:${c.id}`) ? 'on' : ''}`} onClick={() => toggleFav('live', c.id)} title="Favorito" aria-label={favorites.has(`live:${c.id}`) ? `Remover ${c.name} dos favoritos` : `Favoritar ${c.name}`}>★</button>
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
