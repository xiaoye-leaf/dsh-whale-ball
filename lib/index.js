/**
* dsh-mini-window, node half.
*
* The browser half ships the floating in-page button and web notifications
* via exports["./client"]. This node half forwards host-side events to the
* Electron desktop shell over the stdio IPC channel (`process.send`), which
* the shell's main process uses to drive the desktop floating ball:
*
*   - `approval/request`  -> permission confirmation needed (amber attention)
*   - `session/event` turn/end -> a task finished running
*   - `agent/status` idle/running -> live running state for the ball badge
*
* Every message is best-effort: if the shell is absent (plain `dsh web` in a
* browser) `process.send` is unavailable and this plugin is a silent no-op.
* The plugin never awaits or throws for a failed send.
*/

/** Wire kind of the forwarder's messages; namespaced to avoid clashing with the desktop picker. */
const PREFIX = 'dsh-mini-window'

function send (payload) {
  if (typeof process === 'undefined' || typeof process.send !== 'function') return
  try {
    process.send({ kind: `${PREFIX}:${payload.type}`, ...payload })
  } catch {
    /* shell gone; ignore */
  }
}

/** Host plugin body: register listeners and forward to the desktop shell. */
function apply (ctx) {
  // Permission / question confirmations: any approval ask or question batch
  // means the user must act. The approval service dispatches `approval/request`
  // scoped to the requesting agent; questions ride the same asker chain.
  ctx.on('approval/request', (req) => {
    send({
      type: 'approval',
      toolName: req?.toolName ?? '',
      reason: req?.reason ?? '',
    })
  })

  // Task completion: a closed turn. `session/event` is dispatched per session
  // with the raw event; only turn/end matters here. `reason.kind` lets the
  // shell phrase the notification (completed / aborted / error / max-tokens).
  ctx.on('session/event', (session, event) => {
    if (!event || event.type !== 'turn/end') return
    const reason = event.data?.reason
    send({
      type: 'turn-end',
      sessionId: String(session?.sessionId ?? session?.id ?? ''),
      reasonKind: reason?.kind ?? 'completed',
      title: String(session?.title ?? ''),
    })
  })

  // Live running state: agent status flips drive the ball's badge and are the
  // backstop for completion detection (idle after running = finished).
  ctx.on('agent/status', (payload) => {
    const status = payload?.status
    if (status !== 'running' && status !== 'idle') return
    send({
      type: 'agent-status',
      status,
      sessionId: String(payload?.agent?.sessionId ?? payload?.agent?.id ?? ''),
    })
  })
}

export { apply }
