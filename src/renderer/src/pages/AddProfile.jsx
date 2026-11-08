import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getProfile, saveM3uText, saveProfile } from '../lib/store'
import { createXtreamSource } from '../lib/xtream'
import { parseM3u } from '../lib/m3u'
import { fetchM3uText, forgetSource } from '../lib/source'
import { useInitialFocus } from '../lib/tv'

const EMPTY = { name: '', type: 'xtream', server: '', username: '', password: '', m3uUrl: '' }

export default function AddProfile() {
  const navigate = useNavigate()
  const { profileId } = useParams()
  const existing = profileId ? getProfile(profileId) : null
  const [form, setForm] = useState(existing ? { ...EMPTY, ...existing } : EMPTY)
  const [m3uMode, setM3uMode] = useState(existing && existing.type === 'm3u' && !existing.m3uUrl ? 'file' : 'url')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useInitialFocus('.form input')

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const id = existing?.id || crypto.randomUUID()
      let profile

      if (form.type === 'xtream') {
        let server = form.server.trim()
        if (!/^https?:\/\//i.test(server)) server = `http://${server}`
        profile = { id, type: 'xtream', name: form.name.trim(), server, username: form.username.trim(), password: form.password }
        await createXtreamSource(profile).login()
      } else if (m3uMode === 'url') {
        const m3uUrl = form.m3uUrl.trim()
        const count = parseM3u(await fetchM3uText(m3uUrl)).length
        if (!count) throw new Error('A lista está vazia')
        profile = { id, type: 'm3u', name: form.name.trim(), m3uUrl }
      } else {
        const hasStoredFile = existing?.type === 'm3u' && !existing.m3uUrl
        if (!file && !hasStoredFile) throw new Error('Escolha um arquivo .m3u')
        if (file) {
          const text = await file.text()
          if (!parseM3u(text).length) throw new Error('A lista está vazia')
          await saveM3uText(id, text)
        }
        profile = { id, type: 'm3u', name: form.name.trim(), m3uUrl: '' }
      }

      profile.name ||= form.type === 'xtream' ? form.username : 'Minha lista'
      saveProfile(profile)
      forgetSource(id)
      navigate(`/p/${id}`)
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Não foi possível conectar ao servidor. Confira o endereço.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-center">
      <form className="card form" onSubmit={submit}>
        <h1>{existing ? 'Editar lista' : 'Adicionar lista'}</h1>

        <div className="tabs">
          <button type="button" className={form.type === 'xtream' ? 'active' : ''} onClick={() => setForm((f) => ({ ...f, type: 'xtream' }))}>
            Xtream Codes
          </button>
          <button type="button" className={form.type === 'm3u' ? 'active' : ''} onClick={() => setForm((f) => ({ ...f, type: 'm3u' }))}>
            M3U
          </button>
        </div>

        <label>
          Nome da lista
          <input value={form.name} onChange={set('name')} placeholder="Ex.: Casa" />
        </label>

        {form.type === 'xtream' ? (
          <>
            <label>
              Servidor
              <input required value={form.server} onChange={set('server')} placeholder="http://servidor.com:8080" />
            </label>
            <label>
              Usuário
              <input required value={form.username} onChange={set('username')} autoComplete="off" />
            </label>
            <label>
              Senha
              <input required type="password" value={form.password} onChange={set('password')} autoComplete="off" />
            </label>
          </>
        ) : (
          <>
            <div className="tabs small">
              <button type="button" className={m3uMode === 'url' ? 'active' : ''} onClick={() => setM3uMode('url')}>URL</button>
              <button type="button" className={m3uMode === 'file' ? 'active' : ''} onClick={() => setM3uMode('file')}>Arquivo</button>
            </div>
            {m3uMode === 'url' ? (
              <label>
                URL da lista
                <input required value={form.m3uUrl} onChange={set('m3uUrl')} placeholder="http://.../get.php?...&type=m3u_plus" />
              </label>
            ) : (
              <label>
                Arquivo .m3u / .m3u8
                <input type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl" onChange={(e) => setFile(e.target.files[0] || null)} />
              </label>
            )}
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="form-actions">
          <Link className="btn ghost" to="/">Cancelar</Link>
          <button className="btn primary" disabled={busy}>{busy ? 'Conectando...' : 'Salvar e entrar'}</button>
        </div>
      </form>
    </div>
  )
}
