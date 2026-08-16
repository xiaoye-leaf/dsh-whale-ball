# 🐋 小鲸球 (dsh-whale-ball)

> DeepSeek Harness 桌面悬浮球插件 —— 最小化主窗口时，一只玻璃质感的小鲸鱼球悬浮在桌面等你回来。

小鲸球是 [DeepSeek Harness](https://github.com/deepseek-ai) 桌面版增强插件。最小化主窗口后，桌面右下角会出现一个带 DeepSeek 鲸鱼 logo 的玻璃小球：拖动、点击恢复全屏、右键菜单，任务完成或需要你确认时还会弹出系统通知——窗口缩小了，但重要的事情一件都不会漏。

## ✨ 功能特性

**🐳 桌面悬浮球**（Electron 主进程）
- 最小化主窗口 → 桌面出现玻璃质感小球（始终置顶、不占任务栏）
- **按住球体拖动**（OS 级拖拽），悬停放大
- **点击球心** → 恢复窗口并进入全屏
- **右键菜单** → 恢复窗口 / 恢复并全屏 / 隐藏悬浮球 / 退出
- **智能通知**：任务完成、任务出错、需要权限确认时，即使窗口最小化也会弹系统通知，点击通知直接回到对应会话
- 实时状态轮询（`session.list` API），只在窗口不在前台时提醒，去重防打扰

**🎯 页面内悬浮按钮**（浏览器端插件）
- 右下角全屏切换按钮，一键进出全屏
- **双层全屏修复**：同时处理页面级全屏（`requestFullscreen`）和 Electron 窗口级全屏（`setFullScreen`），彻底解决"进了全屏退不出来"的问题
- 会话状态通知：任务完成、等待权限/计划评审/回答问题时弹出系统通知

## 🖼️ 预览

无需安装即可预览悬浮球外观：用浏览器打开 [`preview/ball-ui-preview.html`](preview/ball-ui-preview.html)。

## 📦 安装

### 前置条件

| 依赖 | 说明 |
| --- | --- |
| Windows 10/11 | 悬浮球基于 Electron 桌面壳 |
| DeepSeek Harness 桌面版 | 已安装且能正常运行 |
| Node.js ≥ 18 | 安装脚本会做语法校验 |

### 方式一：一键安装脚本（推荐）

> 安装前请先**退出 DeepSeek Harness**。

右键 `install.ps1` → **使用 PowerShell 运行**（管理员运行更稳妥），脚本会自动：

1. 备份并替换 `resources\app\main.cjs`（加入桌面悬浮球 + 原生桥接 IPC）
2. 写入 `mini-preload.cjs`（小球页面桥接）与 `mini-main-preload.cjs`（主窗口全屏桥接）
3. 更新插件 `lib\client.js`（双层全屏修复）与 `lib\index.js`（IPC 转发）

完成后**重启 DeepSeek Harness**，最小化窗口，小鲸球就出现了！

> 若 DeepSeek Harness 不在默认安装路径，请用参数指定：
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\install.ps1 -AppDir "D:\你的路径\resources\app"
> ```

### 方式二：手动安装

1. 将 `desktop\main.cjs`、`desktop\mini-preload.cjs`、`desktop\mini-main-preload.cjs` 复制到 DeepSeek Harness 的 `resources\app\` 目录（覆盖 `main.cjs` 前先备份）
2. 将 `lib\` 下的文件复制到插件目录 `%USERPROFILE%\.dsh\plugins\dsh-mini-window\lib\`
3. 确认插件目录存在 `package.json`（manifest，见仓库根目录）
4. 重启 DeepSeek Harness

## 🎮 使用说明

| 操作 | 效果 |
| --- | --- |
| 最小化主窗口 | 出现小鲸球 |
| 按住球体拖动 | 移动小球位置 |
| 单击球心 | 恢复窗口并全屏 |
| 右键小球 | 恢复 / 恢复并全屏 / 隐藏 / 退出 |
| 任务完成时 | 系统通知（点击回到会话） |
| 需要确认时 | 系统通知 + 小球进入"关注"状态 |

## ♻️ 卸载 / 回滚

安装脚本会保留备份 `main.cjs.bak`：

1. 退出 DeepSeek Harness
2. 将 `resources\app\main.cjs.bak` 复制回 `resources\app\main.cjs`
3. 删除 `mini-preload.cjs`、`mini-main-preload.cjs`
4. 删除或还原插件目录 `%USERPROFILE%\.dsh\plugins\dsh-mini-window\`
5. 重启 DeepSeek Harness

## 📁 目录结构

```
dsh-whale-ball/
├── lib/
│   ├── index.js           # 插件 node 端：把宿主事件转发给桌面壳
│   └── client.js          # 插件浏览器端：页面内全屏按钮 + 通知
├── desktop/
│   ├── main.cjs           # Electron 主进程：悬浮球窗口 + 通知 + 会话轮询
│   ├── mini-preload.cjs   # 小球页面桥接（click / menu）
│   └── mini-main-preload.cjs  # 主窗口原生桥接（双层全屏）
├── install.ps1            # 一键安装脚本（参数化）
├── preview/
│   └── ball-ui-preview.html   # 悬浮球外观预览
└── package.json           # 插件 manifest（插件 ID：dsh-mini-window）
```

## 🔧 工作原理（简）

- **桌面壳**：主窗口最小化时创建透明、置顶的 `BrowserWindow` 小球；球页通过 preload 桥接把点击/右键传给主进程
- **事件转发**：插件的 node 端监听 `approval/request`、`session/event`、`agent/status`，通过 stdio IPC 转发给桌面壳
- **会话轮询**：主进程每 2 秒轮询 `/api/session.list`，检测运行状态边沿（running → idle）触发完成通知，带 3 秒去重
- **双层全屏**：页面内按钮同时控制 `document.fullscreenElement` 与 Electron `setFullScreen` 两层，退出时两层都退

## 📄 License

[MIT](LICENSE)
