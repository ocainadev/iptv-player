import { checkForUpdates, useUpdate } from '../lib/updates'

// Manual "check for updates" button. Finding, downloading and installing an update is shown
// by the UpdateBanner; this only reports the outcomes the banner does not (up to date, errors).
export default function UpdateCheck() {
  const u = useUpdate()
  const busy = u.status === 'checking' || u.status === 'downloading'
  return (
    <div className="update-check">
      <button className="btn ghost small" onClick={() => checkForUpdates({ manual: true })} disabled={busy}>
        {u.status === 'checking' ? 'Verificando...' : 'Verificar atualizações'}
      </button>
      {u.status === 'latest' && <span className="muted">Você está na versão mais recente ({u.info?.current}).</span>}
      {u.status === 'error' && <span className="error-text">{u.message}</span>}
      {u.status === 'downloading' && <span className="muted">Baixando a atualização…</span>}
      {u.status === 'ready' && <span className="muted">Atualização pronta: veja o aviso abaixo.</span>}
    </div>
  )
}
