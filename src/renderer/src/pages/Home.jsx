import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Logo, useAsync } from '../components/common'
import { PlayerModal } from '../components/Player'
import { listProgress, setProgress } from '../lib/store'
import { usePlayback } from '../lib/playback'

const ROW_SIZE = 20

// Splits "continue watching" into movies and series. Series keep only the
// most recently watched episode of each show (entries are newest first).
function loadHistory(profileId) {
  const entries = listProgress(profileId).filter((h) => h.ref)
  const movies = entries.filter((h) => h.ref.kind === 'movie').slice(0, ROW_SIZE)
  const seenShows = new Set()
  const series = entries
    .filter((h) => h.ref.kind === 'episode')
    .filter((h) => {
      const show = h.seriesId || h.key
      if (seenShows.has(show)) return false
      seenShows.add(show)
      return true
    })
    .slice(0, ROW_SIZE)
  return { movies, series }
}

export default function Home() {
  const { profile, source } = useOutletContext()
  const account = useAsync(() => source.login(), [source])
  const [history, setHistory] = useState(() => loadHistory(profile.id))
  const { playing, play, close } = usePlayback(profile.id, source, () => setHistory(loadHistory(profile.id)))

  const removeEntry = (key) => {
    setProgress(profile.id, key, null)
    setHistory(loadHistory(profile.id))
  }

  const base = `/p/${profile.id}`
  const info = account.data
  const empty = !history.movies.length && !history.series.length

  return (
    <div className="home">
      {empty ? (
        <section className="home-empty">
          <h2>Nada em andamento</h2>
          <p className="muted">Filmes e séries que você começar a assistir aparecem aqui.</p>
          <div className="home-links">
            <Link to={`${base}/movie`} className="btn">🎬 Filmes</Link>
            <Link to={`${base}/series`} className="btn">📺 Séries</Link>
            <Link to={`${base}/live`} className="btn">📡 TV ao vivo</Link>
          </div>
        </section>
      ) : (
        <>
          <ContinueRow title="Continuar assistindo · Filmes" entries={history.movies} onPlay={play} onRemove={removeEntry} />
          <ContinueRow title="Continuar assistindo · Séries" entries={history.series} onPlay={play} onRemove={removeEntry} />
        </>
      )}

      {profile.type === 'xtream' && info && (
        <section className="account muted">
          Conta: {info.status || '—'}
          {info.expiresAt && <> · expira em {new Date(info.expiresAt).toLocaleDateString()}</>}
          {info.maxConnections && <> · {info.maxConnections} conexão(ões)</>}
        </section>
      )}

      {playing && <PlayerModal {...playing} onClose={close} />}
    </div>
  )
}

function ContinueRow({ title, entries, onPlay, onRemove }) {
  if (!entries.length) return null
  return (
    <section>
      <h2>{title}</h2>
      <div className="poster-row">
        {entries.map((h) => (
          <div key={h.key} className="poster continue">
            <button onClick={() => onPlay({ ...h, startAt: h.position })}>
              <Logo src={h.image} alt={h.title} className="poster-img" />
              <span className="poster-title" title={h.title}>{h.title}</span>
              {h.duration > 0 && (
                <span className="progress-bar"><span style={{ width: `${Math.min(100, (h.position / h.duration) * 100)}%` }} /></span>
              )}
            </button>
            <button className="remove" title="Remover" onClick={() => onRemove(h.key)}>×</button>
          </div>
        ))}
      </div>
    </section>
  )
}
