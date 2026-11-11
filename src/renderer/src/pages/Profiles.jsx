import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { deleteProfile, listProfiles } from '../lib/store'
import { forgetSource } from '../lib/source'
import { showUpdate, useUpdate } from '../lib/updates'
import { getAppVersion } from '../lib/version'
import { isTvMode, useInitialFocus } from '../lib/tv'
import TvCalibration from '../components/TvCalibration'
import logo from '../assets/logo.svg'

export default function Profiles() {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState(listProfiles)
  const [confirming, setConfirming] = useState(null)
  const [version, setVersion] = useState('')
  const [calibrating, setCalibrating] = useState(false)
  const tv = isTvMode()
  const update = useUpdate()
  useInitialFocus(['.profile-open', '.profile-card.add'])
  useEffect(() => {
    getAppVersion().then(setVersion)
  }, [])
  const newVersion = ['available', 'downloading', 'ready'].includes(update.status) && String(update.info?.latest || '').replace(/^v/i, '')

  async function remove(id) {
    await deleteProfile(id)
    forgetSource(id)
    setConfirming(null)
    setProfiles(listProfiles())
  }

  return (
    <div className="page-center">
      <img src={logo} alt="" className="brand-logo large" />
      <h1 className="brand">IPTV Player</h1>
      <p className="muted">Escolha uma lista ou adicione uma nova.</p>
      <div className="profile-grid">
        {profiles.map((p) => (
          <div key={p.id} className="profile-card">
            <button className="profile-open" onClick={() => navigate(`/p/${p.id}`)}>
              <span className="profile-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
              <strong>{p.name}</strong>
              <small>{p.type === 'xtream' ? 'Xtream Codes' : p.m3uUrl ? 'M3U (URL)' : 'M3U (arquivo)'}</small>
            </button>
            <div className="profile-actions">
              <Link className="btn ghost small" to={`/edit/${p.id}`}>Editar</Link>
              <Link className="btn ghost small" to={`/sync/${p.id}`}>{p.sync ? 'Sincronizado' : 'Sincronizar'}</Link>
              {confirming === p.id ? (
                <>
                  <button className="btn danger small" onClick={() => remove(p.id)}>Confirmar</button>
                  <button className="btn ghost small" onClick={() => setConfirming(null)}>Cancelar</button>
                </>
              ) : (
                <button className="btn ghost small" onClick={() => setConfirming(p.id)}>Excluir</button>
              )}
            </div>
          </div>
        ))}

        <Link to="/add" className="profile-card add">
          <span className="profile-avatar">+</span>
          <strong>Adicionar lista</strong>
        </Link>
      </div>

      {(version || newVersion || tv) && (
        <p className="app-version muted">
          {version && <span>v{version}</span>}
          {newVersion && (
            <button
              className="version-update"
              title={`Nova versão ${newVersion} disponível`}
              aria-label={`Nova versão ${newVersion} disponível`}
              onClick={showUpdate}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" />
              </svg>
            </button>
          )}
          {tv && (
            <button className="btn ghost small tv-calibrate" onClick={() => setCalibrating(true)}>
              Ajustar margens da tela
            </button>
          )}
        </p>
      )}
      {calibrating && <TvCalibration onClose={() => setCalibrating(false)} />}
    </div>
  )
}
