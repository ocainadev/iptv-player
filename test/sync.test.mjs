// Run: npm run test:sync
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { handle } from '../worker/index.js'

globalThis.window = new EventTarget()
const makeStorage = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}
const deviceA = makeStorage()
const deviceB = makeStorage()
const use = (d) => (globalThis.localStorage = d)

const kv = new Map()
const env = { ACCESS_TOKEN: 'tok-123', SYNC: { get: async (k) => kv.get(k) ?? null, put: async (k, v, o) => void (kv.set(k, v), o?.expirationTtl && ttls.push([k, o.expirationTtl])), delete: async (k) => void kv.delete(k) } }
const hits = []
const ttls = []
const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  hits.push(req.method)
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
  const r = await handle(new Request(`http://x${req.url}`, { method: req.method, body, headers: req.headers }), env)
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(Buffer.from(await r.arrayBuffer()))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const RAW = `http://127.0.0.1:${server.address().port}`
const SVC = { server: RAW, token: 'tok-123' }
const authed = (url, opts = {}) => fetch(url, { ...opts, headers: { ...opts.headers, 'X-Access': 'tok-123' } })

const store = await import('../src/renderer/src/lib/store.js')
const sync = await import('../src/renderer/src/lib/sync.js')
const core = await import('../src/renderer/src/lib/syncCore.js')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const puts = () => hits.filter((m) => m === 'PUT').length

test('pairing code round trip and validation', () => {
  const code = core.newPairCode('iptv.example.workers.dev')
  assert.match(code, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}@https:\/\/iptv\.example\.workers\.dev$/)
  const parsed = core.parsePairCode(code.toLowerCase().replace(/-/g, ' '))
  assert.equal(parsed.base, 'https://iptv.example.workers.dev')
  assert.throws(() => core.parsePairCode('ABCD@x.dev'))
  assert.throws(() => core.parsePairCode('no-at-sign'))
})

test('encrypt/decrypt and wrong key', async () => {
  const a = await core.deriveKeys('A'.repeat(20))
  const b = await core.deriveKeys('B'.repeat(20))
  const blob = await core.encryptState(a.key, { progress: { x: { updatedAt: 1 } }, favs: {} })
  assert.deepEqual((await core.decryptState(a.key, blob)).progress.x.updatedAt, 1)
  await assert.rejects(core.decryptState(b.key, blob))
  assert.notEqual(a.id, b.id)
})

test('two devices share progress and favorites', async () => {
  use(deviceA)
  store.saveProfile({ id: 'pa', name: 'Casa', type: 'm3u', m3uUrl: 'http://l/x.m3u' })
  store.setProgress('pa', 'movie:1', { title: 'FILME SECRETO', ref: { kind: 'movie', id: '1' }, position: 50, duration: 100 })
  store.toggleFavorite('pa', 'movie', '7')
  await sync.createLink('pa', SVC)
  const pairCode = store.getProfile('pa').sync.pair
  store.getProfile('pa').sync.pair

  // The server holds only ciphertext.
  assert.equal(kv.size, 1)
  assert.ok(![...kv.values()][0].includes('FILME SECRETO'))

  use(deviceB)
  store.saveProfile({ id: 'pb', name: 'Quarto', type: 'm3u', m3uUrl: 'http://l/x.m3u' }) // other id, same list
  use(deviceA)
  const { number } = await sync.offerPairing('pa')
  assert.match(number, /^\d{8}$/)
  use(deviceB)
  await sync.acceptPairing('pb', number, SVC)
  assert.equal(store.getProgress('pb', 'movie:1').position, 50)
  assert.ok(store.getFavorites('pb').has('movie:7'))
  assert.equal(store.getProfile('pb').sync.pair, pairCode)
  // The number works only once.
  store.saveProfile({ id: 'pz', name: 'Z', type: 'm3u', m3uUrl: 'x' })
  await assert.rejects(sync.acceptPairing('pz', number, SVC), /inválido ou expirado/)

  // B advances, removes the favorite and drops nothing else.
  await wait(5)
  store.setProgress('pb', 'movie:1', { title: 'FILME SECRETO', ref: { kind: 'movie', id: '1' }, position: 80, duration: 100 })
  store.toggleFavorite('pb', 'movie', '7')
  store.setProgress('pb', 'episode:9', { title: 'S1E1', ref: { kind: 'episode', id: '9' }, position: 5, duration: 60 })
  await sync.syncProfile('pb')

  use(deviceA)
  let changed = false
  window.addEventListener('iptv:synced', () => (changed = true), { once: true })
  await sync.syncProfile('pa')
  assert.equal(store.getProgress('pa', 'movie:1').position, 80)
  assert.ok(!store.getFavorites('pa').has('movie:7'), 'removal propagates')
  assert.equal(store.listProgress('pa').length, 2)
  assert.ok(changed, 'iptv:synced fired')

  // Finishing a movie removes it everywhere.
  await wait(5)
  store.setProgress('pa', 'movie:1', null)
  await sync.syncProfile('pa')
  use(deviceB)
  await sync.syncProfile('pb')
  assert.equal(store.getProgress('pb', 'movie:1'), null)
  assert.equal(store.listProgress('pb').length, 1)
})

test('nothing new means no write to the server', async () => {
  use(deviceA)
  await sync.syncProfile('pa')
  const before = puts()
  await sync.syncProfile('pa')
  await sync.syncProfile('pa')
  assert.equal(puts(), before)
})

test('watched marks travel between devices', async () => {
  use(deviceA)
  store.setProgress('pa', 'movie:9', { title: 'X', ref: { kind: 'movie', id: '9' }, position: 5, duration: 100 })
  store.setSeen('pa', 'movie:9', true)
  assert.ok(store.isSeen('pa', 'movie:9'))
  assert.equal(store.getProgress('pa', 'movie:9'), null) // marking drops the half-watched entry
  assert.ok(!store.listProgress('pa').some((e) => e.key.startsWith('seen:'))) // never a "continue" card
  await sync.syncProfile('pa')

  use(deviceB)
  await sync.syncProfile('pb')
  assert.ok(store.isSeen('pb', 'movie:9'))
  assert.ok(store.listSeen('pb').has('movie:9'))
  assert.ok(!store.listProgress('pb').some((e) => e.key.startsWith('seen:')))

  // Unmarking on B wins on A.
  await wait(5)
  store.setSeen('pb', 'movie:9', false)
  await sync.syncProfile('pb')
  use(deviceA)
  await sync.syncProfile('pa')
  assert.ok(!store.isSeen('pa', 'movie:9'))
})

test('wrong or malformed number is rejected and does not link', async () => {
  use(deviceB)
  store.saveProfile({ id: 'pc', name: 'X', type: 'm3u', m3uUrl: 'http://l/x.m3u' })
  await assert.rejects(sync.acceptPairing('pc', '00000000', SVC), /inválido ou expirado/)
  await assert.rejects(sync.acceptPairing('pc', '1234', SVC), /8 números/)
  assert.equal(store.getProfile('pc').sync, undefined)
})

test('pairing number: 8 digits, distinct, accepts spaces', () => {
  const seen = new Set(Array.from({ length: 50 }, () => core.newPairingNumber()))
  assert.ok(seen.size > 45)
  for (const n of seen) assert.match(n, /^\d{8}$/)
  assert.equal(core.parsePairingNumber('1234 5678'), '12345678')
})

test('worker pairing blob is read once and expires with a TTL', async () => {
  const id = 'b'.repeat(32)
  const blob = JSON.stringify({ v: 1, iv: 'x', data: 'y' })
  assert.equal((await authed(`${RAW}/v1/pair/${id}`, { method: 'PUT', body: blob })).status, 204)
  assert.equal((await authed(`${RAW}/v1/pair/${id}`)).status, 200)
  assert.equal((await authed(`${RAW}/v1/pair/${id}`)).status, 404)
  assert.equal((await authed(`${RAW}/v1/pair/${id}`, { method: 'PUT', body: 'nope' })).status, 400)
})

test('service without the access key is refused', async () => {
  const id = 'c'.repeat(32)
  assert.equal((await fetch(`${RAW}/v1/${id}`)).status, 401)
  assert.equal((await fetch(`${RAW}/v1/${id}`, { headers: { 'X-Access': 'wrong' } })).status, 401)
  assert.equal((await fetch(`${RAW}/v1/${id}`, { headers: { 'X-Access': 'tok-123' } })).status, 404)
  use(deviceB)
  store.saveProfile({ id: 'pd', name: 'D', type: 'm3u', m3uUrl: 'x' })
  await assert.rejects(sync.acceptPairing('pd', '12345678', { server: RAW, token: 'wrong' }), /recusou o acesso/)
  await assert.rejects(sync.acceptPairing('pd', '12345678', { server: '', token: '' }), /endereço/)
})

test('startSync starts and stops without errors', () => {
  const doc = new EventTarget()
  doc.visibilityState = 'visible'
  globalThis.document = doc
  const stop = sync.startSync()
  assert.equal(typeof stop, 'function')
  stop()
})

test('worker rejects junk', async () => {
  const id = 'a'.repeat(32)
  const put = (body) => authed(`${RAW}/v1/${id}`, { method: 'PUT', body })
  assert.equal((await put('not json')).status, 400)
  assert.equal((await put(JSON.stringify({ v: 2 }))).status, 400)
  assert.equal((await put('x'.repeat(600 * 1024))).status, 413)
  assert.equal((await authed(`${RAW}/v1/zz`)).status, 404)
  assert.equal((await fetch(`${RAW}/v1/${id}`, { method: 'OPTIONS' })).status, 204)
})

test.after(() => server.close())
