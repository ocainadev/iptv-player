import { useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { ErrorState, Loading, Logo, useAsync } from '../components/common'
import { PlayerModal } from '../components/Player'
import { getProgress } from '../lib/store'
import { usePlayback } from '../lib/playback'

export default function MovieDetail() {
  const { itemId } = useParams()
  const navigate = useNavigate()
  const { profile, source, favorites, toggleFav } = useOutletContext()
  const { data: movie, loading, error, retry } = useAsync(async () => {
    const items = await source.items('movie')
    const item = items.find((i) => i.id === itemId)
    if (!item) throw new Error('Filme não encontrado')
    const info = await source.movieInfo(itemId).catch(() => ({}))
    return { item, info }
  }, [source, itemId])
  const [, refresh] = useState(0)
  const { playing, play, close } = usePlayback(profile.id, source, () => refresh((n) => n + 1))

  if (loading) return <Loading />
  if (error) return <ErrorState error={error} onRetry={retry} />

  const { item, info } = movie
  const key = `movie:${item.id}`
  const saved = getProgress(profile.id, key)
  const title = info.name || item.name
  const image = info.poster || item.logo
  const ref = { kind: 'movie', id: item.id, ext: info.ext || item.ext }
  const isFav = favorites.has(key)

  return (
    <div className="detail" style={info.backdrop ? { '--backdrop': `url("${info.backdrop}")` } : undefined}>
      <button className="btn ghost" onClick={() => navigate(-1)}>← Voltar</button>
      <div className="detail-body">
        <Logo src={image} alt={title} className="detail-poster" />
        <div className="detail-info">
          <h1>{title}</h1>
          <p className="meta">
            {[info.releaseDate?.slice(0, 4), info.duration, info.genre, info.rating && `★ ${info.rating}`].filter(Boolean).join(' · ')}
          </p>
          {info.plot && <p className="plot">{info.plot}</p>}
          {info.director && <p><span className="muted">Direção:</span> {info.director}</p>}
          {info.cast && <p><span className="muted">Elenco:</span> {info.cast}</p>}

          <div className="detail-actions">
            {saved ? (
              <>
                <button className="btn primary" onClick={() => play({ key, title, image, ref, startAt: saved.position })}>
                  ▶ Continuar ({formatClock(saved.position)})
                </button>
                <button className="btn" onClick={() => play({ key, title, image, ref })}>Do início</button>
              </>
            ) : (
              <button className="btn primary" onClick={() => play({ key, title, image, ref })}>▶ Assistir</button>
            )}
            <button className={`btn ${isFav ? 'on' : ''}`} onClick={() => toggleFav('movie', item.id)}>
              {isFav ? '★ Favorito' : '☆ Favoritar'}
            </button>
            {info.trailer && (
              <a className="btn ghost" href={`https://www.youtube.com/watch?v=${info.trailer}`} target="_blank" rel="noreferrer">Trailer</a>
            )}
          </div>
        </div>
      </div>
      {playing && <PlayerModal {...playing} onClose={close} />}
    </div>
  )
}

export function formatClock(seconds) {
  const s = Math.floor(seconds || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}
