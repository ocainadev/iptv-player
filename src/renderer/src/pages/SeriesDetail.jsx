import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { ErrorState, Loading, Logo, useAsync } from '../components/common'
import { PlayerModal } from '../components/Player'
import { getProgress } from '../lib/store'
import { usePlayback } from '../lib/playback'
import { useInitialFocus } from '../lib/tv'

export default function SeriesDetail() {
  const { itemId } = useParams()
  const navigate = useNavigate()
  const { profile, source, favorites, toggleFav } = useOutletContext()
  const { data, loading, error, retry } = useAsync(async () => {
    const items = await source.items('series')
    const item = items.find((i) => i.id === itemId)
    if (!item) throw new Error('Série não encontrada')
    return { item, info: await source.seriesInfo(itemId) }
  }, [source, itemId])
  const [season, setSeason] = useState(null)
  const [, refresh] = useState(0)
  const { playing, play, close } = usePlayback(
    profile.id,
    source,
    () => refresh((n) => n + 1),
    // Going back after "next episode" lands on the season being watched.
    (entry) => entry.season != null && setSeason(String(entry.season))
  )

  const seasonKeys = Object.keys(data?.info.seasons || {}).sort((a, b) => Number(a) - Number(b))
  useEffect(() => {
    if (seasonKeys.length && !seasonKeys.includes(season)) setSeason(seasonKeys[0])
  }, [seasonKeys, season])

  useInitialFocus(['.episode-list button', '.detail-actions .btn'], !loading && !error && (season !== null || !seasonKeys.length))

  if (loading) return <Loading />
  if (error) return <ErrorState error={error} onRetry={retry} />

  const { item, info } = data
  const title = info.name || item.name
  const poster = info.poster || item.logo
  const episodes = info.seasons[season] || []
  const isFav = favorites.has(`series:${item.id}`)

  const playEpisode = (ep) => {
    const key = `episode:${ep.id}`
    const saved = getProgress(profile.id, key)
    play({
      key,
      title: `${title} · T${ep.season} E${ep.episode}`,
      image: poster || ep.image,
      ref: { kind: 'episode', id: ep.id, ext: ep.ext },
      seriesId: item.id,
      season: ep.season,
      startAt: saved?.position || 0
    })
  }

  return (
    <div className="detail" style={info.backdrop ? { '--backdrop': `url("${info.backdrop}")` } : undefined}>
      <button className="btn ghost" onClick={() => navigate(-1)}>← Voltar</button>
      <div className="detail-body">
        <Logo src={poster} alt={title} className="detail-poster" />
        <div className="detail-info">
          <h1>{title}</h1>
          <p className="meta">{[info.releaseDate?.slice(0, 4), info.genre, info.rating && `★ ${info.rating}`].filter(Boolean).join(' · ')}</p>
          {info.plot && <p className="plot">{info.plot}</p>}
          {info.cast && <p><span className="muted">Elenco:</span> {info.cast}</p>}
          <div className="detail-actions">
            <button className={`btn ${isFav ? 'on' : ''}`} onClick={() => toggleFav('series', item.id)}>
              {isFav ? '★ Favorito' : '☆ Favoritar'}
            </button>
          </div>
        </div>
      </div>

      {seasonKeys.length ? (
        <>
          <div className="tabs seasons">
            {seasonKeys.map((s) => (
              <button key={s} className={s === season ? 'active' : ''} onClick={() => setSeason(s)}>Temporada {s}</button>
            ))}
          </div>
          <ul className="episode-list">
            {episodes.map((ep) => {
              const saved = getProgress(profile.id, `episode:${ep.id}`)
              return (
                <li key={ep.id}>
                  <button onClick={() => playEpisode(ep)}>
                    <Logo src={ep.image || poster} alt={ep.title} className="episode-img" />
                    <div>
                      <strong>{ep.episode}. {ep.title}</strong>
                      {ep.duration && <span className="muted"> · {ep.duration}</span>}
                      {ep.plot && <p className="muted">{ep.plot}</p>}
                      {saved?.duration > 0 && (
                        <span className="progress-bar"><span style={{ width: `${(saved.position / saved.duration) * 100}%` }} /></span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <p className="muted pad">Nenhum episódio disponível.</p>
      )}

      {playing && <PlayerModal {...playing} onClose={close} />}
    </div>
  )
}
