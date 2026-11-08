import { useCallback, useRef, useState } from 'react'
import { getProgress, setProgress } from './store'
import { findNextEpisode } from './episodes'

// Shared state for the full-window player. `play` takes a playback entry:
//   { key, title, image, ref: { kind: 'movie'|'episode', id, ext }, seriesId?, startAt?, isLive? }
// `seriesId` lets the home screen show one card per show instead of one per episode.
// or, for streams that are not resumable, { title, stream: { url, fallbackUrl? }, isLive }.
// Progress stores the `ref`, never the URL: URLs carry credentials and the
// stream address is rebuilt from the current profile at play time.
// Near the end (last 3%) the entry is removed instead.
// An episode entry with a `seriesId` also gets `onNext` once the show's episodes are known:
// it plays the following episode in the same player (see findNextEpisode).
export function resolveStream(source, ref) {
  return ref.kind === 'movie' ? source.movieUrl(ref) : source.episodeUrl(ref)
}

export function usePlayback(profileId, source, onSaved, onPlay) {
  const [playing, setPlaying] = useState(null)
  const token = useRef(0) // identifies the current playback, so a late answer is dropped
  const playRef = useRef(null)

  const play = useCallback(
    (entry) => {
      const mine = ++token.current
      onPlay?.(entry)
      const { key, title, image, ref, seriesId, startAt = 0, isLive = false } = entry
      const stream = entry.stream || resolveStream(source, ref)
      const onProgress =
        key && ref && !isLive
          ? (position, duration) => {
              const finished = duration > 0 && position / duration > 0.97
              setProgress(profileId, key, finished ? null : { title, image, ref, seriesId, position, duration })
              onSaved?.()
            }
          : undefined
      setPlaying({ title, url: stream.url, fallbackUrl: stream.fallbackUrl, startAt, isLive, onProgress })

      if (ref?.kind !== 'episode' || !seriesId || isLive) return
      source
        .seriesInfo(seriesId)
        .then((info) => {
          const next = findNextEpisode(info.seasons, ref.id)
          if (!next || token.current !== mine) return
          const nextKey = `episode:${next.id}`
          const show = info.name || title.split(' · ')[0]
          const nextEntry = {
            key: nextKey,
            title: `${show} · T${next.season} E${next.episode}`,
            image: image || next.image,
            ref: { kind: 'episode', id: next.id, ext: next.ext },
            seriesId,
            season: next.season,
            startAt: getProgress(profileId, nextKey)?.position || 0
          }
          setPlaying((p) => (token.current === mine && p ? { ...p, onNext: () => playRef.current(nextEntry) } : p))
        })
        .catch(() => {}) // no episode list: simply no "next" button
    },
    [profileId, source, onSaved, onPlay]
  )
  playRef.current = play

  return {
    playing,
    play,
    close: () => {
      token.current += 1
      setPlaying(null)
    }
  }
}
