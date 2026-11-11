// Profiles, favorites and watch progress live in localStorage.
// M3U file contents can be large, so they go to IndexedDB instead.

import { canonical, mergeFavs, mergeProgress, pruneOld } from './syncCore'

const PROFILES_KEY = 'profiles'

// Lets the sync layer notice local changes without store.js knowing about it.
function emit(name, profileId) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail: { profileId } }))
}

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
  localStorage.removeItem(`favmeta:${id}`)
  localStorage.removeItem(`progress:${id}`)
  await deleteM3uText(id)
}

// Favorites are stored per profile as "kind:id" keys.
export function getFavorites(profileId) {
  return new Set(readJson(`fav:${profileId}`, []))
}

// Each favorite also carries the time of its last change (favmeta), so a removal on one
// device can win over an older "added" on another when profiles are synced.
function favMeta(profileId) {
  const meta = { ...readJson(`favmeta:${profileId}`, {}) }
  for (const key of readJson(`fav:${profileId}`, [])) meta[key] ||= { on: true, t: 0 }
  return meta
}

export function toggleFavorite(profileId, kind, id) {
  const favs = getFavorites(profileId)
  const key = `${kind}:${id}`
  if (favs.has(key)) favs.delete(key)
  else favs.add(key)
  writeJson(`fav:${profileId}`, [...favs])
  writeJson(`favmeta:${profileId}`, { ...favMeta(profileId), [key]: { on: favs.has(key), t: Date.now() } })
  emit('iptv:data', profileId)
  return favs
}

// Watch progress, keyed by a stable id per movie or episode. Removed entries stay as
// `{ removed: true, updatedAt }` so the removal reaches the other devices.
const rawProgress = (profileId) => readJson(`progress:${profileId}`, {})

export function getProgress(profileId, key) {
  const entry = rawProgress(profileId)[key]
  return entry && !entry.removed ? entry : null
}

export function setProgress(profileId, key, entry) {
  const all = rawProgress(profileId)
  all[key] = entry ? { ...entry, updatedAt: Date.now() } : { removed: true, updatedAt: Date.now() }
  writeJson(`progress:${profileId}`, all)
  emit('iptv:data', profileId)
}

export function listProgress(profileId) {
  return Object.entries(rawProgress(profileId))
    .filter(([, value]) => !value.removed)
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// What goes to the other devices: progress and favorites only (never lists or passwords).
export function exportSyncState(profileId) {
  return {
    progress: pruneOld(rawProgress(profileId), (e) => e.updatedAt || 0, (e) => e.removed),
    favs: pruneOld(favMeta(profileId), (e) => e.t || 0, (e) => !e.on)
  }
}

// Merges a state received from another device. Returns true when something changed here.
export function applySyncState(profileId, remote) {
  const localProgress = rawProgress(profileId)
  const progress = mergeProgress(localProgress, remote.progress)
  const localFavs = favMeta(profileId)
  const favs = mergeFavs(localFavs, remote.favs)
  const changed = canonical(progress) !== canonical(localProgress) || canonical(favs) !== canonical(localFavs)
  if (changed) {
    writeJson(`progress:${profileId}`, progress)
    writeJson(`favmeta:${profileId}`, favs)
    writeJson(
      `fav:${profileId}`,
      Object.keys(favs).filter((k) => favs[k].on)
    )
  }
  return changed
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
