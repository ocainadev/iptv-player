import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { deleteProfile, listProfiles } from '../lib/store'
import { forgetSource } from '../lib/source'
import UpdateCheck from '../components/UpdateCheck'
import logo from '../assets/logo.svg'

export default function Profiles() {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState(listProfiles)
  const [confirming, setConfirming] = useState(null)

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

      <UpdateCheck />
    </div>
  )
}
