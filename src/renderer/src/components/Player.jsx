import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { enterNativeFullscreen, exitNativeFullscreen, isNative } from '../lib/native'
import { isTvMode } from '../lib/tv'
import { NativePlayer } from '../lib/exo'
import { setBusy } from '../lib/busy'

// Picks the engine by URL: hls.js for .m3u8, mpegts.js for .ts/.flv,
// the native <video> element for files (mp4, webm...). Live links without
// an extension (common in M3U lists) are raw MPEG-TS, so they go to mpegts.js.
// On a fatal error it tries `fallbackUrl` once before giving up.
function engineFor(url, isLive) {
  const path = url.split('?')[0].toLowerCase()
  const ext = path.match(/\.([a-z0-9]{2,5})$/)?.[1]
  if (ext === 'm3u8' || path.includes('m3u8')) return 'hls'
  if (ext === 'ts' || ext === 'flv') return 'mpegts'
  if (isLive && !['mp4', 'webm', 'mkv', 'mov', 'm4v'].includes(ext)) return 'mpegts'
  return 'native'
}

// Picture-in-picture outlives the player screen: when the player unmounts while its
// video is floating, the <video> and its engine move to a hidden host and keep playing,
// so the user can browse the app. The session ends when the floating window closes
// or another video starts.
let pipSession = null

function endPipSession() {
  const session = pipSession
  if (!session) return
  pipSession = null
  session.teardown()
  if (document.pictureInPictureElement === session.video) document.exitPictureInPicture().catch(() => {})
  session.host.remove()
}

const SERVER_DOWN = 'Sem resposta do servidor. Verifique a conexão e tente de novo.'
const UNSUPPORTED_HINT =
  'Formato ou codec não suportado pelo Chromium (comum em MKV, HEVC/H.265 e áudio AC3/DTS).'

// Seconds before the next episode starts by itself when one ends.
const NEXT_COUNTDOWN = 5

export default function Player({ url, fallbackUrl, isLive = false, startAt = 0, onProgress, onNext, onClose, autoPlay = true, startFullscreen = false }) {
  const videoRef = useRef(null)
  const slotRef = useRef(null)
  // Audio and subtitle tracks of the current stream, and how to switch them.
  const [tracks, setTracks] = useState({ audio: [], text: [] })
  const [menuOpen, setMenuOpen] = useState(false)
  // TV: the remote's arrows move focus into the control bar (down) and back to the picture (up/back).
  const [barFocus, setBarFocus] = useState(false)
  const hasTracks = tracks.audio.length > 1 || tracks.text.length > 0
  // Picture-in-picture: the browser's own floating video window (desktop only).
  const canPip = !isNative && !!document.pictureInPictureEnabled
  const [pip, setPip] = useState(false)
  const togglePip = () => {
    const video = videoRef.current
    if (!video) return
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
    else video.requestPictureInPicture().catch(() => {})
  }
  const trackApi = useRef({ select: () => {} })
  // "Próximo episódio em N s" after an episode ends; null when not counting down.
  const [autoNext, setAutoNext] = useState(null)
  const unmounting = useRef(false)
  useEffect(() => () => { unmounting.current = true }, [])
  // Playback state shown in the control bar, on both engines.
  const [media, setMedia] = useState({ position: 0, duration: -1, playing: false, volume: 1, muted: false })
  const engineRef = useRef(null) // { teardown } of the running <video> engine
  const handedOff = useRef(false)
  // Runs on unmount, before React removes the player's DOM: a floating video must not go with it.
  useLayoutEffect(
    () => () => {
      const video = videoRef.current
      if (isNative || !video || !engineRef.current || document.pictureInPictureElement !== video) return
      handedOff.current = true
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:-10px;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
      document.body.appendChild(host)
      host.appendChild(video)
      pipSession = { video, host, teardown: engineRef.current.teardown }
      video.addEventListener('leavepictureinpicture', endPipSession, { once: true })
    },
    []
  )
  // Android: ExoPlayer state reported by the plugin (the <video> element is not used).
  const exo = useRef({ position: 0, duration: -1, playing: false })
  const [activeUrl, setActiveUrl] = useState(url)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // "Tentar de novo" bumps `attempt`, which restarts the engine on the original url.
  const [attempt, setAttempt] = useState(0)
  // The video reached its end (VOD): offer replay / next / close instead of a dead picture.
  const [ended, setEnded] = useState(false)
  const retry = () => {
    setError('')
    setLoading(true)
    setActiveUrl(url)
    setAttempt((n) => n + 1)
  }

  useEffect(() => {
    setActiveUrl(url)
    setError('')
    // A new stream (next episode): the old track menu and countdown no longer apply.
    setMenuOpen(false)
    setAutoNext(null)
    setEnded(false)
  }, [url])

  const goNext = () => {
    setAutoNext(null)
    onNext?.()
  }
  useEffect(() => {
    if (autoNext === null) return
    if (autoNext <= 0) return goNext()
    const timer = setTimeout(() => setAutoNext((n) => n - 1), 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNext])
  const onNextRef = useRef(null)
  onNextRef.current = onNext

  useEffect(() => {
    if (!isNative || !activeUrl) return
    setLoading(true)
    setError('')
    let retries = 0
    let lastReport = 0
    const handles = []
    const fail = (message) => {
      if (fallbackUrl && activeUrl !== fallbackUrl) setActiveUrl(fallbackUrl)
      else {
        setLoading(false)
        setError(message)
      }
    }
    trackApi.current = { select: (kind, id) => NativePlayer.selectTrack({ kind, id }) }
    const start = () => NativePlayer.load({ url: activeUrl, live: isLive, startAt, autoPlay }).catch(() => fail('Não foi possível iniciar o player.'))
    const listen = async () => {
      handles.push(
        await NativePlayer.addListener('tracks', setTracks),
        await NativePlayer.addListener('state', ({ state }) => {
          setLoading(state === 'buffering')
          if (state === 'ended') {
            setEnded(true)
            if (onNextRef.current) setAutoNext(NEXT_COUNTDOWN)
          } else if (state === 'ready') setEnded(false)
        }),
        await NativePlayer.addListener('time', (t) => {
          exo.current = t
          setMedia((m) => ({ ...m, position: t.position, duration: t.duration, playing: t.playing }))
          if (!onProgress || isLive || t.position <= 0) return
          const now = Date.now()
          if (now - lastReport < 5000) return
          lastReport = now
          onProgress(t.position, t.duration)
        }),
        await NativePlayer.addListener('error', ({ network }) => {
          if (network && retries < 3) {
            retries += 1
            setTimeout(start, 1000 * retries)
          } else {
            fail(network ? SERVER_DOWN : 'Formato ou codec não suportado neste aparelho.')
          }
        })
      )
      start()
    }
    listen()
    document.documentElement.classList.add('exo-active')
    return () => {
      const { position, duration } = exo.current
      if (onProgress && !isLive && position > 0) onProgress(position, duration)
      handles.forEach((h) => h.remove())
      setTracks({ audio: [], text: [] })
      NativePlayer.stop()
      document.documentElement.classList.remove('exo-active')
      exo.current = { position: 0, duration: -1, playing: false }
    }
    // onProgress is intentionally left out: a new callback identity must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl, isLive, startAt, autoPlay, attempt])

  useEffect(() => {
    const video = videoRef.current
    if (isNative || !video || !activeUrl) return
    endPipSession()
    setLoading(true)
    setError('')
    try {
      const saved = JSON.parse(localStorage.getItem(VOLUME_KEY))
      if (saved) {
        video.volume = saved.volume
        video.muted = saved.muted
      }
    } catch {
      // no saved volume
    }

    let hls = null
    let ts = null
    let retryTimer = null
    let mediaRecoveries = 0
    let networkRetries = 0

    const fail = (message) => {
      if (fallbackUrl && activeUrl !== fallbackUrl) {
        setActiveUrl(fallbackUrl)
        return
      }
      setLoading(false)
      setError(message)
    }

    const engine = engineFor(activeUrl, isLive)
    if (engine === 'hls' && Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: isLive, backBufferLength: isLive ? 30 : 90 })
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
          networkRetries += 1
          retryTimer = setTimeout(() => hls?.startLoad(), 1000 * networkRetries)
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
          mediaRecoveries += 1
          hls.recoverMediaError()
        } else {
          fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? SERVER_DOWN : UNSUPPORTED_HINT)
        }
      })
      hls.loadSource(activeUrl)
      hls.attachMedia(video)
    } else if (engine === 'mpegts' && mpegts.isSupported()) {
      ts = mpegts.createPlayer({ type: 'mpegts', isLive, url: activeUrl }, { enableWorker: true, lazyLoad: !isLive })
      ts.on(mpegts.Events.ERROR, (type) => {
        fail(type === mpegts.ErrorTypes.NETWORK_ERROR ? SERVER_DOWN : UNSUPPORTED_HINT)
      })
      ts.attachMediaElement(video)
      ts.load()
    } else {
      video.src = activeUrl
    }

    // Tracks: hls.js exposes its own lists; a plain <video> exposes textTracks
    // (and audioTracks where the browser implements them).
    const subs = () => [...video.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions')
    const readTracks = () => {
      const audio = []
      const text = []
      if (hls) {
        hls.audioTracks.forEach((t, i) => audio.push({ id: String(i), label: t.name || t.lang || `Áudio ${i + 1}`, selected: hls.audioTrack === i }))
        hls.subtitleTracks.forEach((t, i) => text.push({ id: String(i), label: t.name || t.lang || `Legenda ${i + 1}`, selected: hls.subtitleTrack === i }))
      } else {
        subs().forEach((t, i) => text.push({ id: String(i), label: t.label || t.language || `Legenda ${i + 1}`, selected: t.mode === 'showing' }))
        if (video.audioTracks) {
          ;[...video.audioTracks].forEach((t, i) => audio.push({ id: String(i), label: t.label || t.language || `Áudio ${i + 1}`, selected: t.enabled }))
        }
      }
      setTracks({ audio, text })
    }
    trackApi.current = {
      select: (kind, id) => {
        if (hls) {
          if (kind === 'audio') hls.audioTrack = Number(id)
          else hls.subtitleTrack = id === '' ? -1 : Number(id)
        } else if (kind === 'audio') {
          ;[...video.audioTracks].forEach((t, i) => (t.enabled = String(i) === id))
        } else {
          subs().forEach((t, i) => (t.mode = String(i) === id ? 'showing' : 'disabled'))
        }
        readTracks()
      }
    }
    if (hls) {
      hls.subtitleDisplay = true
      for (const ev of [Hls.Events.MANIFEST_PARSED, Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED, Hls.Events.SUBTITLE_TRACK_SWITCH]) {
        hls.on(ev, readTracks)
      }
    }
    video.textTracks.addEventListener('addtrack', readTracks)
    video.textTracks.addEventListener('change', readTracks)
    video.audioTracks?.addEventListener?.('addtrack', readTracks)
    const onEnterPip = () => setPip(true)
    const onLeavePip = () => setPip(false)
    video.addEventListener('enterpictureinpicture', onEnterPip)
    video.addEventListener('leavepictureinpicture', onLeavePip)

    const onLoaded = () => {
      if (startAt > 0 && !isLive) video.currentTime = startAt
      if (autoPlay) video.play().catch(() => {})
    }
    const onPlaying = () => {
      setLoading(false)
      setEnded(false)
    }
    const onWaiting = () => setLoading(true)
    const onVideoError = () => {
      if (hls || ts) return
      // No extra request to the stream URL here: providers count every one as a connection.
      fail(video.error?.code === 2 ? SERVER_DOWN : UNSUPPORTED_HINT)
    }

    let lastReport = 0
    const onTime = () => {
      if (!onProgress || isLive) return
      const now = Date.now()
      if (now - lastReport < 5000) return
      lastReport = now
      onProgress(video.currentTime, video.duration)
    }

    const syncMedia = () =>
      setMedia({
        position: video.currentTime || 0,
        duration: isFinite(video.duration) ? video.duration : -1,
        playing: !video.paused,
        volume: video.volume,
        muted: video.muted
      })
    const mediaEvents = ['timeupdate', 'play', 'pause', 'durationchange', 'volumechange']
    mediaEvents.forEach((ev) => video.addEventListener(ev, syncMedia))
    syncMedia()

    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('error', onVideoError)
    video.addEventListener('timeupdate', onTime)
    const onEnded = () => {
      setEnded(true)
      if (onNextRef.current) setAutoNext(NEXT_COUNTDOWN)
    }
    video.addEventListener('ended', onEnded)

    const teardown = () => {
      clearTimeout(retryTimer)
      hls?.destroy()
      hls = null
      if (ts) {
        ts.pause()
        ts.unload()
        ts.detachMediaElement()
        ts.destroy()
      }
      video.removeAttribute('src')
      video.load()
    }
    engineRef.current = { teardown }

    return () => {
      if (onProgress && !isLive && video.currentTime > 0) onProgress(video.currentTime, video.duration)
      // The player screen closed while floating: the PiP session owns the stream now.
      if (handedOff.current) return
      engineRef.current = null
      video.removeEventListener('enterpictureinpicture', onEnterPip)
      video.removeEventListener('leavepictureinpicture', onLeavePip)
      // Switching episode keeps a floating video floating; only closing the player ends it.
      if (unmounting.current && document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {})
      video.textTracks.removeEventListener('addtrack', readTracks)
      video.textTracks.removeEventListener('change', readTracks)
      video.audioTracks?.removeEventListener?.('addtrack', readTracks)
      setTracks({ audio: [], text: [] })
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('error', onVideoError)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('ended', onEnded)
      mediaEvents.forEach((ev) => video.removeEventListener(ev, syncMedia))
      teardown()
    }
    // onProgress is intentionally left out: a new callback identity must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl, isLive, startAt, autoPlay, attempt])

  const containerRef = useRef(null)
  const [view, setView] = useViewSettings()
  const viewRef = useRef(view)
  viewRef.current = view
  // Short on-screen feedback for keyboard/mouse actions on desktop (TV has its own HUD calls).
  const feedback = (text) => !isNative && !tv && showHud(text)
  // The ref is updated at once so several quick presses add up before the next render.
  const cycleMode = () => {
    const next = nextMode(viewRef.current.mode)
    viewRef.current = { ...viewRef.current, mode: next }
    setView((v) => ({ ...v, mode: next }))
    feedback(`⤢ ${FIT_MODES.find((m) => m.id === next).label}`)
  }
  const zoomTo = (z) => {
    const zoom = clampZoom(z)
    viewRef.current = { ...viewRef.current, zoom }
    setView((v) => ({ ...v, zoom }))
    feedback(`🔍 ${Math.round(zoom * 100)}%`)
  }
  // On Android the Fullscreen API is unreliable inside the WebView, so fullscreen is
  // a fixed-position CSS layer plus a landscape lock; elsewhere it is the real API.
  const [nativeFs, setNativeFs] = useState(isNative && startFullscreen)
  const tv = isTvMode()
  const [hud, setHud] = useState(null)
  // A focused button can disappear (the "next episode" button on the last episode, the
  // countdown prompt): no blur event fires then, so give the focus back to the picture.
  useEffect(() => {
    const active = document.activeElement
    if (active && active !== document.body && containerRef.current?.contains(active)) return
    if (barFocus) setBarFocus(false)
    if (tv && (!active || active === document.body)) containerRef.current?.focus()
  }, [onNext, url, autoNext]) // eslint-disable-line react-hooks/exhaustive-deps
  // Toolbar and touch controls fade out after a few seconds without interaction.
  const [idle, setIdle] = useState(false)
  const hideControls = idle && media.playing
  const idleTimer = useRef(null)
  const wake = () => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS)
  }
  useEffect(() => {
    wake()
    return () => clearTimeout(idleTimer.current)
  }, [])
  const hudTimer = useRef(null)
  const busyKey = useRef(`player-${Math.random()}`)
  useEffect(() => {
    setBusy(busyKey.current, media.playing && !error)
  }, [media.playing, error])
  useEffect(() => () => setBusy(busyKey.current, false), [])
  const fullscreen = () => (isNative ? setNativeFs((f) => !f) : toggleFullscreen(containerRef.current))

  useEffect(() => {
    if (!nativeFs) return
    enterNativeFullscreen()
    // Remote-control keys go to the container, so it needs the focus.
    if (tv) containerRef.current?.focus()
    const onBack = (e) => {
      // An open track menu takes the back press (its own handler closes it).
      if (containerRef.current?.classList.contains('menu-open')) return
      e.preventDefault()
      setNativeFs(false)
    }
    window.addEventListener('app:back', onBack)
    return () => {
      window.removeEventListener('app:back', onBack)
      exitNativeFullscreen()
    }
  }, [nativeFs, tv])

  function showHud(text) {
    setHud({ text })
    clearTimeout(hudTimer.current)
    hudTimer.current = setTimeout(() => setHud(null), 1500)
  }
  useEffect(() => () => clearTimeout(hudTimer.current), [])

  // Remote control: OK opens fullscreen, then OK pauses and left/right seek.
  // Keys on the toolbar buttons keep their normal meaning (OK = click).
  function onTvKey(e) {
    const video = videoRef.current
    if (!tv || (!video && !isNative) || (e.target !== containerRef.current && e.target !== video)) return
    const key = e.key
    const seek = (delta) => {
      if (isNative) {
        const { position, duration } = exo.current
        if (isLive || duration <= 0) return
        NativePlayer.seekTo({ position: Math.min(duration, Math.max(0, position + delta)) })
      } else {
        if (isLive || !isFinite(video.duration)) return
        video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + delta))
      }
      showHud(`${delta > 0 ? '⏩' : '⏪'} ${Math.abs(delta)}s`)
    }
    const toggle = () => {
      if (isNative) {
        const playing = exo.current.playing
        togglePlay()
        exo.current.playing = !playing
        showHud(playing ? '⏸ Pausado' : '▶ Reproduzindo')
        return
      }
      if (video.paused) video.play().catch(() => {})
      else video.pause()
      showHud(video.paused ? '⏸ Pausado' : '▶ Reproduzindo')
    }
    if (key === 'Enter' || key === ' ' || key === 'MediaPlayPause') {
      if (!nativeFs && key !== 'MediaPlayPause') fullscreen()
      else toggle()
    } else if (key === 'ArrowDown') {
      setBarFocus(true)
      containerRef.current?.querySelector('.control-bar button')?.focus()
    } else if (hasTracks && (key === 'ArrowUp' || key === 'ContextMenu')) setMenuOpen(true)
    else if (nativeFs && (key === 'ArrowRight' || key === 'MediaFastForward')) seek(10)
    else if (nativeFs && (key === 'ArrowLeft' || key === 'MediaRewind')) seek(-10)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  // Shortcuts: A = next fit mode, +/- = zoom, 0 = reset zoom, F = fullscreen.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'a') cycleMode()
      else if (key === '+' || key === '=') zoomTo(viewRef.current.zoom + ZOOM_STEP)
      else if (key === '-') zoomTo(viewRef.current.zoom - ZOOM_STEP)
      else if (key === '0') zoomTo(1)
      else if (key === 'f') fullscreen()
      else if (key === 'c' && hasTracks) setMenuOpen((o) => !o)
      else if (key === 'n' && onNext) goNext()
      else if (key === 'p' && canPip && !tv) togglePip()
      else if (!isNative && !tv && key === 'm') setVolume(media.volume, !media.muted)
      else if (!isNative && !tv && key === ' ' && !e.target.closest?.('button')) togglePlay()
      else if (!isNative && !tv && key === 'arrowright') skip(10)
      else if (!isNative && !tv && key === 'arrowleft') skip(-10)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, hasTracks, onNext, media.volume, media.muted, media.position, media.duration])

  const mode = FIT_MODES.find((m) => m.id === view.mode) || FIT_MODES[0]

  // ExoPlayer is a native view behind the page: keep it on the slot's rectangle.
  // The slot's ancestors are made transparent (see .exo-active in styles.css) so the picture shows through.
  useEffect(() => {
    if (!isNative) return
    const slot = slotRef.current
    // The slot is see-through, so whatever is drawn behind it would show over the
    // picture. In a modal or fullscreen layer, hide everything outside that layer.
    const root = nativeFs ? containerRef.current : slot.closest('.player-modal')
    const hidden = []
    if (root) {
      for (let el = root; el.parentElement; el = el.parentElement) {
        for (const sibling of el.parentElement.children) {
          if (sibling !== el && !['SCRIPT', 'STYLE'].includes(sibling.tagName)) {
            sibling.classList.add('exo-hide')
            hidden.push(sibling)
          }
        }
      }
    }
    let last = ''
    const sync = () => {
      const r = slot.getBoundingClientRect()
      const key = [r.left, r.top, r.width, r.height, mode.id, view.zoom].join()
      if (key === last) return
      last = key
      NativePlayer.setRect({ x: r.left, y: r.top, width: r.width, height: r.height, fit: mode.id, zoom: view.zoom })
    }
    sync()
    // Layout changes without a resize (scrolling, modal animations): poll cheaply.
    const timer = setInterval(sync, 200)
    window.addEventListener('resize', sync)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', sync)
      hidden.forEach((el) => el.classList.remove('exo-hide'))
    }
  }, [mode.id, view.zoom, nativeFs])

  const pickTrack = (kind, id) => {
    trackApi.current.select(kind, id)
    setMenuOpen(false)
    containerRef.current?.focus()
  }
  useEffect(() => {
    if (!menuOpen) return
    setIdle(false)
    clearTimeout(idleTimer.current)
    // Back closes the menu first, before the player or the modal react to it.
    const onBack = (e) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      setMenuOpen(false)
      containerRef.current?.focus()
    }
    window.addEventListener('app:back', onBack, true)
    containerRef.current?.querySelector('.track-menu button')?.focus()
    return () => {
      window.removeEventListener('app:back', onBack, true)
      wake()
    }
  }, [menuOpen])

  const togglePlay = () => {
    if (isNative) return exo.current.playing ? NativePlayer.pause() : NativePlayer.play()
    const video = videoRef.current
    if (!video) return
    feedback(video.paused ? '▶ Reproduzindo' : '⏸ Pausado')
    video.paused ? video.play().catch(() => {}) : video.pause()
  }
  const replay = () => {
    setEnded(false)
    setAutoNext(null)
    if (isNative) {
      NativePlayer.seekTo({ position: 0 })
      NativePlayer.play()
    } else if (videoRef.current) {
      videoRef.current.currentTime = 0
      videoRef.current.play().catch(() => {})
    }
  }
  const seekTo = (position) => {
    if (isNative) {
      exo.current.position = position
      NativePlayer.seekTo({ position })
      setMedia((m) => ({ ...m, position }))
    } else if (videoRef.current) {
      videoRef.current.currentTime = position
      // The slider is controlled: show the new spot at once, not at the next timeupdate.
      setMedia((m) => ({ ...m, position }))
    }
  }
  const skip = (delta) => {
    if (isLive || media.duration <= 0) return
    seekTo(Math.min(media.duration, Math.max(0, media.position + delta)))
    feedback(`${delta > 0 ? '⏩' : '⏪'} ${Math.abs(delta)}s`)
  }
  const setVolume = (volume, muted) => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
    // The slider is controlled: update it now, not when `volumechange` arrives, or React
    // snaps the thumb back to the old value between two quick input events.
    setMedia((m) => ({ ...m, volume, muted }))
    feedback(muted || volume === 0 ? '🔇 Mudo' : `🔊 ${Math.round(volume * 100)}%`)
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }))
    } catch {
      // keep the in-memory value
    }
  }
  // Click toggles play/pause; a double click (fullscreen) must not toggle twice.
  const clickTimer = useRef(null)
  const onPictureClick = () => {
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(togglePlay, 220)
  }
  const onPictureDoubleClick = () => {
    clearTimeout(clickTimer.current)
    fullscreen()
  }

  return (
    <div
      className={`player${nativeFs ? ' native-fs' : ''}${hideControls ? ' idle' : ''}${menuOpen ? ' menu-open' : ''}${barFocus ? ' bar-focus' : ''}${error ? ' has-error' : ''}`}
      ref={containerRef}
      tabIndex={tv ? 0 : undefined}
      onPointerMove={wake}
      onPointerDown={wake}
      onKeyDown={(e) => {
        wake()
        onTvKey(e)
      }}
    >
      {isNative ? (
        <div ref={slotRef} className="exo-slot" onDoubleClick={fullscreen} />
      ) : (
        <video
          ref={videoRef}
          playsInline
          style={{ objectFit: mode.objectFit, transform: view.zoom !== 1 ? `scale(${view.zoom})` : undefined }}
          onClick={tv ? undefined : onPictureClick}
          onDoubleClick={onPictureDoubleClick}
        />
      )}
      {ended && !isLive && !error && autoNext === null && (
        <div className="next-prompt" role="status">
          <span>Fim do vídeo</span>
          <button className="btn primary small" autoFocus onClick={replay}>Assistir de novo</button>
          {onNext && <button className="btn small" onClick={goNext}>Próximo episódio</button>}
          {onClose && <button className="btn ghost small" onClick={onClose}>Fechar</button>}
        </div>
      )}
      {autoNext !== null && (
        <div className="next-prompt" role="status">
          <span>Próximo episódio em {autoNext} s</span>
          <button className="btn primary small" autoFocus onClick={goNext}>Reproduzir agora</button>
          <button className="btn ghost small" onClick={() => { setAutoNext(null); containerRef.current?.focus() }}>Cancelar</button>
        </div>
      )}
      <div
        className="control-bar"
        onKeyDown={(e) => {
          if (tv && e.key === 'ArrowUp') {
            e.preventDefault()
            setBarFocus(false)
            containerRef.current?.focus()
          }
        }}
        onBlur={(e) => {
          if (barFocus && !e.currentTarget.contains(e.relatedTarget)) setBarFocus(false)
        }}
      >
        {!isLive && media.duration > 0 &&
          (tv ? (
            <div className="progress"><i style={{ width: `${(media.position / media.duration) * 100}%` }} /></div>
          ) : (
            <input
              className="seek"
              type="range"
              min="0"
              max={media.duration}
              step="1"
              value={Math.min(media.position, media.duration)}
              aria-label="Progresso"
              onChange={(e) => seekTo(Number(e.target.value))}
            />
          ))}
        <div className="control-row">
          {!tv && (
            <button className="ctl-play" title="Reproduzir / pausar (Espaço)" onClick={togglePlay}>{media.playing ? '❚❚' : '▶︎'}</button>
          )}
          {onNext && (
            <button className="next-ep" title="Próximo episódio (N)" aria-label="Próximo episódio" onClick={goNext}>
              ⏭<span className="next-text"> Próximo episódio</span>
            </button>
          )}
          <span className="time">
            {isLive ? <b className="live">AO VIVO</b> : media.duration > 0 ? `${formatTime(media.position)} / ${formatTime(media.duration)}` : formatTime(media.position)}
          </span>
          {!isNative && !tv && (
            <span className="volume">
              <button title="Mudo (M)" onClick={() => setVolume(media.volume, !media.muted)}>
                <Icon name={media.muted || media.volume === 0 ? 'mute' : 'volume'} />
              </button>
              <input
                className="vol"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={media.muted ? 0 : media.volume}
                aria-label="Volume"
                onChange={(e) => setVolume(Number(e.target.value), false)}
              />
            </span>
          )}
          <i className="sep" />
          <button title="Ajuste à tela (A)" onClick={cycleMode}>
            <Icon name="fit" /><span className="fit-text"> {mode.label}</span>
          </button>
          <button title="Diminuir zoom (-)" className="zoom-btn" onClick={() => zoomTo(viewRef.current.zoom - ZOOM_STEP)}>−</button>
          <button title="Zoom normal (0)" className="zoom-btn zoom-value" onClick={() => zoomTo(1)}>
            {Math.round(view.zoom * 100)}%
          </button>
          <button title="Aumentar zoom (+)" className="zoom-btn" onClick={() => zoomTo(viewRef.current.zoom + ZOOM_STEP)}>+</button>
          {canPip && !tv && (
            <button title="Picture-in-picture (P)" className={pip ? 'on' : ''} onClick={togglePip}><Icon name="pip" /></button>
          )}
          {hasTracks && (
            <button title="Áudio e legendas (C)" onClick={() => setMenuOpen((o) => !o)}>CC</button>
          )}
          <button title="Tela cheia (F)" onClick={fullscreen}><Icon name="fullscreen" /></button>
        </div>
      </div>
      {menuOpen && (
        <div className="track-menu">
          {tracks.audio.length > 1 && (
            <>
              <h4>Áudio</h4>
              {tracks.audio.map((t) => (
                <button key={t.id} className={t.selected ? 'on' : ''} onClick={() => pickTrack('audio', t.id)}>{t.label}</button>
              ))}
            </>
          )}
          <h4>Legendas</h4>
          <button className={tracks.text.some((t) => t.selected) ? '' : 'on'} onClick={() => pickTrack('text', '')}>Desativadas</button>
          {tracks.text.map((t) => (
            <button key={t.id} className={t.selected ? 'on' : ''} onClick={() => pickTrack('text', t.id)}>{t.label}</button>
          ))}
        </div>
      )}
      {hud && <div className="player-hud">{hud.text}</div>}
      {loading && !error && <div className="player-overlay"><div className="spinner" /></div>}
      {error && (
        <div className="player-overlay">
          <p className="player-error">{error}</p>
          <button className="btn small player-retry" autoFocus onClick={retry}>Tentar de novo</button>
        </div>
      )}
    </div>
  )
}

// Control-bar icons are inline SVG: emoji and symbol glyphs (🔊 ⧉ ⛶) show as empty boxes on
// systems without a symbol/emoji font, which includes minimal Linux installs.
const ICONS = {
  volume: 'M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mute: 'M3 9v6h4l5 4V5L7 9H3zm13.6 3L19 9.6 17.6 8.2 15.2 10.6 12.8 8.2 11.4 9.6 13.8 12l-2.4 2.4 1.4 1.4 2.4-2.4 2.4 2.4 1.4-1.4L16.6 12z',
  pip: 'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  fit: 'M5 5h5v2H7v3H5V5zm9 0h5v5h-2V7h-3V5zM5 14h2v3h3v2H5v-5zm12 0h2v5h-5v-2h3v-3z'
}

function Icon({ name }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="1.25em" height="1.25em" fill="currentColor" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  )
}

// How the picture fits the screen. On a 21:9 monitor, 16:9 video shows bars
// on the sides with "Original"; "Preencher" fills by cropping top and bottom;
// "Esticar" fills by stretching. Zoom fine-tunes between the two.
const FIT_MODES = [
  { id: 'contain', label: 'Original', objectFit: 'contain' },
  { id: 'cover', label: 'Preencher', objectFit: 'cover' },
  { id: 'fill', label: 'Esticar', objectFit: 'fill' }
]
const ZOOM_STEP = 0.05
const IDLE_MS = 3000
const VOLUME_KEY = 'player:volume'

const formatTime = (seconds) => {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
const VIEW_KEY = 'player:view'

const nextMode = (id) => FIT_MODES[(FIT_MODES.findIndex((m) => m.id === id) + 1) % FIT_MODES.length].id
const clampZoom = (z) => Math.min(2, Math.max(1, Math.round(z * 100) / 100))

// The fit mode and zoom are remembered across videos and app restarts.
function useViewSettings() {
  const [view, setView] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY))
      if (saved?.mode) return { mode: saved.mode, zoom: clampZoom(Number(saved.zoom) || 1) }
    } catch {
      // ignore unreadable settings
    }
    return { mode: 'contain', zoom: 1 }
  })
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view))
    } catch {
      // storage full or blocked: keep the in-memory value
    }
  }, [view])
  return [view, setView]
}

// Fullscreen goes on the container, not the <video>: Chromium forces
// object-fit: contain on a fullscreen video element, which would undo the fit mode.
function toggleFullscreen(el) {
  if (document.fullscreenElement) document.exitFullscreen()
  else el?.requestFullscreen?.()
}

// Full-window player used for movies, episodes and catch-up.
export function PlayerModal({ title, onClose, ...props }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !document.fullscreenElement && onClose()
    // Android back button closes the modal (the inner player's fullscreen handler runs first).
    const onBack = (e) => {
      // On a TV, back leaves the player in one press; on a phone it first leaves fullscreen.
      if (document.querySelector('.player.menu-open')) return
      if (!isTvMode() && document.querySelector('.player.native-fs')) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('app:back', onBack)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('app:back', onBack)
    }
  }, [onClose])

  return (
    <div className="player-modal">
      <header>
        <button className="btn ghost" onClick={onClose}>← Voltar</button>
        <h2>{title}</h2>
      </header>
      <Player {...props} onClose={onClose} startFullscreen={isTvMode()} />
    </div>
  )
}
