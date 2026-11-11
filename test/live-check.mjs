// Manual check against a deployed service: node --import ./test/register.mjs test/live-check.mjs <address>
globalThis.window = new EventTarget()
const mk = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } }
const A = mk(), B = mk()
const store = await import('../src/renderer/src/lib/store.js')
const sync = await import('../src/renderer/src/lib/sync.js')
const core = await import('../src/renderer/src/lib/syncCore.js')
const [address, token = ''] = process.argv[2].split('#')
const svc = { server: address, token }
const server = address
globalThis.localStorage = A
store.saveProfile({ id: 'a', name: 'A', type: 'm3u', m3uUrl: 'x' })
store.setProgress('a', 'movie:1', { title: 't', ref: { kind: 'movie', id: '1' }, position: 42, duration: 100 })
store.toggleFavorite('a', 'movie', '5')
await sync.createLink('a', svc)
const code = store.getProfile('a').sync.pair
const { number } = await sync.offerPairing('a')
globalThis.localStorage = B
store.saveProfile({ id: 'b', name: 'B', type: 'm3u', m3uUrl: 'x' })
await sync.acceptPairing('b', number, svc)
const ok = store.getProgress('b', 'movie:1')?.position === 42 && store.getFavorites('b').has('movie:5')
console.log('device B received progress and favorite:', ok)
const { secret, base } = core.parsePairCode(code)
const { id } = await core.deriveKeys(secret)
console.log('cleanup status:', (await fetch(`${base}/v1/${id}`, { method: 'DELETE', headers: { 'X-Access': token } })).status)
process.exit(ok ? 0 : 1)
