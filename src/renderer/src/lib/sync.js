// Keeps "continue watching" and favorites of a profile in step across devices.
// A profile is linked with a pairing code (see syncCore.js); the state is encrypted on the
// device, so the sync server only stores an opaque blob. Lists and passwords never leave.
import { applySyncState, exportSyncState, getProfile, listProfiles, saveProfile } from './store'
import {
  canonical,
  decryptJson,
  decryptState,
  derivePairing,
  deriveKeys,
  encryptJson,
  encryptState,
  newPairCode,
  newPairingNumber,
  normalizeServer,
  parsePairCode,
  parsePairingNumber
} from './syncCore'

// Each person runs their own sync service (see "Syncing progress between devices" in the README)
// and types its address and access key once per device. They are kept only on that device.
const SERVICE_KEY = 'sync:service'
// The free KV tier allows ~1000 writes a day: playback progress is pushed at most this often.
const PUSH_GAP_MS = 120_000
const POLL_MS = 10 * 60_000

export function getSavedService() {
  try {
    const saved = JSON.parse(localStorage.getItem(SERVICE_KEY))
    return { server: saved?.server || '', token: saved?.token || '' }
  } catch {
    return { server: '', token: '' }
  }
}

// Validates what was typed and remembers it. Returns { base, token }.
export function saveService({ server, token }) {
  const base = normalizeServer(server)
  const clean = String(token || '').trim()
  localStorage.setItem(SERVICE_KEY, JSON.stringify({ server: base, token: clean }))
  return { base, token: clean }
}

// Headers for every call to the service.
function auth(extra = {}) {
  const { token } = getSavedService()
  return token ? { ...extra, 'X-Access': token } : extra
}

const denied = (status) => (status === 401 ? 'O serviço recusou o acesso: confira a chave de acesso.' : null)

function patchSync(profileId, patch) {
  const profile = getProfile(profileId)
  if (!profile?.sync) return
  saveProfile({ ...profile, sync: { ...profile.sync, ...patch } })
}

async function run(profileId, { mustExist = false, force = false } = {}) {
  const profile = getProfile(profileId)
  if (!profile?.sync?.pair) return false
  const { secret, base } = parsePairCode(profile.sync.pair)
  const { id, key } = await deriveKeys(secret)
  const url = `${base}/v1/${id}`

  let remote = { progress: {}, favs: {} }
  const res = await fetch(url, { cache: 'no-store', headers: auth() })
  if (denied(res.status)) throw new Error(denied(res.status))
  if (res.status === 200) {
    try {
      remote = await decryptState(key, await res.json())
    } catch {
      throw new Error('Não foi possível ler os dados do serviço: o código não confere.')
    }
  } else if (res.status === 404 && mustExist) {
    throw new Error('Código não encontrado. Confira se foi digitado igual ao do outro aparelho.')
  } else if (res.status !== 404) {
    throw new Error(`O serviço de sincronização respondeu ${res.status}.`)
  }

  const changed = applySyncState(profileId, remote)
  const local = exportSyncState(profileId)
  // Writes are scarce on the free tier: send only when this device knows something new.
  if (force || canonical(local) !== canonical(remote)) {
    const put = await fetch(url, {
      method: 'PUT',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(await encryptState(key, local))
    })
    if (denied(put.status)) throw new Error(denied(put.status))
    if (!put.ok) throw new Error(`O serviço de sincronização recusou os dados (${put.status}).`)
  }
  patchSync(profileId, { lastSync: Date.now(), lastError: '' })
  return changed
}

const inFlight = new Map()

// Pulls, merges and (when needed) pushes. Rejects with a message fit for the user.
export function syncProfile(profileId, options) {
  if (inFlight.has(profileId)) return inFlight.get(profileId)
  const job = run(profileId, options)
    .then((changed) => {
      if (changed) window.dispatchEvent(new CustomEvent('iptv:synced', { detail: { profileId } }))
      return changed
    })
    .catch((err) => {
      const message = err.message === 'Failed to fetch' ? 'Sem conexão com o serviço de sincronização.' : err.message
      patchSync(profileId, { lastError: message })
      throw new Error(message)
    })
    .finally(() => inFlight.delete(profileId))
  inFlight.set(profileId, job)
  return job
}

export function syncAll() {
  for (const profile of listProfiles()) {
    if (profile.sync?.pair) syncProfile(profile.id).catch(() => {})
  }
}

// Links the profile to the typed service and makes it the first device of the group.
export async function createLink(profileId, service) {
  const { base } = saveService(service)
  linkProfile(profileId, newPairCode(base))
  await syncProfile(profileId, { force: true })
}

// Device that is already linked: makes an 8-digit number the other device types in.
// The number is valid for 5 minutes and works once.
export async function offerPairing(profileId) {
  const profile = getProfile(profileId)
  if (!profile?.sync?.pair) throw new Error('Este perfil ainda não está sincronizado.')
  const { base } = parsePairCode(profile.sync.pair)
  const number = newPairingNumber()
  const { id, key } = await derivePairing(number)
  const res = await fetch(`${base}/v1/pair/${id}`, {
    method: 'PUT',
    headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(await encryptJson(key, { pair: profile.sync.pair }))
  }).catch(() => {
    throw new Error('Sem conexão com o serviço de sincronização.')
  })
  if (denied(res.status)) throw new Error(denied(res.status))
  if (!res.ok) throw new Error(`O serviço de sincronização recusou o pedido (${res.status}).`)
  return { number, expiresAt: Date.now() + 5 * 60_000 }
}

// Second device: types the 8 numbers, receives the real secret and links this profile to it.
export async function acceptPairing(profileId, input, service) {
  const number = parsePairingNumber(input)
  const { base } = saveService(service)
  const { id, key } = await derivePairing(number)
  const res = await fetch(`${base}/v1/pair/${id}`, { cache: 'no-store', headers: auth() }).catch(() => {
    throw new Error('Sem conexão com o serviço de sincronização.')
  })
  if (denied(res.status)) throw new Error(denied(res.status))
  if (res.status === 404) throw new Error('Código inválido ou expirado. Gere outro no aparelho que já está sincronizado.')
  if (!res.ok) throw new Error(`O serviço de sincronização respondeu ${res.status}.`)
  let pair
  try {
    pair = (await decryptJson(key, await res.json())).pair
    parsePairCode(pair)
  } catch {
    throw new Error('Código inválido ou expirado. Gere outro no aparelho que já está sincronizado.')
  }
  linkProfile(profileId, pair)
  try {
    await syncProfile(profileId, { mustExist: true })
  } catch (err) {
    unlink(profileId)
    throw err
  }
}

function linkProfile(profileId, pair) {
  const profile = getProfile(profileId)
  saveProfile({ ...profile, sync: { pair, lastSync: 0, lastError: '' } })
}

export function unlink(profileId) {
  const profile = getProfile(profileId)
  if (!profile) return
  const { sync, ...rest } = profile // eslint-disable-line no-unused-vars
  saveProfile(rest)
}

// Background behavior: push soon after changes (rate limited), push when leaving, pull on return.
export function startSync() {
  let timer = null
  let lastRun = 0
  const pending = new Set()

  const flush = () => {
    clearTimeout(timer)
    timer = null
    lastRun = Date.now()
    for (const id of pending) syncProfile(id).catch(() => {})
    pending.clear()
  }
  const onData = (e) => {
    const id = e.detail?.profileId
    if (!id || !getProfile(id)?.sync?.pair) return
    pending.add(id)
    if (timer) return
    timer = setTimeout(flush, Math.max(5000, lastRun + PUSH_GAP_MS - Date.now()))
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (pending.size) flush()
    } else {
      syncAll()
    }
  }

  window.addEventListener('iptv:data', onData)
  window.addEventListener('iptv:flush', flush)
  document.addEventListener('visibilitychange', onVisibility)
  const first = setTimeout(syncAll, 3000)
  const poll = setInterval(syncAll, POLL_MS)
  return () => {
    window.removeEventListener('iptv:data', onData)
    window.removeEventListener('iptv:flush', flush)
    document.removeEventListener('visibilitychange', onVisibility)
    clearTimeout(first)
    clearTimeout(timer)
    clearInterval(poll)
  }
}
