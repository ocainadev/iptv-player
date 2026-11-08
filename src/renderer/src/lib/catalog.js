// Builds the category sidebar for a kind: "All", "Favorites", then the
// provider's own categories, each with its item count.
export const ALL = '__all__'
export const FAVORITES = '__fav__'

// The provider repeats the section in every group ("Filmes | Suspense"): show only the part
// that tells categories apart. The real name stays the key for filtering and storage.
export const displayName = (name) => name.replace(/^(filmes?|s[ée]ries?|canais|canal|tv)\s*[|:\-–]\s*/i, '').trim() || name

// `sort`: alphabetical (pt-BR) instead of provider order. M3U groups come in order of first
// appearance, which is arbitrary; Xtream sends its categories in the provider's own order.
export function withSpecialCategories(categories, items, favorites, kind, sort = false) {
  const counts = new Map()
  for (const item of items) for (const id of item.categoryIds) counts.set(id, (counts.get(id) || 0) + 1)
  const favCount = items.filter((i) => favorites.has(`${kind}:${i.id}`)).length
  return [
    { id: ALL, name: 'Todos', count: items.length },
    { id: FAVORITES, name: '★ Favoritos', count: favCount },
    ...categories
      .map((c) => ({ ...c, count: counts.get(c.id) || 0 }))
      .filter((c) => c.count > 0)
      .sort(sort ? (a, b) => displayName(a.name).localeCompare(displayName(b.name), 'pt-BR') : () => 0)
  ]
}

export function filterItems(items, categoryId, favorites, kind, query = '') {
  let list = items
  if (categoryId === FAVORITES) list = list.filter((i) => favorites.has(`${kind}:${i.id}`))
  else if (categoryId !== ALL) list = list.filter((i) => i.categoryIds.includes(categoryId))
  const q = normalize(query)
  if (q) list = list.filter((i) => normalize(i.name).includes(q))
  return list
}

export function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}
