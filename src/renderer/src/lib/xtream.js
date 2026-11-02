// Client for the Xtream Codes player API (player_api.php).
// Items from every backend are normalized to:
//   { id, kind: 'live'|'movie'|'series', name, logo, categoryIds, ext, rating, archive, raw }
// `categoryIds` lists every category the item belongs to; ids are unique per kind.

const CATEGORY_ACTION = { live: 'get_live_categories', movie: 'get_vod_categories', series: 'get_series_categories' }
const ITEMS_ACTION = { live: 'get_live_streams', movie: 'get_vod_streams', series: 'get_series' }

function decodeBase64(text) {
  if (!text) return ''
  try {
    const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return text
  }
}

// Newer panels send every category in `category_ids`; older ones send one `category_id`.
function categoriesOf(raw) {
  const ids = Array.isArray(raw.category_ids) && raw.category_ids.length ? raw.category_ids : [raw.category_id]
  return ids.filter((id) => id !== null && id !== undefined && id !== '').map(String)
}

// Panels repeat the same stream once per category. Merge the copies into one
// item with all its categories: repeated ids would also break React list keys.
function mergeDuplicates(items) {
  const byId = new Map()
  for (const item of items) {
    const existing = byId.get(item.id)
    if (!existing) byId.set(item.id, item)
    else for (const id of item.categoryIds) if (!existing.categoryIds.includes(id)) existing.categoryIds.push(id)
  }
  return [...byId.values()]
}

function normalizeItem(kind, raw) {
  if (kind === 'series') {
    return {
      id: String(raw.series_id),
      kind,
      name: raw.name || '',
      logo: raw.cover || '',
      categoryIds: categoriesOf(raw),
      rating: raw.rating || '',
      raw
    }
  }
  return {
    id: String(raw.stream_id),
    kind,
    name: raw.name || '',
    logo: raw.stream_icon || '',
    categoryIds: categoriesOf(raw),
    ext: raw.container_extension || (kind === 'live' ? 'm3u8' : 'mp4'),
    rating: raw.rating || '',
    archive: Number(raw.tv_archive) === 1 ? Number(raw.tv_archive_duration) || 0 : 0,
    epgChannelId: raw.epg_channel_id || '',
    raw
  }
}

// Catch-up start format expected by /timeshift/: YYYY-MM-DD:HH-MM in the
// server's timezone. Falls back to local time if the zone is unknown or invalid.
function formatTimeshiftStart(date, timeZone) {
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date)
  } catch {
    return formatTimeshiftStart(date, null)
  }
  const get = (type) => parts.find((p) => p.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}:${get('hour')}-${get('minute')}`
}

export function createXtreamSource({ server, username, password }) {
  const base = server.trim().replace(/\/+$/, '')
  const user = encodeURIComponent(username)
  const pass = encodeURIComponent(password)
  const itemCache = {}
  let serverTimezone = null

  async function loadTimezone() {
    if (serverTimezone === null) serverTimezone = (await api())?.server_info?.timezone || ''
    return serverTimezone
  }

  async function api(action, params = {}) {
    const query = new URLSearchParams({ username, password, ...params })
    if (action) query.set('action', action)
    const res = await fetch(`${base}/player_api.php?${query}`)
    if (!res.ok) throw new Error(`Servidor respondeu ${res.status}`)
    return res.json()
  }

  return {
    type: 'xtream',

    async login() {
      const data = await api()
      if (!data?.user_info || Number(data.user_info.auth) === 0) {
        throw new Error('Usuário ou senha inválidos')
      }
      serverTimezone = data.server_info?.timezone || ''
      return {
        status: data.user_info.status,
        expiresAt: data.user_info.exp_date ? Number(data.user_info.exp_date) * 1000 : null,
        maxConnections: data.user_info.max_connections,
        serverTimezone: data.server_info?.timezone
      }
    },

    async categories(kind) {
      const list = await api(CATEGORY_ACTION[kind])
      return (Array.isArray(list) ? list : []).map((c) => ({
        id: String(c.category_id),
        name: c.category_name
      }))
    },

    // Fetches every item of a kind once and filters locally. Faster browsing
    // and makes search work without extra requests.
    async items(kind) {
      if (!itemCache[kind]) {
        itemCache[kind] = api(ITEMS_ACTION[kind])
          .then((list) => mergeDuplicates((Array.isArray(list) ? list : []).map((raw) => normalizeItem(kind, raw))))
          .catch((err) => {
            delete itemCache[kind]
            throw err
          })
      }
      return itemCache[kind]
    },

    async movieInfo(id) {
      const data = await api('get_vod_info', { vod_id: id })
      const info = data?.info || {}
      const movie = data?.movie_data || {}
      return {
        id: String(id),
        name: movie.name || info.name || '',
        poster: info.movie_image || info.cover_big || '',
        backdrop: (info.backdrop_path || [])[0] || '',
        plot: info.plot || info.description || '',
        genre: info.genre || '',
        cast: info.cast || info.actors || '',
        director: info.director || '',
        releaseDate: info.releasedate || info.release_date || '',
        duration: info.duration || '',
        rating: info.rating || '',
        trailer: info.youtube_trailer || '',
        ext: movie.container_extension || 'mp4'
      }
    },

    async seriesInfo(id) {
      const data = await api('get_series_info', { series_id: id })
      const info = data?.info || {}
      const seasons = {}
      for (const [season, episodes] of Object.entries(data?.episodes || {})) {
        seasons[season] = episodes.map((ep) => ({
          id: String(ep.id),
          season: Number(ep.season ?? season),
          episode: Number(ep.episode_num),
          title: ep.title || `Episódio ${ep.episode_num}`,
          plot: ep.info?.plot || '',
          image: ep.info?.movie_image || '',
          duration: ep.info?.duration || '',
          ext: ep.container_extension || 'mp4'
        }))
      }
      return {
        id: String(id),
        name: info.name || '',
        poster: info.cover || '',
        backdrop: (info.backdrop_path || [])[0] || '',
        plot: info.plot || '',
        genre: info.genre || '',
        cast: info.cast || '',
        director: info.director || '',
        releaseDate: info.releaseDate || info.release_date || '',
        rating: info.rating || '',
        seasons
      }
    },

    async shortEpg(streamId, limit = 4) {
      const data = await api('get_short_epg', { stream_id: streamId, limit })
      return (data?.epg_listings || []).map((e) => ({
        title: decodeBase64(e.title),
        description: decodeBase64(e.description),
        start: Number(e.start_timestamp) * 1000,
        end: Number(e.stop_timestamp) * 1000
      }))
    },

    // Full EPG for a channel, used to list past programmes for catch-up.
    async archiveEpg(streamId) {
      // catchupUrl is synchronous and needs the server timezone; load it here first.
      const [data] = await Promise.all([api('get_simple_data_table', { stream_id: streamId }), loadTimezone()])
      return (data?.epg_listings || [])
        .map((e) => ({
          title: decodeBase64(e.title),
          description: decodeBase64(e.description),
          start: Number(e.start_timestamp) * 1000,
          end: Number(e.stop_timestamp) * 1000,
          hasArchive: Number(e.has_archive) === 1
        }))
        .filter((e) => e.end < Date.now())
        .sort((a, b) => b.start - a.start)
    },

    liveUrl(item) {
      return {
        url: `${base}/live/${user}/${pass}/${item.id}.m3u8`,
        fallbackUrl: `${base}/live/${user}/${pass}/${item.id}.ts`
      }
    },

    movieUrl(item) {
      return { url: `${base}/movie/${user}/${pass}/${item.id}.${item.ext || 'mp4'}` }
    },

    episodeUrl(episode) {
      return { url: `${base}/series/${user}/${pass}/${episode.id}.${episode.ext || 'mp4'}` }
    },

    catchupUrl(item, programme) {
      const minutes = Math.max(1, Math.round((programme.end - programme.start) / 60000))
      const start = formatTimeshiftStart(new Date(programme.start), serverTimezone)
      return { url: `${base}/timeshift/${user}/${pass}/${minutes}/${start}/${item.id}.ts` }
    }
  }
}
