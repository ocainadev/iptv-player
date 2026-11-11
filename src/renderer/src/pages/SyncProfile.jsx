import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { getProfile } from '../lib/store'
import { acceptPairing, createLink, getSavedService, offerPairing, syncProfile, unlink } from '../lib/sync'
import { useInitialFocus } from '../lib/tv'

// Links a profile to the same "continue watching" and favorites on other devices.
export default function SyncProfile() {
  const { profileId } = useParams()
  const [profile, setProfile] = useState(() => getProfile(profileId))
  const [mode, setMode] = useState('create')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [service, setService] = useState(getSavedService)
  const available = !!service.server.trim()
  const [offer, setOffer] = useState(null) // { number, expiresAt } while a pairing number is valid
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!offer) return
    const tick = () => {
      const seconds = Math.max(0, Math.round((offer.expiresAt - Date.now()) / 1000))
      setLeft(seconds)
      if (!seconds) setOffer(null)
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [offer])
  useInitialFocus('.form input, .form .btn')

  if (!profile) return <Navigate to="/" replace />
  const reload = () => setProfile(getProfile(profileId))

  async function act(fn, done) {
    setError('')
    setNote('')
    setBusy(true)
    try {
      await fn()
      if (done) setNote(done)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      reload()
    }
  }

  const last = profile.sync?.lastSync ? new Date(profile.sync.lastSync).toLocaleString('pt-BR') : 'ainda não'

  return (
    <div className="page-center">
      <div className="card form">
        <h1>Sincronizar “{profile.name}”</h1>
        <p className="muted">
          Mantém “continuar assistindo” e favoritos iguais nos aparelhos ligados a este código. A lista, o usuário e a senha
          não são enviados: cada aparelho cadastra a sua. Os dados vão criptografados.
        </p>

        {profile.sync ? (
          <>
            <p className="muted">Última sincronização: {last}</p>
            {offer ? (
              <div className="card">
                <p className="muted">Digite este código no outro aparelho, em “Tenho um código”:</p>
                <p className="pair-number">{offer.number.replace(/(\d{4})(\d{4})/, '$1 $2')}</p>
                <p className="muted">Vale por {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} e funciona uma vez.</p>
              </div>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => act(async () => setOffer(await offerPairing(profileId)))}>
                Gerar código para outro aparelho
              </button>
            )}
            {profile.sync.lastError && <p className="error-text">{profile.sync.lastError}</p>}
            <div className="form-actions">
              <button className="btn ghost" disabled={busy} onClick={() => act(() => syncProfile(profileId), 'Sincronizado.')}>
                {busy ? 'Sincronizando...' : 'Sincronizar agora'}
              </button>
              <button className="btn danger small" disabled={busy} onClick={() => act(async () => unlink(profileId), 'Desconectado.')}>
                Desconectar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="tabs small">
              <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>Primeiro aparelho</button>
              <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>Tenho um código</button>
            </div>
            {mode === 'create' ? (
              <button className="btn primary" disabled={busy || !available} onClick={() => act(() => createLink(profileId, service))}>
                {busy ? 'Ativando...' : 'Ativar sincronização'}
              </button>
            ) : (
              <>
                <label>
                  Código de 8 números do outro aparelho
                  <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={9} placeholder="0000 0000" autoComplete="off" />
                </label>
                <button className="btn primary" disabled={busy || !available || code.replace(/\D/g, '').length !== 8} onClick={() => act(() => acceptPairing(profileId, code, service))}>
                  {busy ? 'Conectando...' : 'Conectar'}
                </button>
              </>
            )}
            <label>
              Endereço do seu serviço de sincronização
              <input value={service.server} onChange={(e) => setService((v) => ({ ...v, server: e.target.value }))} placeholder="https://nome.conta.workers.dev" autoComplete="off" />
            </label>
            <label>
              Chave de acesso (se você criou uma)
              <input type="password" value={service.token} onChange={(e) => setService((v) => ({ ...v, token: e.target.value }))} autoComplete="off" />
            </label>
            <p className="muted">Não tem um serviço ainda? O passo a passo está no README do projeto, em “Syncing progress between devices”.</p>
          </>
        )}

        {note && <p className="muted">{note}</p>}
        {error && <p className="error-text">{error}</p>}
        <div className="form-actions">
          <Link className="btn ghost" to="/">Voltar</Link>
        </div>
      </div>
    </div>
  )
}
