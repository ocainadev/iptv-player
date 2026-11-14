import { useCallback, useRef, useState } from 'react'
import { getProgress, isSeen, setProgress, setSeen } from './store'
import { findNextEpisode } from './episodes'

// Shared state for the full-window player. `play` takes a playback entry:
//   { key, title, image, ref: { kind: 'movie'|'episode', id, ext }, seriesId?, startAt?, isLive? }
// `seriesId` lets the home screen show one card per show instead of one per episode.
// or, for streams that are not resumable, { title, stream: { url, fallbackUrl? }, isLive }.
// Progress stores the `ref`, never the URL: URLs carry credentials and the
// stream address is rebuilt from the current profile at play time.
// Near the end (last 3%) the entry is removed instead; for an episode with a known next
// episode, the next one takes its place (position 0) so the show keeps showing up.
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
      let nextEntry = null // filled once the show's episode list is known
      const onProgress =
        key && ref && !isLive
          ? (position, duration) => {
              const finished = duration > 0 && position / duration > 0.97
              if (finished && !isSeen(profileId, key)) setSeen(profileId, key, true)
              if (finished && nextEntry && !getProgress(profileId, nextEntry.key)) {
                // Episode finished: the show stays in "continue watching", now at the next episode.
                setProgress(profileId, key, null)
                setProgress(profileId, nextEntry.key, { title: nextEntry.title, image: nextEntry.image, ref: nextEntry.ref, seriesId, position: 0, duration: 0 })
              } else {
                setProgress(profileId, key, finished ? null : { title, image, ref, seriesId, position, duration })
              }
              // No `onSaved` here: it redraws the page behind the player (poster rows, episode
              // list), which is wasted work every 5 s. The page is refreshed in `close` instead.
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
          nextEntry = {
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
      // Leaving the player: push the progress now instead of waiting for the next slot.
      window.dispatchEvent(new CustomEvent('iptv:flush'))
      token.current += 1
      setPlaying(null)
      onSaved?.()
    }
  }
}
