import { useEffect, useState } from 'react'

// "Check for updates" button backed by the GitHub releases of the project.
// Installed Windows builds download and install in-app; elsewhere it opens the installer download.
export default function UpdateCheck() {
  const [state, setState] = useState({ status: 'idle' })

  useEffect(() => {
    const offs = [
      window.updater.onProgress((percent) => setState((s) => (s.status === 'downloading' ? { ...s, percent } : s))),
      window.updater.onDownloaded(() => setState((s) => ({ ...s, status: 'ready' }))),
      window.updater.onFailed(() =>
        setState((s) => (s.status === 'downloading' ? { status: 'error', message: 'Falha ao baixar a atualização.' } : s))
      )
    ]
    return () => offs.forEach((off) => off())
  }, [])

  async function check() {
    setState({ status: 'checking' })
    const r = await window.updater.check()
    if (!r.ok) setState({ status: 'error', message: r.error })
    else if (r.hasUpdate) setState({ status: 'available', info: r })
    else setState({ status: 'latest', current: r.current })
  }

  async function download() {
    setState((s) => ({ ...s, status: 'downloading', percent: 0 }))
    const ok = await window.updater.download()
    if (!ok) setState({ status: 'error', message: 'Falha ao baixar a atualização.' })
  }

  const { status, info } = state

  if (status === 'available') {
    return (
      <div className="update-check">
        <span>Nova versão {info.latest} disponível (você tem {info.current}).</span>
        {info.mode === 'auto' ? (
          <button className="btn primary small" onClick={download}>Baixar e instalar</button>
        ) : (
          <button className="btn primary small" onClick={() => window.updater.open(info.downloadUrl)}>
            Baixar atualização
          </button>
        )}
      </div>
    )
  }
  if (status === 'downloading') {
    return <div className="update-check"><span>Baixando atualização... {state.percent}%</span></div>
  }
  if (status === 'ready') {
    return (
      <div className="update-check">
        <span>Atualização pronta.</span>
        <button className="btn primary small" onClick={() => window.updater.install()}>Reiniciar e instalar</button>
      </div>
    )
  }

  return (
    <div className="update-check">
      <button className="btn ghost small" onClick={check} disabled={status === 'checking'}>
        {status === 'checking' ? 'Verificando...' : 'Verificar atualizações'}
      </button>
      {status === 'latest' && <span className="muted">Você está na versão mais recente ({state.current}).</span>}
      {status === 'error' && <span className="error-text">{state.message}</span>}
    </div>
  )
}
