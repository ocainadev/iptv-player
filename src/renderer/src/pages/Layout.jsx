import { useCallback, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useParams } from 'react-router-dom'
import { getFavorites, getProfile, toggleFavorite } from '../lib/store'
import { getSource } from '../lib/source'
import { ErrorState, Loading, useAsync } from '../components/common'
import logo from '../assets/logo.svg'

// Loads the profile's source once and shares it with every child page
// through the outlet context.
export default function Layout() {
  const { profileId } = useParams()
  const profile = getProfile(profileId)
  const [favorites, setFavorites] = useState(() => getFavorites(profileId))
  const { data: source, loading, error, retry } = useAsync(
    () => (profile ? getSource(profile) : Promise.reject(new Error('Perfil não encontrado'))),
    [profileId]
  )

  const toggleFav = useCallback((kind, id) => setFavorites(new Set(toggleFavorite(profileId, kind, id))), [profileId])

  if (!profile) return <Navigate to="/" replace />

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand small" title="Trocar de lista">
          <img src={logo} alt="" className="brand-logo" />
          IPTV Player
        </Link>
        <nav>
          <NavLink end to={`/p/${profileId}`}>Início</NavLink>
          <NavLink to={`/p/${profileId}/live`}>TV ao vivo</NavLink>
          <NavLink to={`/p/${profileId}/movie`}>Filmes</NavLink>
          <NavLink to={`/p/${profileId}/series`}>Séries</NavLink>
          <NavLink to={`/p/${profileId}/search`}>Buscar</NavLink>
        </nav>
        <span className="muted profile-name">{profile.name}</span>
      </header>
      <main className="content">
        {loading ? (
          <Loading text="Carregando lista..." />
        ) : error ? (
          <ErrorState error={error} onRetry={retry} />
        ) : (
          <Outlet context={{ profile, source, favorites, toggleFav }} />
        )}
      </main>
    </div>
  )
}
