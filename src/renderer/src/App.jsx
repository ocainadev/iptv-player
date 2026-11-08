import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import Profiles from './pages/Profiles'
import AddProfile from './pages/AddProfile'
import Layout from './pages/Layout'
import Home from './pages/Home'
import Live from './pages/Live'
import Catalog from './pages/Catalog'
import MovieDetail from './pages/MovieDetail'
import SeriesDetail from './pages/SeriesDetail'
import Search from './pages/Search'
import UpdateBanner from './components/UpdateBanner'
import { startAutoCheck } from './lib/updates'

// HashRouter because production loads index.html from file://.
export default function App() {
  useEffect(() => startAutoCheck(), [])
  return (
    <HashRouter>
      <UpdateBanner />
      <Routes>
        <Route path="/" element={<Profiles />} />
        <Route path="/add" element={<AddProfile />} />
        <Route path="/edit/:profileId" element={<AddProfile />} />
        <Route path="/p/:profileId" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="live" element={<Live />} />
          {/* key: movies and series must not share category/filter state */}
          <Route path="movie" element={<Catalog key="movie" kind="movie" />} />
          <Route path="series" element={<Catalog key="series" kind="series" />} />
          <Route path="movie/:itemId" element={<MovieDetail />} />
          <Route path="series/:itemId" element={<SeriesDetail />} />
          <Route path="search" element={<Search />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
