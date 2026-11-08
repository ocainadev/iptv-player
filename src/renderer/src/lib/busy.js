// Tells the Electron main process whether closing the window would interrupt something
// (a video playing, an update downloading), so it only asks for confirmation then.
const busy = new Set()

export function setBusy(key, on) {
  if (on) busy.add(key)
  else busy.delete(key)
  window.appInfo?.setBusy?.(busy.size > 0)
}
