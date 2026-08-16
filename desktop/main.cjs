'use strict'
/**
 * Electron main process for the DeepSeek Harness desktop shell.
 *
 * The shell owns no product behavior. It boots the packaged `dsh --profile web`
 * closure as a child process (the Electron binary re-executed as plain Node),
 * waits for that process to print its URL line — the documented readiness
 * signal — and shows the served GUI in a native window. Everything the user
 * sees after that point is the same web client the browser surface serves.
 *
 * Layout the shell resolves against, in order: `DSH_DESKTOP_RUNTIME`, the
 * packaged `<resources>/runtime`, and a `runtime/` sibling of this directory
 * for an unpackaged run.
 *
 * Mini-window (desktop ball): minimizing the main window hides it and raises
 * a small always-on-top floating ball. The ball's outer ring is the drag
 * handle; its center button restores the window (fullscreen). The main
 * process also consumes `dsh-mini-window:*` IPC messages from the harness
 * node-half plugin (approval asks, turn ends) and polls the `session.list`
 * API to raise system notifications and tint the ball's badge.
 */

const { app, BrowserWindow, Menu, dialog, shell, ipcMain, Notification, screen } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync, mkdirSync } = require('node:fs')
const path = require('node:path')

const PRODUCT_NAME = 'DeepSeek Harness'
/** The URL line `dsh web` prints once its `/api` route owner has mounted. */
const READY_PATTERN = /https?:\/\/127\.0\.0\.1:\d+/
/** How long the shell waits for that line before reporting a failed boot. */
const BOOT_TIMEOUT_MS = 120_000
/** Child output retained for the failure report. */
const DIAGNOSTIC_LINES = 60

// ---------------------------------------------------------------------------
// Mini-window (desktop ball) settings
// ---------------------------------------------------------------------------
const MINI_BALL_SIZE = 76 // window square px (visual ball ~56px + halo room)
const MINI_POLL_MS = 2000 // session.list poll interval
/** Restore-to-fullscreen on single click; false restores a normal window. */
const MINI_FULLSCREEN_ON_CLICK = true
/** Keep the ball visible even when the main window is shown. */
const MINI_BALL_ALWAYS = false
/** IPC prefix consumed from the harness child. */
const MINI_IPC_PREFIX = 'dsh-mini-window:'

/** The harness child, while one is live. */
let harness = null
/** The single shell window. */
let window = null
/** The desktop floating ball, while active. */
let ball = null
/** The served harness URL (http://127.0.0.1:<port>), once known. */
let harnessUrl = null
/** Set once the shell is tearing down, so a child exit stops reporting failures. */
let quitting = false

/**
 * Locate the packaged harness entry.
 * @returns absolute path of the deployed `dsh` bin.
 */
function resolveHarnessBin () {
  const roots = []
  if (process.env.DSH_DESKTOP_RUNTIME) roots.push(process.env.DSH_DESKTOP_RUNTIME)
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'runtime'))
  roots.push(path.join(__dirname, '..', 'runtime'))
  for (const root of roots) {
    const bin = path.join(root, 'lib', 'bin.js')
    if (existsSync(bin)) return bin
  }
  throw new Error(`no harness runtime found; looked for lib/bin.js under:\n${roots.join('\n')}`)
}

/**
 * The directory the agent session opens in. The sandbox policy roots
 * workspace-write at the harness process's working directory, so the shell
 * never inherits the install location or the shortcut's start-in folder.
 * @returns the workspace directory, created when absent.
 */
function resolveWorkspace () {
  const configured = process.env.DSH_DESKTOP_WORKSPACE
  const workspace = configured && configured.length > 0
    ? configured
    : path.join(app.getPath('documents'), PRODUCT_NAME)
  mkdirSync(workspace, { recursive: true })
  return workspace
}

/** Request kind the desktop directory-picker backend sends; the reply carries the same `id`. */
const PICK_REQUEST = 'dsh-desktop:pick-directory'
/** Cancel notice for a pick whose caller went away while the dialog was open. */
const PICK_CANCEL = 'dsh-desktop:cancel-directory'
/** Picks whose caller aborted: the dialog still runs to completion, its answer is dropped. */
const abandonedPicks = new Set()

/**
 * Answer the harness's directory-pick request with the shell's own dialog.
 *
 * Electron cannot dismiss an open dialog, so an abort only marks the pick
 * abandoned: the user still closes the dialog they were shown, and the answer
 * goes nowhere.
 * @param child - the harness process to reply to.
 * @param message - one IPC message; anything else is ignored.
 */
async function servePickRequest (child, message) {
  if (message?.kind === PICK_CANCEL) {
    abandonedPicks.add(message.id)
    return
  }
  if (message?.kind !== PICK_REQUEST) return
  const reply = (payload) => {
    if (abandonedPicks.delete(message.id)) return
    if (child.connected) child.send({ kind: PICK_REQUEST, id: message.id, ...payload })
  }
  try {
    const options = { title: '选择工作目录', properties: ['openDirectory', 'createDirectory'] }
    const result = window === null || window.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options)
    reply({ path: result.canceled ? null : (result.filePaths[0] ?? null) })
  } catch (error) {
    reply({ error: String(error.message ?? error) })
  }
}

/**
 * Boot the harness and resolve with the URL it serves.
 * @returns the local GUI URL.
 */
function startHarness () {
  const bin = resolveHarnessBin()
  const workspace = resolveWorkspace()
  // `--expose-internals` is not optional: the launcher mounts a watch-only HMR
  // instance for live `cordis.patch.yml` reloading, and that service refuses to
  // construct without Node's ESM loader internals. The addon that normally
  // reaches them has no compatible realm inside Electron, so the flag is the
  // only route and its absence fails the whole boot after the server is up.
  const child = spawn(process.execPath, [
    '--expose-internals',
    bin,
    '--profile', 'web',
    '--patch', path.join(__dirname, 'desktop.patch.yml'),
    '--port', '0',
  ], {
    cwd: workspace,
    // ELECTRON_RUN_AS_NODE turns the shipped Electron binary into the Node
    // runtime for this child, so the package carries no second runtime.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    // The fourth slot is the channel the desktop directory-picker backend
    // answers on; without it that backend refuses to mount a pick.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })
  harness = child
  child.on('message', (message) => {
    // Directory picker first (the desktop backend's own protocol).
    if (message?.kind === PICK_REQUEST || message?.kind === PICK_CANCEL) {
      void servePickRequest(child, message)
      return
    }
    // Mini-window events forwarded by the harness node-half plugin.
    if (typeof message?.kind === 'string' && message.kind.startsWith(MINI_IPC_PREFIX)) {
      handleMiniIpc(message)
      return
    }
  })

  const diagnostics = []
  const collect = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.length === 0) continue
      diagnostics.push(line)
      if (diagnostics.length > DIAGNOSTIC_LINES) diagnostics.shift()
      console.log(`[harness] ${line}`)
    }
  }

  return new Promise((resolve, reject) => {
    const fail = (message) => {
      const tail = diagnostics.length === 0 ? '(no output)' : diagnostics.join('\n')
      reject(new Error(`${message}\n\n${tail}`))
    }
    const timer = setTimeout(() => {
      fail(`The harness did not report a URL within ${String(BOOT_TIMEOUT_MS / 1000)}s.`)
    }, BOOT_TIMEOUT_MS)
    timer.unref?.()

    child.stdout.on('data', (chunk) => {
      collect(chunk)
      const match = READY_PATTERN.exec(String(chunk))
      if (match === null) return
      clearTimeout(timer)
      resolve(match[0])
    })
    child.stderr.on('data', collect)
    child.on('error', (error) => {
      clearTimeout(timer)
      fail(`The harness process could not start: ${error.message}`)
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      harness = null
      if (quitting) return
      fail(`The harness exited before serving the GUI (code ${String(code)}, signal ${String(signal)}).`)
      if (window !== null && !window.isDestroyed()) showFailure(new Error('The harness process stopped.'))
    })
  })
}

/** Terminate the harness process tree. Safe to call more than once. */
function stopHarness () {
  const child = harness
  harness = null
  if (child === null || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32' && child.pid !== undefined) {
    // Windows has no process-group kill: the harness owns spawned trees of its
    // own (shell commands, subagents), and only taskkill /T reaches them.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      .on('error', () => { child.kill() })
    return
  }
  child.kill()
}

/**
 * Render a boot failure in the window instead of leaving a blank frame.
 * @param error - the failure to report.
 */
function showFailure (error) {
  const detail = String(error.message ?? error)
  const page = `<!doctype html><meta charset="utf-8">
<style>
  :root { color-scheme: dark }
  body { margin:0; padding:48px; background:#16161a; color:#e7e7ea;
         font:14px/1.6 "Segoe UI",system-ui,sans-serif }
  h1 { font-size:18px; margin:0 0 12px }
  p { color:#a0a0aa; margin:0 0 20px }
  pre { background:#0e0e11; border:1px solid #2a2a31; border-radius:8px;
        padding:16px; overflow:auto; max-height:60vh; white-space:pre-wrap;
        font:12px/1.5 Consolas,ui-monospace,monospace; color:#c8c8d0 }
</style>
<h1>${PRODUCT_NAME} 启动失败</h1>
<p>本地服务没有启动成功。下面是它最后输出的内容：</p>
<pre>${detail.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`
  void window?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
}

// ---------------------------------------------------------------------------
// Mini-window: desktop floating ball
// ---------------------------------------------------------------------------

/** Current attention state of the ball: 'idle' | 'busy' | 'attention'. */
let miniState = 'idle'
/** The last session.list snapshot keyed by sessionId, for edge detection. */
let miniPrevRunning = new Map()
/** Whether any session is running right now (ball badge source). */
let miniAnyRunning = false
/** Completion-notification dedupe: last notified time per sessionId. */
const miniNotifiedAt = new Map()
/** Skip a completion notification if one fired within this window. */
const MINI_NOTIFY_DEDUPE_MS = 3000

/** The ball page: a glassmorphism ball with the DeepSeek whale logo centered. */
function ballPage () {
  return `<!doctype html><meta charset="utf-8">
<html style="background:transparent">
<head><style>
  html, body { margin:0; padding:0; background:transparent; overflow:hidden;
               user-select:none; -webkit-user-select:none; }
  #wrap { position:absolute; inset:0; }

  /* -------- 拖动区：整个球体（drag，OS 级拖动） -------- */
  /* 透明玻璃磨砂：基本不填色，白色高光 + 细磨砂噪点 + 玻璃边缘 */
  #ring {
    position:absolute; inset:0; margin:auto;
    width:${MINI_BALL_SIZE - 20}px; height:${MINI_BALL_SIZE - 20}px;
    border-radius:50%;
    background-color:rgba(255,255,255,.045);
    background-image:
      radial-gradient(circle at 30% 22%, rgba(255,255,255,.30), rgba(255,255,255,.07) 42%, transparent 74%),
      radial-gradient(circle at 50% 118%, rgba(255,255,255,.10), transparent 62%),
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.06'/></svg>");
    border:1px solid rgba(255,255,255,.38);
    box-shadow:
      inset 0 1px 5px rgba(255,255,255,.22),
      inset 0 -3px 8px rgba(255,255,255,.05),
      0 1px 6px rgba(0,0,0,.12);
    -webkit-app-region:drag;
    transition:transform .16s ease, box-shadow .2s ease, border-color .2s ease;
  }
  /* 悬停：整个球微微放大、边缘更亮 */
  #wrap:hover #ring {
    transform:scale(1.10);
    border-color:rgba(255,255,255,.52);
    box-shadow:inset 0 1px 6px rgba(255,255,255,.28), inset 0 -3px 8px rgba(255,255,255,.06), 0 1px 8px rgba(0,0,0,.16);
  }

  /* -------- 中心点击区（no-drag，点击/右键） -------- */
  #hit {
    position:absolute; inset:0; margin:auto;
    width:34px; height:34px;
    border-radius:50%;
    cursor:pointer;
    -webkit-app-region:no-drag;
    display:flex; align-items:center; justify-content:center;
    z-index:2;
    background:rgba(255,255,255,.05);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);
    transition:background .15s ease, transform .12s ease;
  }
  #hit:hover { background:rgba(255,255,255,.15); }
  #hit:active { transform:scale(.9); }

  /* -------- DeepSeek 经典鲸鱼 logo -------- */
  #logo {
    width:22px; height:22px;
    pointer-events:none;
    display:block;
    filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));
  }
  #logo path { fill:#fff; }
</style></head>
<body>
  <div id="wrap">
    <div id="ring"></div>
    <div id="hit" title="恢复并全屏">
        <svg id="logo" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z" fill="#fff" fill-opacity="1"/>
        </svg>
    </div>
  </div>
  <script>
    (function () {
      var hit = document.getElementById('hit')
      hit.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation()
        window.miniWindow.click()
      })
      hit.addEventListener('contextmenu', function (e) {
        e.preventDefault(); e.stopPropagation()
        window.miniWindow.menu()
      })
    })()
  </script>
</body></html>`
}

/** Rebuild the ball's badge dot and state from the current state. */
function miniRenderBadge () {
  if (ball === null || ball.isDestroyed()) return
  // The simplified glass ball is static; nothing to update per state.
  void miniState
}

/** Show the floating ball (creates the window on first use). */
function showBall () {
  if (ball !== null && !ball.isDestroyed()) {
    ball.show()
    miniRenderBadge()
    return
  }
  const { workArea } = screen.getPrimaryDisplay()
  ball = new BrowserWindow({
    width: MINI_BALL_SIZE,
    height: MINI_BALL_SIZE,
    x: workArea.x + workArea.width - MINI_BALL_SIZE - 24,
    y: workArea.y + workArea.height - MINI_BALL_SIZE - 48,
    frame: false,
    transparent: true,
    // 显式透明底色，避免默认背景闪白/透出方框；关闭 Win11 圆角合成，
    // 消除无边框透明窗口外围的方形光晕。
    backgroundColor: '#00000000',
    roundedCorners: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    title: 'DeepSeek Harness (mini)',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      preload: path.join(__dirname, 'mini-preload.cjs'),
    },
  })
  void ball.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(ballPage())}`)
  ball.setAlwaysOnTop(true, 'screen-saver')
  ball.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  ball.on('closed', () => { ball = null })

  // The page's center button calls window.miniWindow.click()/menu() via the
  // preload bridge; both arrive here as IPC. Clicks on the outer ring are
  // consumed by the OS drag (that is the drag handle), so no click logic
  // lives in the main process — no before-input-event heuristics needed.

  // did-finish-load: seed the badge.
  ball.webContents.on('did-finish-load', () => {
    miniRenderBadge()
  })
}

/** Context menu for the floating ball. */
function showBallMenu () {
  const template = [
    {
      label: '恢复窗口',
      click: () => { restoreMainWindow(false) },
    },
    {
      label: '恢复并全屏',
      click: () => { restoreMainWindow(true) },
    },
    { type: 'separator' },
    {
      label: '隐藏悬浮球',
      click: () => { hideBall() },
    },
    { type: 'separator' },
    {
      label: '退出 ' + PRODUCT_NAME,
      click: () => { app.quit() },
    },
  ]
  Menu.buildFromTemplate(template).popup({ window: ball })
}

/** Hide and destroy the floating ball. */
function hideBall () {
  if (ball !== null && !ball.isDestroyed()) ball.destroy()
  ball = null
}

/** Show the main window (and optionally fullscreen). */
function restoreMainWindow (fullscreen) {
  if (window === null || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (fullscreen) window.setFullScreen(true)
  if (!MINI_BALL_ALWAYS) hideBall()
}

/** True when the main window is hidden or minimized (ball should be up). */
function mainWindowIsAway () {
  return window === null || window.isDestroyed() || !window.isVisible() || window.isMinimized()
}

/** Raise a native notification and, on click, restore the window. */
function miniNotify (title, body) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => {
    restoreMainWindow(false)
  })
  n.show()
}

/**
 * Handle one harness IPC event (kind prefix dsh-mini-window:*).
 * @param message - the IPC message with `type` and payload fields.
 */
function handleMiniIpc (message) {
  switch (message.type) {
    case 'approval':
      miniState = 'attention'
      miniRenderBadge()
      if (mainWindowIsAway()) {
        const tool = message.toolName ? `（${message.toolName}）` : ''
        miniNotify(`${PRODUCT_NAME} 需要确认`, `有权限请求${tool}等待你的确认。${message.reason ? `\n${message.reason}` : ''}`)
      }
      break
    case 'turn-end': {
      const kind = message.reasonKind
      const labels = {
        completed: '任务完成',
        aborted: '任务已中止',
        error: '任务出错',
        'max-tokens': '已达输出上限',
        blocked: '任务被阻塞',
      }
      const title = labels[kind] || '任务结束'
      const who = message.title ? `「${message.title}」` : ''
      const sid = message.sessionId || ''
      const last = miniNotifiedAt.get(sid) ?? 0
      const nowMs = Date.now()
      if (nowMs - last >= MINI_NOTIFY_DEDUPE_MS) {
        miniNotifiedAt.set(sid, nowMs)
        if (mainWindowIsAway()) {
          miniNotify(title, `${who}运行结束。`)
        }
      }
      break
    }
    case 'agent-status':
      if (message.status === 'running') miniState = 'busy'
      else miniState = 'idle'
      miniRenderBadge()
      break
    default:
      break
  }
}

/**
 * Poll the harness session.list API and detect running-state edges.
 * Fires a completion notification when a session stops running while the
 * main window is away, and keeps the ball badge fresh.
 */
async function pollSessions () {
  if (harnessUrl === null) return
  try {
    const body = {
      type: 'client-request',
      rpcId: 'dsh-mini-window:' + Date.now(),
      method: 'session.list',
      payload: {},
    }
    const res = await fetch(`${harnessUrl}/api/session.list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return
    const data = await res.json()
    const result = data?.result
    if (!result || result.ok !== true) return
    const items = result.value?.items ?? []
    const now = new Map()
    let anyRunning = false
    for (const item of items) {
      if (!item || typeof item.sessionId !== 'string') continue
      now.set(item.sessionId, Boolean(item.running))
      if (item.running) anyRunning = true
    }
    // Detect completion edges: previously running, now idle.
    for (const [id, wasRunning] of miniPrevRunning) {
      if (wasRunning && !(now.get(id) === true)) {
        const last = miniNotifiedAt.get(id) ?? 0
        const nowMs = Date.now()
        if (nowMs - last >= MINI_NOTIFY_DEDUPE_MS) {
          miniNotifiedAt.set(id, nowMs)
          if (mainWindowIsAway()) {
            miniNotify(`${PRODUCT_NAME} 任务完成`, `会话已完成运行。`)
          }
        }
      }
    }
    miniPrevRunning = now
    miniAnyRunning = anyRunning
    if (miniState !== 'attention') {
      miniState = anyRunning ? 'busy' : 'idle'
    }
    miniRenderBadge()
  } catch {
    /* harness briefly unreachable; ignore */
  }
}

/** Build the shell window and show the splash while the harness boots. */
function createWindow () {
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#16161a',
    autoHideMenuBar: true,
    title: PRODUCT_NAME,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      // Exposes window.dshNative.setFullScreen / isFullScreen to the harness
      // page so the in-page button can also leave ELECTRON-level fullscreen
      // (window.setFullScreen), which document.exitFullscreen() cannot.
      preload: path.join(__dirname, 'mini-main-preload.cjs'),
    },
  })
  void window.loadFile(path.join(__dirname, 'loading.html'))

  // Anything that is not the served GUI belongs in the user's own browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url.startsWith('data:') || new URL(url).origin === new URL(current).origin) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  // Mini-window integration: minimize keeps the window in the taskbar
  // (normal minimize — we deliberately do NOT hide it) and also raises the
  // floating ball as an extra summoning entry. Restoring from the taskbar
  // or from the ball both work.
  window.on('minimize', () => {
    showBall()
  })
  window.on('show', () => {
    if (!MINI_BALL_ALWAYS) hideBall()
  })
  window.on('closed', () => { window = null })
}

/** A menu with only what this shell can honestly offer. */
function createMenu () {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        {
          label: '打开工作目录',
          click: () => { void shell.openPath(resolveWorkspace()) },
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ]))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window === null) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    if (!MINI_BALL_ALWAYS) hideBall()
  })
  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', () => { quitting = true; stopHarness() })
  process.on('exit', stopHarness)

  app.whenReady().then(async () => {
    createMenu()
    createWindow()

    // Ball IPC channels (renderer -> main, via mini-preload.cjs).
    ipcMain.on('dsh-mini:click', () => {
      restoreMainWindow(MINI_FULLSCREEN_ON_CLICK)
    })
    ipcMain.on('dsh-mini:menu', () => {
      showBallMenu()
    })

    // Main-window native bridge (via mini-main-preload.cjs): lets the harness
    // page control ELECTRON-level fullscreen, so the in-page button can both
    // enter AND leave fullscreen reliably.
    ipcMain.on('dsh-native:set-fullscreen', (_event, on) => {
      if (window !== null && !window.isDestroyed()) window.setFullScreen(Boolean(on))
    })
    ipcMain.on('dsh-native:is-fullscreen', (event) => {
      const on = window !== null && !window.isDestroyed() && window.isFullScreen()
      event.returnValue = Boolean(on)
    })

    try {
      const url = await startHarness()
      harnessUrl = url
      await window?.loadURL(url)
      // Keep polling the harness API while the app lives.
      setInterval(() => { void pollSessions() }, MINI_POLL_MS)
    } catch (error) {
      if (quitting) return
      if (window === null) dialog.showErrorBox(`${PRODUCT_NAME} 启动失败`, String(error.message ?? error))
      else showFailure(error)
    }
  })
}
