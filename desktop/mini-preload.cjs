'use strict'
/**
 * Preload for the mini-window floating ball.
 *
 * The ball page is a data: URL with contextIsolation on and no node
 * integration; this preload exposes exactly four channels through the
 * contextBridge:
 *   - click()    -> restore the main window (fullscreen)
 *   - menu()     -> open the ball's context menu
 *   - dragBegin()-> start long-press drag (main process polls the cursor)
 *   - dragEnd()  -> stop long-press drag
 * Nothing else reaches the renderer.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('miniWindow', {
  click: () => { ipcRenderer.send('dsh-mini:click') },
  menu: () => { ipcRenderer.send('dsh-mini:menu') },
  dragBegin: () => { ipcRenderer.send('dsh-mini:drag-begin') },
  dragEnd: () => { ipcRenderer.send('dsh-mini:drag-end') },
})
