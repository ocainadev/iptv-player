import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { ScreenOrientation } from '@capacitor/screen-orientation'

// True inside the Android (Capacitor) app; false in Electron and the browser.
export const isNative = Capacitor.isNativePlatform()

// Full-window video on Android: landscape, no system bars. Always paired with exitNativeFullscreen.
export async function enterNativeFullscreen() {
  try {
    await ScreenOrientation.lock({ orientation: 'landscape' })
    await SystemBars.hide()
  } catch {
    // orientation lock or bars not available: the CSS fullscreen still works
  }
}

export async function exitNativeFullscreen() {
  try {
    await SystemBars.show()
    await ScreenOrientation.unlock()
  } catch {
    // nothing to restore
  }
}

// Android back button. Anything that wants to handle "back" (fullscreen, the
// player modal) listens to the cancelable `app:back` event and calls
// preventDefault(). Otherwise go back in the router; at the first screen, leave the app.
export function initBackButton() {
  if (!isNative) return
  // The app is dark: light status/navigation bar icons.
  SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => {})
  App.addListener('backButton', () => {
    const event = new Event('app:back', { cancelable: true })
    window.dispatchEvent(event)
    if (event.defaultPrevented) return
    if (window.location.hash === '' || window.location.hash === '#/') App.exitApp()
    else window.history.back()
  })
}
