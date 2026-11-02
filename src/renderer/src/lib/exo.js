import { registerPlugin } from '@capacitor/core'

// Native ExoPlayer (android/.../NativePlayerPlugin.java). The picture is drawn
// behind the transparent WebView, at the rectangle of the player slot.
export const NativePlayer = registerPlugin('NativePlayer')
