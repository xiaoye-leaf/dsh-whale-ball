# 🐋 小鲸球 (dsh-whale-ball)

> DeepSeek Harness 桌面悬浮球插件 —— 最小化主窗口时，一只玻璃质感的小鲸鱼球悬浮在桌面等你回来。

小鲸球是 [DeepSeek Harness](https://github.com/deepseek-ai) 桌面版增强插件。最小化主窗口后，桌面右下角会出现一个带 DeepSeek 鲸鱼 logo 的玻璃小球：拖动、点击恢复全屏、右键菜单，任务完成或需要你确认时还会弹出系统通知——窗口缩小了，但重要的事情一件都不会漏。

## ✨ 功能特性

**🐳 桌面悬浮球**（Electron 主进程）
- 最小化主窗口 → 桌面出现**透明玻璃磨砂**小球：白色高光 + 细磨砂噪点 + 玻璃描边，基本不上色、不挡视线（始终置顶、不占任务栏）
- **干净退出**：关闭主窗口时整个应用（连同悬浮球）一起退出，不会残留"点不动的幽灵小球"
- **按下即拖、零等待**：按下小球立刻可以拖动，主进程 4ms 高频轮询跟手，快速甩动也不掉队、不卡顿；松手自动判定——轻点（几乎没动、很快松手）仍是"进入"
- **整球可交互**：中心 logo 装饰层不拦截指针事件，整个球都能点、都能拖，不用找外圈
- **恢复即隐藏**：从最小化恢复主窗口时，悬浮球自动消失，不挡页面
- **轻点小球** → 恢复窗口并进入全屏
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

### 已安装旧版？升级或修复

- **换新样式 / 整体升级**：重新运行一次 `install.ps1` 即可。
- **修复"关闭窗口后悬浮球残留、点击无反应"**：以管理员身份运行补丁脚本 `patch-close.ps1`：

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\patch-close.ps1
  ```

  该脚本只修改一行（主窗口关闭 → 整个应用退出），重复运行安全。

### 方式二：手动安装

1. 将 `desktop\main.cjs`、`desktop\mini-preload.cjs`、`desktop\mini-main-preload.cjs` 复制到 DeepSeek Harness 的 `resources\app\` 目录（覆盖 `main.cjs` 前先备份）
2. 将 `lib\` 下的文件复制到插件目录 `%USERPROFILE%\.dsh\plugins\dsh-mini-window\lib\`
3. 确认插件目录存在 `package.json`（manifest，见仓库根目录）
4. 重启 DeepSeek Harness

## 🎮 使用说明

| 操作 | 效果 |
| --- | --- |
| 最小化主窗口 | 出现小鲸球 |
| 按下并拖动 | 移动小球位置（零等待、跟手不卡） |
| 轻点小球 | 恢复窗口并全屏 |
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
│   ├── mini-preload.cjs   # 小球页面桥接（click / menu / dragBegin / dragEnd）
│   └── mini-main-preload.cjs  # 主窗口原生桥接（双层全屏）
├── install.ps1            # 一键安装脚本（参数化）
├── patch-close.ps1        # 修复脚本：关闭主窗口时整体退出（防悬浮球残留）
├── preview/
│   └── ball-ui-preview.html   # 悬浮球外观预览
└── package.json           # 插件 manifest（插件 ID：dsh-mini-window）
```

## 🔧 工作原理（简）

- **桌面壳**：主窗口最小化时创建透明、置顶的 `BrowserWindow` 小球；球页通过 preload 桥接把点击/右键传给主进程
- **事件转发**：插件的 node 端监听 `approval/request`、`session/event`、`agent/status`，通过 stdio IPC 转发给桌面壳
- **会话轮询**：主进程每 2 秒轮询 `/api/session.list`，检测运行状态边沿（running → idle）触发完成通知，带 3 秒去重
- **双层全屏**：页面内按钮同时控制 `document.fullscreenElement` 与 Electron `setFullScreen` 两层，退出时两层都退

## 📝 更新记录

- **v1.0.2（当前）**
  - 拖动体验全面优化：**按下即拖**（取消 380ms 长按等待，首拖零延迟），主进程 **4ms 高频轮询**搬窗（消除拖动瞬间卡顿、快速甩动不掉队）
  - **整球可交互**：中心 logo 装饰层不再拦截指针事件，整个球都能点击/拖动
  - **恢复即隐藏**：从最小化恢复主窗口时悬浮球自动消失，不再挡页面
  - 交互自动判定：轻点 = 进入，按下移动 = 拖动，无需区分区域
- **v1.0.1**
  - 透明玻璃磨砂样式：修复透明窗口外围的方形光晕/方框问题
  - 关闭主窗口时整个应用一起退出：修复悬浮球残留、点击无反应的问题（`patch-close.ps1`）
  - 安装脚本两处健壮性修复（目录定位、编码兼容）
- **v1.0.0**：首个版本 —— 桌面悬浮球、智能通知、双层全屏修复

## 📄 License

[MIT](LICENSE)
