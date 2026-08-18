window.__ModuleLoader__.load({
  id: "dsh-mini-window",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // ------------------------------------------------------------------
    // dsh-mini-window: floating fullscreen button + task/permission alerts
    //
    // - A small floating button (bottom-right) that enters fullscreen on
    //   click and exits on the next click.
    // - Subscribes to ctx.sessions.list and sends a system Notification
    //   when a session finishes running (running true->false) or when it
    //   starts waiting for the user (approval / plan-review / question).
    // - Notification click focuses the window and opens that session.
    //
    // Fullscreen handling: in the Electron desktop shell fullscreen exists
    // on TWO layers:
    //   1. page-level  : document.documentElement.requestFullscreen()
    //   2. window-level: Electron window.setFullScreen(true), exposed to
    //                    the page as window.dshNative.setFullScreen(on)
    // The button tracks both (isFullscreen returns true if either is on)
    // and leaves BOTH when toggling off, so "cannot exit fullscreen" never
    // happens. In a plain browser (no dshNative) it behaves like before.
    //
    // Everything (DOM, listeners, subscription) is registered through
    // ctx.effect so fiber unload (disable / HMR / reload) tears it down.
    // ------------------------------------------------------------------

    var SESSIONS_SERVICE = "sessions";

    // ---------- tiny inline styles (no shell dependency) ----------
    var STYLE_ID = "dsh-mini-window-style";
    var CSS = `
#dsh-mini-window-btn {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 2147483647;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(127, 127, 127, 0.35);
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #1b1e27) 78%, transparent);
  backdrop-filter: blur(8px);
  color: var(--dsw-alias-label-primary, #e6e8ee);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
  padding: 0;
  outline: none;
}
#dsh-mini-window-btn:hover {
  transform: scale(1.08);
  border-color: var(--dsw-alias-accent, #4f8cff);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
}
#dsh-mini-window-btn svg {
  width: 20px;
  height: 20px;
  display: block;
}
@media (prefers-reduced-motion: reduce) {
  #dsh-mini-window-btn { transition: none; }
}
`;

    // ---------- fullscreen helpers (page + window layers) ----------
    /** True when the Electron window-level bridge is available. */
    function hasNativeBridge() {
      return typeof window !== "undefined" && !!window.dshNative;
    }

    /** Page-level fullscreen (document element). */
    function pageFullscreenOn() {
      return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    }

    /** Window-level fullscreen (Electron setFullScreen), via the bridge. */
    function windowFullscreenOn() {
      if (!hasNativeBridge()) return false;
      try {
        return window.dshNative.isFullScreen() === true;
      } catch (e) {
        return false;
      }
    }

    /** Overall: either layer is on. */
    function isFullscreen() {
      return pageFullscreenOn() || windowFullscreenOn();
    }

    function enterPageFullscreen() {
      var target = document.documentElement;
      if (target.requestFullscreen) return target.requestFullscreen();
      if (target.webkitRequestFullscreen) return target.webkitRequestFullscreen();
      return Promise.resolve();
    }

    function exitPageFullscreen() {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) return document.exitFullscreen();
        if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
      }
      return Promise.resolve();
    }

    /** Leave window-level fullscreen through the Electron bridge. */
    function exitWindowFullscreen() {
      if (!hasNativeBridge()) return;
      try {
        window.dshNative.setFullScreen(false);
      } catch (e) {
        /* ignore */
      }
    }

    /**
     * Toggle fullscreen across BOTH layers:
     *   - turning on  : request page-level fullscreen (the bridge's
     *                   window-level fullscreen is left to the shell)
     *   - turning off : exit page-level AND window-level fullscreen
     */
    function toggleFullscreen() {
      if (isFullscreen()) {
        exitWindowFullscreen();
        exitPageFullscreen().catch(function () {});
      } else {
        enterPageFullscreen().catch(function (err) {
          console.warn("[dsh-mini-window] fullscreen request rejected:", err);
        });
      }
    }

    // ---------- notifications ----------
    function notifyPermission() {
      // Called from a user gesture (button click) so the browser allows it.
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(function () {});
      }
    }

    function sendNotification(title, body, sessionId, ctx) {
      if (!("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      try {
        var n = new Notification(title, {
          body: body,
          icon: "/favicon.svg",
          tag: "dsh-mini-window"
        });
        n.onclick = function () {
          window.focus();
          if (sessionId && ctx && ctx.sessions) {
            try {
              ctx.sessions.open(sessionId);
            } catch (e) {
              /* session may be gone */
            }
          }
          n.close();
        };
      } catch (e) {
        console.warn("[dsh-mini-window] notification failed:", e);
      }
    }

    var PENDING_LABELS = {
      approval: "需要你确认权限",
      "plan-review": "需要你评审计划",
      question: "需要你回答问题"
    };

    var ICON_EXPAND =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
    var ICON_COMPRESS =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

    // ---------- DOM setup (style + floating button) ----------
    function ensureStyle() {
      var existing = document.getElementById(STYLE_ID);
      if (existing) return existing;
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
      return style;
    }

    function ensureButton() {
      var existing = document.getElementById("dsh-mini-window-btn");
      if (existing) return existing;
      var btn = document.createElement("button");
      btn.id = "dsh-mini-window-btn";
      btn.type = "button";
      btn.setAttribute("aria-label", "全屏 / 退出全屏 (mini-window)");
      btn.innerHTML = ICON_EXPAND;
      document.body.appendChild(btn);
      return btn;
    }

    // ---------- plugin body ----------
    function apply(ctx) {
      ctx.effect(() => {
        var styleTag = ensureStyle();
        var btn = ensureButton();
        if (!btn) return;

        var onFsChange = function () {
          btn.innerHTML = isFullscreen() ? ICON_COMPRESS : ICON_EXPAND;
          btn.title = isFullscreen() ? "退出全屏" : "全屏 / 退出全屏 (mini-window)";
        };

        var onClick = function () {
          notifyPermission();
          toggleFullscreen();
        };

        // Auto-request notification permission on startup so page-level
        // notifications can fire without requiring a prior button click
        // (Electron grants silently; a browser shows its own prompt).
        notifyPermission();

        btn.addEventListener("click", onClick);
        document.addEventListener("fullscreenchange", onFsChange);
        document.addEventListener("webkitfullscreenchange", onFsChange);
        // Electron window-level fullscreen does not fire the page event;
        // poll the bridge while the button exists so the icon stays honest.
        var fsPoll = null;
        if (hasNativeBridge()) {
          var lastFs = null;
          fsPoll = window.setInterval(function () {
            var now = isFullscreen();
            if (now !== lastFs) {
              lastFs = now;
              onFsChange();
            }
          }, 500);
        }

        // ----- session activity tracking -----
        var sessions = ctx.sessions;
        var prevRunning = new Map();
        var prevPending = new Map();
        var unsubscribe = null;

        var scan = function () {
          if (!sessions || !sessions.list) return;
          var snapshot;
          try {
            snapshot = sessions.list.getSnapshot();
          } catch (e) {
            return;
          }
          var items = snapshot && snapshot.items;
          if (!items || !items.length) return;

          for (var i = 0; i < items.length; i++) {
            var row = items[i];
            if (!row) continue;
            var id = row.sessionId;

            var running = Boolean(row.running);
            var wasRunning = prevRunning.get(id);
            prevRunning.set(id, running);

            // Task completion edge: running -> not running.
            if (wasRunning === true && !running) {
              sendNotification(
                "任务完成",
                "「" + (row.displayTitle || row.title || id) + "」已完成运行。",
                id,
                ctx
              );
            }

            // Pending user interaction edge: appeared now.
            var pending = row.pendingInteraction;
            var wasPending = prevPending.get(id);
            prevPending.set(id, pending);
            if (pending && pending !== wasPending) {
              var label = PENDING_LABELS[pending] || "需要你的确认";
              sendNotification(
                "等待你的确认",
                "「" + (row.displayTitle || row.title || id) + "」" + label + "。",
                id,
                ctx
              );
            }
          }
        };

        // Initial pass records baseline (no notifications on mount).
        if (sessions && sessions.list) {
          try {
            var snapshot0 = sessions.list.getSnapshot();
            var items0 = snapshot0 && snapshot0.items;
            if (items0) {
              for (var j = 0; j < items0.length; j++) {
                var row0 = items0[j];
                if (!row0) continue;
                prevRunning.set(row0.sessionId, Boolean(row0.running));
                prevPending.set(row0.sessionId, row0.pendingInteraction);
              }
            }
          } catch (e) {
            /* list not ready yet */
          }
          unsubscribe = sessions.list.subscribe(scan);
        }

        return function dispose() {
          if (unsubscribe) {
            try { unsubscribe(); } catch (e) { /* ignore */ }
          }
          if (fsPoll !== null) window.clearInterval(fsPoll);
          btn.removeEventListener("click", onClick);
          document.removeEventListener("fullscreenchange", onFsChange);
          document.removeEventListener("webkitfullscreenchange", onFsChange);
          if (btn.parentNode) btn.parentNode.removeChild(btn);
          if (styleTag && styleTag.parentNode) styleTag.parentNode.removeChild(styleTag);
        };
      }, "dsh-mini-window: floating button + notifications");
    }

    exports.apply = apply;
    exports.inject = [SESSIONS_SERVICE];
    return module.exports;
  }
});
