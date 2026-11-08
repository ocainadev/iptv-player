// Next episode of a series: the following one in the same season or, after the last episode
// of a season, the first of the next season. `seasons` is { [season]: [episode] } as returned
// by source.seriesInfo(). Seasons are ordered numerically; inside a season by episode number
// (episodes without a usable number keep their list order, after the numbered ones).
// Returns null for the last episode, for a single episode, or when `currentId` is unknown.
const num = (value) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : Infinity)

export function findNextEpisode(seasons, currentId) {
  const ordered = Object.keys(seasons || {})
    .sort((a, b) => num(a) - num(b))
    .flatMap((season) =>
      (seasons[season] || [])
        .map((ep, index) => ({ ep: { ...ep, season: ep.season ?? Number(season) }, index }))
        .sort((a, b) => num(a.ep.episode) - num(b.ep.episode) || a.index - b.index)
        .map((x) => x.ep)
    )
  const at = ordered.findIndex((ep) => String(ep.id) === String(currentId))
  return at >= 0 ? ordered[at + 1] || null : null
}
