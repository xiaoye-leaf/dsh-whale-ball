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

### 方式零：复制给 AI，一句话自动安装（最省事）

不想自己跑脚本？把下面**整段**复制，发给你的 AI 助手（比如 DeepSeek Harness 会话），它就会自动判断版本、下载补丁并完成安装：

```text
请帮我安装「小鲸球」(dsh-whale-ball) 插件。

1. 先下载仓库：用 git clone https://github.com/xiaoye-leaf/dsh-whale-ball.git 或下载 https://github.com/xiaoye-leaf/dsh-whale-ball/archive/refs/heads/main.zip 并解压到临时目录（网络不通时请先让我开代理/VPN，不要用非官方镜像）。
2. 判断版本：查看 DeepSeek Harness 安装目录的 resources 文件夹（常见：D:\deepseek\DeepSeek Harness\resources、C:\Program Files\DeepSeek Harness\resources）——存在 app.asar 文件 → 官方打包版，运行仓库里的 install-asar.ps1；存在 app 文件夹且里面有 main.cjs → 解包/开发版，运行 install.ps1。路径不对时用 -ResourcesDir / -AppDir 参数指定，找不到安装目录就先问我。
3. 运行前提：我已退出 DeepSeek Harness；Node.js ≥ 18；npx 能联网（首次下载 asar 工具需等待几十秒）。
4. 完成后提醒我重启 DeepSeek Harness 并最小化窗口验证小鲸球出现；任何一步失败请停下报告，不要修改除安装文件以外的任何内容。
```

AI 会做的事：下载仓库 → 识别 `app.asar`（打包版）还是 `app\main.cjs`（解包版）→ 运行对应脚本（自动备份、打入悬浮球补丁、重新打包、同步插件）→ 校验语法后提示重启。

### 第一步：确认你的桌面版是哪种

打开 DeepSeek Harness 安装目录下的 `resources` 文件夹（默认 `D:\deepseek\DeepSeek Harness\resources` 或 `C:\Program Files\DeepSeek Harness\resources`）：

| 你看到的是 | 类型 | 用哪个脚本 |
| --- | --- | --- |
| `app.asar` 文件（没有 `app` 文件夹） | 官方打包版（大多数用户） | `install-asar.ps1` |
| `app` 文件夹（里面有 `main.cjs`） | 解包/开发版 | `install.ps1` |

### 方式一：官方打包版（app.asar）——推荐大多数用户

> 官方安装包把桌面壳打包成 `resources\app.asar` 单文件，不能直接改文件。`install-asar.ps1` 会自动完成 **解包 → 打入小鲸球补丁 → 重新打包**，全程无需手动处理 asar。

1. 安装前先**退出 DeepSeek Harness**
2. 右键 `install-asar.ps1` → **使用 PowerShell 运行**（建议管理员），脚本自动：
   - 备份 `app.asar` → `app.asar.bak`
   - 解包，写入 `main.cjs`（悬浮球 + 原生桥接 IPC）、`mini-preload.cjs`、`mini-main-preload.cjs`
   - 语法校验后重新打包回 `app.asar`
   - **自动注册插件**（创建插件目录、同步 profile 依赖副本、写入 `cordis.patch.yml` 引用）——页面内全屏按钮与通知无需手动配置
3. **重启 DeepSeek Harness**，最小化窗口，小鲸球就出现了！

> 首次运行需联网：脚本用 `npx` 下载 asar 打包工具（`@electron/asar`），等待几十秒属正常，之后会缓存。
>
> 若不在默认安装路径：
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\install-asar.ps1 -ResourcesDir "D:\你的路径\resources"
> ```

### 方式二：解包/开发版（resources\app 目录）

1. 安装前先**退出 DeepSeek Harness**
2. 右键 `install.ps1` → **使用 PowerShell 运行**（建议管理员），脚本自动：
   - 备份并替换 `resources\app\main.cjs`（加入桌面悬浮球 + 原生桥接 IPC）
   - 写入 `mini-preload.cjs`（小球页面桥接）与 `mini-main-preload.cjs`（主窗口全屏桥接）
   - **自动注册插件**：创建插件目录、同步 profile 依赖副本、写入 `cordis.patch.yml` 引用（页面内全屏按钮与通知无需手动配置）
3. **重启 DeepSeek Harness**，最小化窗口，小鲸球就出现了！

> 若 DeepSeek Harness 不在默认安装路径，请用参数指定：
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\install.ps1 -AppDir "D:\你的路径\resources\app"
> ```

### 已安装旧版？升级或修复

- **换新样式 / 整体升级**：按你的版本类型重新运行一次对应脚本（打包版用 `install-asar.ps1`，解包版用 `install.ps1`）即可，重复运行安全。
- **修复"关闭窗口后悬浮球残留、点击无反应"**（仅旧版本、解包版需要；新版本已内置该修复）：以管理员身份运行补丁脚本 `patch-close.ps1`：

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\patch-close.ps1
  ```

  该脚本只修改一行（主窗口关闭 → 整个应用退出），重复运行安全。

### 方式三：手动安装（仅解包版）

> 官方打包版（app.asar）无法手动改文件，请用方式一脚本。

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

### 方式一：卸载脚本（推荐）

右键 `uninstall.ps1` → **使用 PowerShell 运行**（建议管理员），脚本会自动识别你的版本类型（打包版 / 解包版）：

- 恢复原版桌面壳（`app.asar` / `main.cjs`）
- 删除插件目录与 **DSH profile 残留**（`profiles\node_modules` 副本、`cordis.yml` / `cordis.patch.yml` 引用、`package.json` 依赖声明）——避免卸载后 DeepSeek Harness 启动报 `Cannot find package 'dsh-mini-window'`

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

> 想保留插件目录（只还原桌面壳）？加参数：`-KeepPlugin`
> 不在默认安装路径？加参数：`-ResourcesDir "D:\你的路径\resources"`

### 方式二：手动回滚（备选）

安装脚本都会保留完整备份，按你的版本类型手动恢复：

**官方打包版（app.asar）**
1. 退出 DeepSeek Harness
2. 将 `resources\app.asar.bak` 复制回 `resources\app.asar`（覆盖）
3. 删除或还原插件目录 `%USERPROFILE%\.dsh\plugins\dsh-mini-window\`
4. 重启 DeepSeek Harness

**解包/开发版（resources\app 目录）**
1. 退出 DeepSeek Harness
2. 将 `resources\app\main.cjs.bak` 复制回 `resources\app\main.cjs`
3. 删除 `mini-preload.cjs`、`mini-main-preload.cjs`
4. 删除或还原插件目录 `%USERPROFILE%\.dsh\plugins\dsh-mini-window\`
5. 重启 DeepSeek Harness

> 若还用 `dsh plugin` 命令装过插件本体，可执行 `dsh plugin --profile web remove dsh-mini-window` 一并移除。

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
├── install.ps1            # 一键安装脚本（解包/开发版，参数化）
├── install-asar.ps1       # 一键安装脚本（官方打包版 app.asar，自动解包+回包）
├── uninstall.ps1          # 一键卸载脚本（自动识别两种版本，恢复原版）
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

- **v1.0.5（当前）**
  - **修复页面通知从未触发的 bug**：`client.js` 读取会话快照时误用不存在的 `byId` 字段（DSH 实际返回 `items` 数组），导致任务完成/等待确认时页面通知静默失效——改为正确遍历 `items`，提问、审批、任务完成现在会真正弹出系统通知
- **v1.0.4**
  - **新增一键卸载脚本 `uninstall.ps1`**：自动识别打包版/解包版，恢复原版桌面壳、清理插件目录（可 `-KeepPlugin` 保留）
  - **卸载更彻底**：同步清理 DSH profile 残留（依赖副本 + cordis 配置引用 + package.json 声明），修复卸载后启动报 `Cannot find package` 的问题
  - **安装脚本自动注册插件**：创建插件目录、同步 `profiles\node_modules` 依赖副本、写入 `cordis.patch.yml` 引用——页面内全屏按钮与通知开箱即用，无需手动配置
  - README 卸载章节更新：推荐脚本卸载，手动回滚留作备选
- **v1.0.3**
  - **支持官方打包版（app.asar）安装**：新增 `install-asar.ps1`，自动解包 → 打入悬浮球补丁 → 重新打包，解决"桌面版无法使用"的问题
  - 安装说明按版本类型分流：打包版用 `install-asar.ps1`，解包/开发版用 `install.ps1`
  - **新增"发给 AI 一句话安装"指令**：复制 README 中的指令发给 AI 助手即可自动安装
- **v1.0.2**
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
