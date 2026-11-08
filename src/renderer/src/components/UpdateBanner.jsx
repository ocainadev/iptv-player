import { dismissUpdate, downloadUpdate, installUpdate, openDownload, useUpdate } from '../lib/updates'

const INSTALL_LABEL = { auto: 'Reiniciar e instalar', mac: 'Instalar e reiniciar', apk: 'Instalar' }

// Discreet notice at the bottom of the screen. It stays out of the way while a video plays
// (hidden by CSS whenever a player is open).
export default function UpdateBanner() {
  const u = useUpdate()
  if (u.dismissed) return null
  const version = u.info?.latest

  let content = null
  if (u.status === 'downloading') {
    content = <span>Baixando a atualização {version}… {u.percent}%</span>
  } else if (u.status === 'ready') {
    content = (
      <>
        <span>{u.message || `Atualização ${version} pronta.`}</span>
        <button className="btn primary small" onClick={installUpdate}>{INSTALL_LABEL[u.info?.mode] || 'Instalar'}</button>
        <button className="btn ghost small" onClick={dismissUpdate}>Depois</button>
      </>
    )
  } else if (u.status === 'available') {
    // Modes that cannot download by themselves (portable Windows): just a link.
    content = (
      <>
        <span>Nova versão {version} disponível.</span>
        <button className="btn primary small" onClick={openDownload}>Baixar</button>
        <button className="btn ghost small" onClick={dismissUpdate}>Depois</button>
      </>
    )
  } else if (u.status === 'error' && u.manual) {
    content = (
      <>
        <span>{u.message}</span>
        <button className="btn ghost small" onClick={() => (u.info ? downloadUpdate() : dismissUpdate())}>
          {u.info ? 'Tentar de novo' : 'Fechar'}
        </button>
      </>
    )
  }
  if (!content) return null
  return <div className="update-banner" role="status">{content}</div>
}
