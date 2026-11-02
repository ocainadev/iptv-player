import { createXtreamSource } from './xtream'
import { createM3uSource, parseM3u } from './m3u'
import { loadM3uText } from './store'

// One source instance per profile, kept for the app's lifetime so item lists
// are fetched only once.
const sources = new Map()

export async function fetchM3uText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Não foi possível baixar a lista (${res.status})`)
  return res.text()
}

export async function buildSource(profile) {
  if (profile.type === 'xtream') return createXtreamSource(profile)
  const text = profile.m3uUrl ? await fetchM3uText(profile.m3uUrl) : await loadM3uText(profile.id)
  if (!text) throw new Error('Lista M3U não encontrada. Adicione o perfil de novo.')
  return createM3uSource(parseM3u(text))
}

export function getSource(profile) {
  if (!sources.has(profile.id)) {
    const promise = buildSource(profile).catch((err) => {
      sources.delete(profile.id)
      throw err
    })
    sources.set(profile.id, promise)
  }
  return sources.get(profile.id)
}

export function forgetSource(profileId) {
  sources.delete(profileId)
}
