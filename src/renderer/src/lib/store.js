// Profiles, favorites and watch progress live in localStorage.
// M3U file contents can be large, so they go to IndexedDB instead.

const PROFILES_KEY = 'profiles'

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function listProfiles() {
  return readJson(PROFILES_KEY, [])
}

export function getProfile(id) {
  return listProfiles().find((p) => p.id === id) || null
}

export function saveProfile(profile) {
  const profiles = listProfiles()
  const index = profiles.findIndex((p) => p.id === profile.id)
  if (index >= 0) profiles[index] = profile
  else profiles.push(profile)
  writeJson(PROFILES_KEY, profiles)
}

export async function deleteProfile(id) {
  writeJson(
    PROFILES_KEY,
    listProfiles().filter((p) => p.id !== id)
  )
  localStorage.removeItem(`fav:${id}`)
  localStorage.removeItem(`progress:${id}`)
  await deleteM3uText(id)
}

// Favorites are stored per profile as "kind:id" keys.
export function getFavorites(profileId) {
  return new Set(readJson(`fav:${profileId}`, []))
}

export function toggleFavorite(profileId, kind, id) {
  const favs = getFavorites(profileId)
  const key = `${kind}:${id}`
  if (favs.has(key)) favs.delete(key)
  else favs.add(key)
  writeJson(`fav:${profileId}`, [...favs])
  return favs
}

// Watch progress, keyed by a stable id per movie or episode.
export function getProgress(profileId, key) {
  return readJson(`progress:${profileId}`, {})[key] || null
}

export function setProgress(profileId, key, entry) {
  const all = readJson(`progress:${profileId}`, {})
  if (entry) all[key] = { ...entry, updatedAt: Date.now() }
  else delete all[key]
  writeJson(`progress:${profileId}`, all)
}

export function listProgress(profileId) {
  return Object.entries(readJson(`progress:${profileId}`, {}))
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iptv-player', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('m3u')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb(mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('m3u', mode)
    const req = fn(tx.objectStore('m3u'))
    const fail = () => {
      db.close()
      reject(tx.error || new Error('Falha ao salvar a lista (espaço insuficiente?)'))
    }
    tx.oncomplete = () => {
      db.close()
      resolve(req.result)
    }
    tx.onerror = fail
    tx.onabort = fail
  })
}

export const saveM3uText = (id, text) => idb('readwrite', (s) => s.put(text, id))
export const loadM3uText = (id) => idb('readonly', (s) => s.get(id))
export const deleteM3uText = (id) => idb('readwrite', (s) => s.delete(id))
