import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'

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

const UNSUPPORTED_HINT =
  'Formato ou codec não suportado pelo Chromium (comum em MKV, HEVC/H.265 e áudio AC3/DTS).'

export default function Player({ url, fallbackUrl, isLive = false, startAt = 0, onProgress, autoPlay = true }) {
  const videoRef = useRef(null)
  const [activeUrl, setActiveUrl] = useState(url)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setActiveUrl(url)
    setError('')
  }, [url])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !activeUrl) return
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

    return () => {
      if (onProgress && !isLive && video.currentTime > 0) onProgress(video.currentTime, video.duration)
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('error', onVideoError)
      video.removeEventListener('timeupdate', onTime)
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
    // onProgress is intentionally left out: a new callback identity must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl, isLive, startAt, autoPlay])

  const containerRef = useRef(null)
  const [view, setView] = useViewSettings()
  const fullscreen = () => toggleFullscreen(containerRef.current)

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
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])

  const mode = FIT_MODES.find((m) => m.id === view.mode) || FIT_MODES[0]

  return (
    <div className="player" ref={containerRef}>
      <video
        ref={videoRef}
        controls
        controlsList="nofullscreen"
        playsInline
        style={{ objectFit: mode.objectFit, transform: view.zoom !== 1 ? `scale(${view.zoom})` : undefined }}
        onDoubleClick={fullscreen}
      />
      <div className="player-toolbar">
        <button title="Ajuste à tela (A)" onClick={() => setView((v) => ({ ...v, mode: nextMode(v.mode) }))}>
          ⤢ {mode.label}
        </button>
        <button title="Diminuir zoom (-)" onClick={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom - ZOOM_STEP) }))}>−</button>
        <button title="Zoom normal (0)" className="zoom-value" onClick={() => setView((v) => ({ ...v, zoom: 1 }))}>
          {Math.round(view.zoom * 100)}%
        </button>
        <button title="Aumentar zoom (+)" onClick={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom + ZOOM_STEP) }))}>+</button>
        <button title="Tela cheia (F)" onClick={fullscreen}>⛶</button>
      </div>
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="player-modal">
      <header>
        <button className="btn ghost" onClick={onClose}>← Voltar</button>
        <h2>{title}</h2>
      </header>
      <Player {...props} />
    </div>
  )
}
