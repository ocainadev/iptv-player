import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { enterNativeFullscreen, exitNativeFullscreen, isNative } from '../lib/native'
import { isTvMode } from '../lib/tv'
import { NativePlayer } from '../lib/exo'

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

const UNSUPPORTED_HINT =
  'Formato ou codec não suportado pelo Chromium (comum em MKV, HEVC/H.265 e áudio AC3/DTS).'

export default function Player({ url, fallbackUrl, isLive = false, startAt = 0, onProgress, autoPlay = true, startFullscreen = false }) {
  const videoRef = useRef(null)
  const slotRef = useRef(null)
  // Audio and subtitle tracks of the current stream, and how to switch them.
  const [tracks, setTracks] = useState({ audio: [], text: [] })
  const [menuOpen, setMenuOpen] = useState(false)
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

  useEffect(() => {
    setActiveUrl(url)
    setError('')
  }, [url])

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
        await NativePlayer.addListener('state', ({ state }) => setLoading(state === 'buffering')),
        await NativePlayer.addListener('time', (t) => {
          exo.current = t
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
            fail(network ? 'Não foi possível carregar o stream.' : 'Formato ou codec não suportado neste aparelho.')
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
  }, [activeUrl, isLive, startAt, autoPlay])

  useEffect(() => {
    const video = videoRef.current
    if (isNative || !video || !activeUrl) return
    endPipSession()
    setLoading(true)
    setError('')

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
          fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'Não foi possível carregar o stream.' : UNSUPPORTED_HINT)
        }
      })
      hls.loadSource(activeUrl)
      hls.attachMedia(video)
    } else if (engine === 'mpegts' && mpegts.isSupported()) {
      ts = mpegts.createPlayer({ type: 'mpegts', isLive, url: activeUrl }, { enableWorker: true, lazyLoad: !isLive })
      ts.on(mpegts.Events.ERROR, (type) => {
        fail(type === mpegts.ErrorTypes.NETWORK_ERROR ? 'Não foi possível carregar o stream.' : UNSUPPORTED_HINT)
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
    const onPlaying = () => setLoading(false)
    const onWaiting = () => setLoading(true)
    const onVideoError = () => {
      if (!hls && !ts) fail(UNSUPPORTED_HINT)
    }

    let lastReport = 0
    const onTime = () => {
      if (!onProgress || isLive) return
      const now = Date.now()
      if (now - lastReport < 5000) return
      lastReport = now
      onProgress(video.currentTime, video.duration)
    }

    video.addEventListener('loadedmetadata', onLoaded)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('error', onVideoError)
    video.addEventListener('timeupdate', onTime)

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
      if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {})
      video.textTracks.removeEventListener('addtrack', readTracks)
      video.textTracks.removeEventListener('change', readTracks)
      video.audioTracks?.removeEventListener?.('addtrack', readTracks)
      setTracks({ audio: [], text: [] })
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('error', onVideoError)
      video.removeEventListener('timeupdate', onTime)
      teardown()
    }
    // onProgress is intentionally left out: a new callback identity must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl, isLive, startAt, autoPlay])

  const containerRef = useRef(null)
  const [view, setView] = useViewSettings()
  // On Android the Fullscreen API is unreliable inside the WebView, so fullscreen is
  // a fixed-position CSS layer plus a landscape lock; elsewhere it is the real API.
  const [nativeFs, setNativeFs] = useState(isNative && startFullscreen)
  const tv = isTvMode()
  const [hud, setHud] = useState(null)
  // Toolbar and touch controls fade out after a few seconds without interaction.
  const [idle, setIdle] = useState(false)
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
    } else if (hasTracks && (key === 'ArrowDown' || key === 'ArrowUp' || key === 'ContextMenu')) setMenuOpen(true)
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
      if (key === 'a') setView((v) => ({ ...v, mode: nextMode(v.mode) }))
      else if (key === '+' || key === '=') setView((v) => ({ ...v, zoom: clampZoom(v.zoom + ZOOM_STEP) }))
      else if (key === '-') setView((v) => ({ ...v, zoom: clampZoom(v.zoom - ZOOM_STEP) }))
      else if (key === '0') setView((v) => ({ ...v, zoom: 1 }))
      else if (key === 'f') fullscreen()
      else if (key === 'c' && hasTracks) setMenuOpen((o) => !o)
      else if (key === 'p' && canPip && !tv) togglePip()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, hasTracks])

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

  const togglePlay = () => (exo.current.playing ? NativePlayer.pause() : NativePlayer.play())

  return (
    <div
      className={`player${nativeFs ? ' native-fs' : ''}${idle ? ' idle' : ''}${menuOpen ? ' menu-open' : ''}`}
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
          controls={!tv}
          controlsList="nofullscreen"
          playsInline
          style={{ objectFit: mode.objectFit, transform: view.zoom !== 1 ? `scale(${view.zoom})` : undefined }}
          onDoubleClick={fullscreen}
        />
      )}
      {isNative && !tv && <ExoBar exo={exo} isLive={isLive} onToggle={togglePlay} />}
      <div className="player-toolbar">
        <button title="Ajuste à tela (A)" onClick={() => setView((v) => ({ ...v, mode: nextMode(v.mode) }))}>
          ⤢ {mode.label}
        </button>
        <button title="Diminuir zoom (-)" className="zoom-btn" onClick={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom - ZOOM_STEP) }))}>−</button>
        <button title="Zoom normal (0)" className="zoom-btn zoom-value" onClick={() => setView((v) => ({ ...v, zoom: 1 }))}>
          {Math.round(view.zoom * 100)}%
        </button>
        <button title="Aumentar zoom (+)" className="zoom-btn" onClick={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom + ZOOM_STEP) }))}>+</button>
        {canPip && !tv && (
          <button title="Picture-in-picture (P)" className={pip ? 'on' : ''} onClick={togglePip}>⧉</button>
        )}
        {hasTracks && (
          <button title="Áudio e legendas (C)" onClick={() => setMenuOpen((o) => !o)}>CC</button>
        )}
        <button title="Tela cheia (F)" onClick={fullscreen}>⛶</button>
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
        </div>
      )}
    </div>
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
      <Player {...props} startFullscreen={isTvMode()} />
    </div>
  )
}

// Touch controls for the ExoPlayer picture: play/pause and, for movies, a seek bar.
function ExoBar({ exo, isLive, onToggle }) {
  const [t, setT] = useState(exo.current)
  useEffect(() => {
    const timer = setInterval(() => setT({ ...exo.current }), 500)
    return () => clearInterval(timer)
  }, [exo])
  return (
    <div className="exo-bar">
      <button onClick={onToggle}>{t.playing ? '⏸' : '▶'}</button>
      {!isLive && t.duration > 0 && (
        <input
          type="range"
          min="0"
          max={t.duration}
          step="1"
          value={t.position}
          onChange={(e) => {
            const position = Number(e.target.value)
            exo.current.position = position
            setT((v) => ({ ...v, position }))
            NativePlayer.seekTo({ position })
          }}
        />
      )}
    </div>
  )
}
