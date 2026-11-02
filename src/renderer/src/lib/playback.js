import { useCallback, useState } from 'react'
import { setProgress } from './store'

// Shared state for the full-window player. `play` takes a playback entry:
//   { key, title, image, ref: { kind: 'movie'|'episode', id, ext }, seriesId?, startAt?, isLive? }
// `seriesId` lets the home screen show one card per show instead of one per episode.
// or, for streams that are not resumable, { title, stream: { url, fallbackUrl? }, isLive }.
// Progress stores the `ref`, never the URL: URLs carry credentials and the
// stream address is rebuilt from the current profile at play time.
// Near the end (last 3%) the entry is removed instead.
export function resolveStream(source, ref) {
  return ref.kind === 'movie' ? source.movieUrl(ref) : source.episodeUrl(ref)
}

export function usePlayback(profileId, source, onSaved) {
  const [playing, setPlaying] = useState(null)

  const play = useCallback(
    (entry) => {
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
    },
    [profileId, source, onSaved]
  )

  return { playing, play, close: () => setPlaying(null) }
}
