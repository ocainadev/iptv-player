// Sync service for Telara: stores one opaque, client-side-encrypted blob per pairing id.
// It never sees profiles, lists, passwords or what is being watched. Deploy on Cloudflare
// Workers with a KV namespace bound as SYNC (see wrangler.toml and the README).

const MAX_BYTES = 512 * 1024
const TTL_SECONDS = 365 * 24 * 3600 // refreshed on every write
const PAIR_TTL_SECONDS = 300 // a short pairing number is only valid for 5 minutes
const PAIR_MAX_BYTES = 2048

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Access',
  'Access-Control-Max-Age': '86400'
}

const reply = (status, body = null, extra = {}) =>
  new Response(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...extra } })

export async function handle(request, env) {
  if (request.method === 'OPTIONS') return reply(204)
  // Optional access token (wrangler secret put ACCESS_TOKEN): without it nobody else can use the service.
  if (env.ACCESS_TOKEN && request.headers.get('X-Access') !== env.ACCESS_TOKEN) return reply(401, 'unauthorized')
  const path = new URL(request.url).pathname

  // Pairing: device A leaves the real sync secret, encrypted with an 8-digit number; device B
  // reads it once with that number. The blob is deleted on the first read or after 5 minutes.
  const pair = path.match(/^\/v1\/pair\/([0-9a-f]{32})$/)
  if (pair) {
    const key = `pair:${pair[1]}`
    if (request.method === 'PUT') {
      const text = await request.text()
      if (text.length > PAIR_MAX_BYTES) return reply(413, 'too large')
      try {
        const blob = JSON.parse(text)
        if (blob?.v !== 1 || typeof blob.iv !== 'string' || typeof blob.data !== 'string') throw new Error()
      } catch {
        return reply(400, 'invalid blob')
      }
      await env.SYNC.put(key, text, { expirationTtl: PAIR_TTL_SECONDS })
      return reply(204)
    }
    if (request.method === 'GET') {
      const value = await env.SYNC.get(key)
      if (value === null) return reply(404, 'unknown or expired')
      await env.SYNC.delete(key)
      return reply(200, value, { 'Content-Type': 'application/json' })
    }
    return reply(405, 'method not allowed')
  }

  const match = path.match(/^\/v1\/([0-9a-f]{32})$/)
  if (!match) return reply(404, 'not found')
  const id = match[1]

  if (request.method === 'GET') {
    const value = await env.SYNC.get(id)
    return value === null ? reply(404, 'empty') : reply(200, value, { 'Content-Type': 'application/json' })
  }

  if (request.method === 'PUT') {
    const text = await request.text()
    if (text.length > MAX_BYTES) return reply(413, 'too large')
    let blob
    try {
      blob = JSON.parse(text)
    } catch {
      return reply(400, 'invalid json')
    }
    if (blob?.v !== 1 || typeof blob.iv !== 'string' || typeof blob.data !== 'string') return reply(400, 'invalid blob')
    await env.SYNC.put(id, text, { expirationTtl: TTL_SECONDS })
    return reply(204)
  }

  if (request.method === 'DELETE') {
    await env.SYNC.delete(id)
    return reply(204)
  }

  return reply(405, 'method not allowed')
}

export default { fetch: handle }
