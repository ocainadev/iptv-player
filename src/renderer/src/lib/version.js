import { App } from '@capacitor/app'
import { isNative } from './native'

// The version of the running app: the Electron main process (app.getVersion) on desktop,
// the installed package (App.getInfo) on Android. Empty when neither is available (plain browser).
export async function getAppVersion() {
  try {
    if (isNative) return (await App.getInfo()).version || ''
    return (await window.appInfo?.version()) || ''
  } catch {
    return ''
  }
}
