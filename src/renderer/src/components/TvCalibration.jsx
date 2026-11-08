import { useEffect, useState } from 'react'
import { MAX_MARGIN, applyTvMargin, getTvMargin, saveTvMargin } from '../lib/tvMargin'

// Full-screen calibration of the TV safe margin: the frame shows where content will stay.
// LEFT/DOWN shrink the margin, RIGHT/UP grow it, OK saves, Back cancels.
export default function TvCalibration({ onClose }) {
  const [initial] = useState(getTvMargin)
  const [pct, setPct] = useState(initial)

  // "Teste do controle": what the remote really sends. Registered before the calibration keys
  // (same capture phase, earlier listener) so it sees every event and changes nothing.
  const [events, setEvents] = useState([])
  useEffect(() => {
    const log = (text) => setEvents((l) => [text, ...l].slice(0, 8))
    const focus = () => document.activeElement?.tagName || '-'
    const onKeyEvent = (e) => log(`${e.type} key=${e.key} code=${e.code || '-'} keyCode=${e.keyCode} foco=${focus()}`)
    const onPointer = (e) => log(`${e.type} alvo=${e.target?.tagName || '-'} foco=${focus()}`)
    const onBack = () => log('app:back (botão Voltar do Android)')
    window.addEventListener('keydown', onKeyEvent, true)
    window.addEventListener('keyup', onKeyEvent, true)
    window.addEventListener('click', onPointer, true)
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('app:back', onBack, true)
    return () => {
      window.removeEventListener('keydown', onKeyEvent, true)
      window.removeEventListener('keyup', onKeyEvent, true)
      window.removeEventListener('click', onPointer, true)
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('app:back', onBack, true)
    }
  }, [])

  useEffect(() => {
    applyTvMargin(pct)
  }, [pct])

  useEffect(() => {
    const cancel = () => {
      applyTvMargin(initial)
      onClose()
    }
    const onKey = (e) => {
      const key = e.key
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[key]
      if (step) setPct((p) => Math.min(MAX_MARGIN, Math.max(0, p + step)))
      else if (key === 'Enter' || e.keyCode === 23) {
        saveTvMargin(pct)
        onClose()
      } else if (key === 'Escape' || key === 'Backspace') cancel()
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const onBack = (e) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      cancel()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('app:back', onBack, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('app:back', onBack, true)
    }
  }, [pct, initial, onClose])

  return (
    <div className="tv-calibration" role="dialog" aria-label="Ajustar margens da tela">
      <div className="tv-frame">
        <h2>Ajustar margens da tela</h2>
        <p>
          Se as bordas do app estiverem cortadas na sua TV, aumente a margem até ver toda a moldura.
          Use ◀ ▶ (ou ▲ ▼) para mudar, OK para salvar e Voltar para cancelar.
        </p>
        <p className="tv-margin-value">Margem: {pct}%</p>
        <p className="muted tv-diag">Tela: {window.innerWidth}×{window.innerHeight} px, escala {window.devicePixelRatio}</p>
        <div className="tv-keytest" aria-label="Teste do controle">
          <strong>Teste do controle</strong>
          {events.length ? events.map((t, i) => <code key={i}>{t}</code>) : <code>Aperte botões do controle para ver o que eles enviam.</code>}
        </div>
      </div>
    </div>
  )
}
