'use strict'
/**
 * Preload for the MAIN DeepSeek Harness window.
 *
 * Exposes a tiny native bridge to the harness page so the in-page floating
 * button can control the ELECTRON-level fullscreen state (window.setFullScreen),
 * which document.exitFullscreen() cannot touch.
 *
 * Exposed as `window.dshNative`:
 *   - setFullScreen(on: boolean) -> void   (async; toggles window fullscreen)
 *   - isFullScreen() -> boolean             (sync read)
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshNative', {
  setFullScreen: (on) => { ipcRenderer.send('dsh-native:set-fullscreen', Boolean(on)) },
  isFullScreen: () => ipcRenderer.sendSync('dsh-native:is-fullscreen'),
})
