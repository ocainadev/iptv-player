// M3U/M3U8 playlist parser and a source adapter with the same interface as
// the Xtream client, so pages do not care which backend a profile uses.

const ATTR_RE = /([a-zA-Z0-9-]+)="([^"]*)"/g
const EPISODE_RE = /\s*[-|.]?\s*S(\d{1,2})\s*E(\d{1,3})\b.*$/i

export function parseM3u(text) {
  const lines = text.split(/\r?\n/)
  if (!lines[0]?.trim().startsWith('#EXTM3U')) throw new Error('Arquivo não é uma lista M3U')

  const entries = []
  let current = null
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF')) {
      const attrs = {}
      for (const [, key, value] of line.matchAll(ATTR_RE)) attrs[key.toLowerCase()] = value
      // The title starts at the first comma after the attributes, and may itself contain commas.
      const comma = line.indexOf(',', line.lastIndexOf('"') + 1)
      current = {
        name: (comma >= 0 ? line.slice(comma + 1) : '').trim() || attrs['tvg-name'] || 'Sem nome',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || 'Sem categoria',
        tvgId: attrs['tvg-id'] || ''
      }
    } else if (line.startsWith('#EXTGRP:') && current) {
      current.group = line.slice(8).trim() || current.group
    } else if (!line.startsWith('#') && current) {
      entries.push({ ...current, url: line })
      current = null
    }
  }
  return entries
}

// Only file URLs can be movies or episodes. Group names decide between the
// two, but never turn a live stream into VOD.
function classify(entry) {
  const url = entry.url.toLowerCase()
  if (url.includes('/movie/')) return 'movie'
  if (url.includes('/series/')) return 'series'
  if (!/\.(mp4|mkv|avi|mov|m4v|webm)(\?|$)/.test(url)) return 'live'
  if (EPISODE_RE.test(entry.name) || /s[ée]rie|series|novela/i.test(entry.group)) return 'series'
  return 'movie'
}

// Keeps letters of any script, so Cyrillic or Arabic groups stay distinct.
function slug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
}

// Ids come from the stream URL, not the position in the list, so favorites
// and progress survive when a downloaded list gains or loses entries.
function hashId(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function createM3uSource(entries) {
  const byKind = { live: [], movie: [], series: [] }
  const shows = new Map()
  const episodesById = new Map()
  const usedIds = new Set()

  const uniqueId = (url) => {
    let id = hashId(url)
    for (let n = 1; usedIds.has(id); n++) id = hashId(`${url}#${n}`)
    usedIds.add(id)
    return id
  }

  entries.forEach((entry) => {
    const kind = classify(entry)
    const categoryId = slug(entry.group) || 'sem-categoria'
    const id = uniqueId(entry.url)

    if (kind !== 'series') {
      byKind[kind].push({
        id,
        kind,
        name: entry.name,
        logo: entry.logo,
        categoryIds: [categoryId],
        category: entry.group,
        url: entry.url
      })
      return
    }

    // Group episodes by show name, stripping the SxxExx suffix.
    const match = entry.name.match(EPISODE_RE)
    const showName = match ? entry.name.replace(EPISODE_RE, '').trim() : entry.name
    const showId = slug(`${entry.group}-${showName}`) || hashId(`${entry.group}\u0000${showName}`)
    if (!shows.has(showId)) {
      const show = {
        id: showId,
        kind: 'series',
        name: showName,
        logo: entry.logo,
        categoryIds: [categoryId],
        category: entry.group,
        episodes: []
      }
      shows.set(showId, show)
      byKind.series.push(show)
    }
    const episode = {
      id,
      season: match ? Number(match[1]) : 1,
      episode: match ? Number(match[2]) : shows.get(showId).episodes.length + 1,
      title: entry.name,
      image: entry.logo,
      url: entry.url
    }
    shows.get(showId).episodes.push(episode)
    episodesById.set(id, episode)
  })

  const categoriesOf = (kind) => {
    const seen = new Map()
    for (const item of byKind[kind]) {
      const [id] = item.categoryIds
      if (!seen.has(id)) seen.set(id, { id, name: item.category })
    }
    return [...seen.values()]
  }

  return {
    type: 'm3u',
    async login() {
      return { total: entries.length }
    },
    async categories(kind) {
      return categoriesOf(kind)
    },
    async items(kind) {
      return byKind[kind]
    },
    async movieInfo(id) {
      const item = byKind.movie.find((m) => m.id === id)
      return { id, name: item?.name || '', poster: item?.logo || '', genre: item?.category || '' }
    },
    async seriesInfo(id) {
      const show = shows.get(id)
      const seasons = {}
      for (const ep of show?.episodes || []) (seasons[ep.season] ||= []).push(ep)
      for (const list of Object.values(seasons)) list.sort((a, b) => a.episode - b.episode)
      return { id, name: show?.name || '', poster: show?.logo || '', genre: show?.category || '', seasons }
    },
    // A plain M3U carries no EPG.
    async shortEpg() {
      return []
    },
    async archiveEpg() {
      return []
    },
    liveUrl: (item) => ({ url: item.url }),
    movieUrl: (item) => ({ url: byKind.movie.find((m) => m.id === item.id)?.url || item.url }),
    episodeUrl: (episode) => ({ url: episodesById.get(episode.id)?.url || episode.url }),
    catchupUrl: () => null
  }
}
