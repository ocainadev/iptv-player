// Pure pieces of the cross-device sync: pairing code, key derivation, encryption and merging.
// No DOM and no app imports, so it runs unchanged in tests.
//
// Pairing code: "<20 chars secret>@<sync server host>", shown as XXXX-XXXX-XXXX-XXXX-XXXX@host.
// The secret never leaves the devices: the server only sees an id derived from it (SHA-256)
// and an AES-GCM blob it cannot read.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 symbols, no 0/O/1/I
const SECRET_LENGTH = 20
const TOMBSTONE_MS = 90 * 24 * 3600 * 1000

const enc = new TextEncoder()

export function newPairCode(server) {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_LENGTH))
  const chars = [...bytes].map((b) => ALPHABET[b % 32]) // 256 % 32 === 0: no bias
  const secret = chars.join('').replace(/(.{4})(?=.)/g, '$1-')
  return `${secret}@${normalizeServer(server)}`
}

export function normalizeServer(input) {
  let value = String(input || '').trim().replace(/\/+$/, '')
  if (!value) throw new Error('Informe o endereço do serviço de sincronização.')
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Endereço do serviço inválido.')
  }
  return url.origin
}

// Accepts the code as typed by a person: any case, with or without dashes.
export function parsePairCode(input) {
  const text = String(input || '').trim()
  const at = text.indexOf('@')
  if (at < 0) throw new Error('Código inválido: falta o "@endereço" no final.')
  const secret = text.slice(0, at).toUpperCase().replace(/[\s-]/g, '')
  if (secret.length !== SECRET_LENGTH || [...secret].some((c) => !ALPHABET.includes(c))) {
    throw new Error('Código inválido. Confira os caracteres.')
  }
  return { secret, base: normalizeServer(text.slice(at + 1)) }
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

function toB64(buf) {
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}

const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

// id: where the blob lives on the server. key: decrypts it. Different derivations on purpose.
export async function deriveKeys(secret) {
  const idHash = await crypto.subtle.digest('SHA-256', enc.encode(`iptv-sync-id|${secret}`))
  const keyHash = await crypto.subtle.digest('SHA-256', enc.encode(`iptv-sync-key|${secret}`))
  const key = await crypto.subtle.importKey('raw', keyHash, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { id: toHex(idHash).slice(0, 32), key }
}

export async function encryptJson(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)))
  return { v: 1, iv: toB64(iv), data: toB64(data) }
}

export async function decryptJson(key, blob) {
  if (!blob || blob.v !== 1) throw new Error('Formato de sincronização desconhecido.')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.data))
  return JSON.parse(new TextDecoder().decode(plain))
}

export const encryptState = encryptJson

export async function decryptState(key, blob) {
  const state = await decryptJson(key, blob)
  return { progress: state.progress || {}, favs: state.favs || {} }
}

// Short pairing number: 8 digits typed on the second device. It only carries the real secret
// across once (valid 5 minutes, deleted on first read); it is not the long-term key.
export function newPairingNumber() {
  let out = ''
  while (out.length < 8) {
    const [n] = crypto.getRandomValues(new Uint32Array(1))
    if (n < 4_294_000_000) out += String(n % 10) // rejection sampling: no modulo bias
  }
  return out
}

export function parsePairingNumber(input) {
  const digits = String(input || '').replace(/[\s-]/g, '')
  if (!/^\d{8}$/.test(digits)) throw new Error('O código tem 8 números.')
  return digits
}

export async function derivePairing(number) {
  const idHash = await crypto.subtle.digest('SHA-256', enc.encode(`iptv-pair-id|${number}`))
  const material = await crypto.subtle.importKey('raw', enc.encode(number), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('iptv-pair-key'), iterations: 100000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  return { id: toHex(idHash).slice(0, 32), key }
}

// Last write wins per key. Ties keep the local copy. Removals travel as entries with
// `removed: true` (progress) or `on: false` (favorites) so they win over older copies.
function mergeByTime(local, remote, time) {
  const out = { ...local }
  for (const [key, entry] of Object.entries(remote || {})) {
    const mine = out[key]
    if (!mine || time(entry) > time(mine)) out[key] = entry
  }
  return out
}

export const mergeProgress = (local, remote) => mergeByTime(local, remote, (e) => e.updatedAt || 0)
export const mergeFavs = (local, remote) => mergeByTime(local, remote, (e) => e.t || 0)

// Tombstones only need to outlive the slowest device's next sync.
export function pruneOld(map, timeOf, isGone, now = Date.now()) {
  const out = {}
  for (const [key, entry] of Object.entries(map)) {
    if (isGone(entry) && now - timeOf(entry) > TOMBSTONE_MS) continue
    out[key] = entry
  }
  return out
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
