import { useRef } from 'react'
import { ALL } from './catalog'

// Remembers where the user was in a list (category, filter text, scroll, how many items were
// rendered) so "Voltar" from an item lands on the same place. One record per profile and per
// kind (movie / series / live), kept in sessionStorage: it survives route changes and reloads
// of the window, and is gone when the app is closed.
const key = (profileId, kind) => `browse:${profileId}:${kind}`

function read(profileId, kind) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key(profileId, kind)))
    if (saved && typeof saved === 'object') {
      return {
        categoryId: typeof saved.categoryId === 'string' ? saved.categoryId : ALL,
        query: typeof saved.query === 'string' ? saved.query : '',
        scroll: Number(saved.scroll) || 0,
        count: Number(saved.count) || 0,
        focusId: typeof saved.focusId === 'string' ? saved.focusId : ''
      }
    }
  } catch {
    // storage blocked or unreadable: start from the top
  }
  return { categoryId: ALL, query: '', scroll: 0, count: 0, focusId: '' }
}

// Returns the state saved on first render plus `save(patch)`, which merges and persists.
export function useBrowseState(profileId, kind) {
  const state = useRef(null)
  if (!state.current) state.current = read(profileId, kind)
  const save = useRef((patch) => {
    state.current = { ...state.current, ...patch }
    try {
      sessionStorage.setItem(key(profileId, kind), JSON.stringify(state.current))
    } catch {
      // keep the in-memory value
    }
  })
  return { initial: state.current, save: save.current }
}
