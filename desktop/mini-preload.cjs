'use strict'
/**
 * Preload for the mini-window floating ball.
 *
 * The ball page is a data: URL with contextIsolation on and no node
 * integration; this preload exposes exactly four channels through the
 * contextBridge:
 *   - click()     -> restore the main window (fullscreen)
 *   - menu()      -> open the ball's context menu
 *   - dragStart() -> record the pointer offset for long-press dragging
 *   - dragMove()  -> move the ball window to the given screen point
 * Nothing else reaches the renderer.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('miniWindow', {
  click: () => { ipcRenderer.send('dsh-mini:click') },
  menu: () => { ipcRenderer.send('dsh-mini:menu') },
  dragStart: (x, y) => { ipcRenderer.send('dsh-mini:drag-start', x, y) },
  dragMove: (x, y) => { ipcRenderer.send('dsh-mini:drag-move', x, y) },
})
