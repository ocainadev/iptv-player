import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useParams } from 'react-router-dom'
import { isTvMode } from '../lib/tv'
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

  // Favorites changed by another device arrive through the sync.
  useEffect(() => {
    const onSynced = (e) => e.detail?.profileId === profileId && setFavorites(getFavorites(profileId))
    window.addEventListener('iptv:synced', onSynced)
    return () => window.removeEventListener('iptv:synced', onSynced)
  }, [profileId])

  const toggleFav = useCallback((kind, id) => setFavorites(new Set(toggleFavorite(profileId, kind, id))), [profileId])

  if (!profile) return <Navigate to="/" replace />

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand small" title="Trocar de lista" tabIndex={isTvMode() ? -1 : undefined}>
          <img src={logo} alt="" className="brand-logo" />
          Telara
        </Link>
        <nav>
          <NavLink replace end to={`/p/${profileId}`}>Início</NavLink>
          <NavLink replace to={`/p/${profileId}/live`}>TV ao vivo</NavLink>
          <NavLink replace to={`/p/${profileId}/movie`}>Filmes</NavLink>
          <NavLink replace to={`/p/${profileId}/series`}>Séries</NavLink>
          <NavLink replace to={`/p/${profileId}/search`}>Buscar</NavLink>
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
