# ============================================================
#  小鲸球 (dsh-whale-ball) - 官方桌面版一键安装脚本
#  （适用于 app.asar 打包的 DeepSeek Harness 桌面版）
#
#  背景：DeepSeek Harness 官方安装包把桌面壳打包成
#        resources\app.asar（单文件），没有可直改的
#        resources\app\main.cjs。本脚本用官方 asar 工具
#        解包 -> 打入小鲸球补丁 -> 重新打包。
#
#  流程：
#    1. 定位 resources\app.asar，备份为 app.asar.bak
#    2. 用 @electron/asar 解包到临时目录
#    3. 覆盖 main.cjs，写入 mini-preload.cjs / mini-main-preload.cjs
#    4. 校验语法后重新打包回 app.asar
#    5. 同步插件 lib\client.js / lib\index.js 到
#       %USERPROFILE%\.dsh\plugins\dsh-mini-window
#    6. 清理临时目录
#
#  用法：
#    右键 -> 使用 PowerShell 运行（建议管理员）
#    或：powershell -ExecutionPolicy Bypass -File .\install-asar.ps1
#    若 DeepSeek Harness 不在默认路径：
#        powershell -ExecutionPolicy Bypass -File .\install-asar.ps1 -ResourcesDir "D:\xxx\resources"
#
#  前置：Node.js >= 18（脚本会用 npx 拉取 @electron/asar，首次运行
#        需联网，等待几十秒属正常）。
#  安装前请先退出 DeepSeek Harness，安装完成后重启。
#  回滚：将 resources\app.asar.bak 复制回 resources\app.asar 后重启。
# ============================================================

[CmdletBinding()]
param(
    # DeepSeek Harness 的 resources 目录（含 app.asar）
    [string]$ResourcesDir,
    # 插件安装目录，默认 %USERPROFILE%\.dsh\plugins\dsh-mini-window
    [string]$PluginDir,
    # 本仓库源码目录，默认脚本所在目录
    [string]$Workspace
)

$ErrorActionPreference = 'Stop'

# ---------- 路径解析 ----------
if (-not $Workspace) { $Workspace = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $PluginDir) { $PluginDir = Join-Path $env:USERPROFILE '.dsh\plugins\dsh-mini-window' }

# ---------- resources 自动检测 ----------
$resCandidates = @(
    $ResourcesDir,
    'D:\deepseek\DeepSeek Harness\resources',
    'C:\Program Files\DeepSeek Harness\resources',
    'C:\Program Files (x86)\DeepSeek Harness\resources',
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources')
) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'app.asar')) }

if ($resCandidates.Count -eq 0) {
    Write-Host "ERROR: 未找到 resources\app.asar。" -ForegroundColor Red
    Write-Host "请确认：1) 安装的是官方打包版（存在 resources\app.asar）" -ForegroundColor Yellow
    Write-Host "        2) 路径正确，可用 -ResourcesDir 参数指定，例如：" -ForegroundColor Yellow
    Write-Host "           powershell -ExecutionPolicy Bypass -File .\install-asar.ps1 -ResourcesDir ""D:\你的路径\resources""" -ForegroundColor Yellow
    exit 1
}
# 过滤后只剩一个元素时会被解包成标量，[0] 会取到字符串首字符，
# 因此这里用 Select-Object -First 1 保证拿到完整路径。
$resDir = $resCandidates | Select-Object -First 1
if ($resCandidates.Count -gt 1) {
    Write-Host "检测到多个候选目录，使用: $resDir" -ForegroundColor DarkGray
}

$asar    = Join-Path $resDir 'app.asar'
$asarBak = Join-Path $resDir 'app.asar.bak'
$unpackedDir = Join-Path $resDir 'app.asar.unpacked'

$srcMain        = Join-Path $Workspace 'desktop\main.cjs'
$srcBallPreload = Join-Path $Workspace 'desktop\mini-preload.cjs'
$srcMainPreload = Join-Path $Workspace 'desktop\mini-main-preload.cjs'
$srcClient      = Join-Path $Workspace 'lib\client.js'
$srcPlugin      = Join-Path $Workspace 'lib\index.js'

$dstClient = Join-Path $PluginDir 'lib\client.js'
$dstPlugin = Join-Path $PluginDir 'lib\index.js'

Write-Host "目标: $asar" -ForegroundColor Cyan
Write-Host "插件: $PluginDir" -ForegroundColor Cyan

# ---------- 检查 ----------
foreach ($src in @($srcMain, $srcBallPreload, $srcMainPreload, $srcClient, $srcPlugin)) {
    if (-not (Test-Path $src)) {
        Write-Host "ERROR: 源码文件缺失: $src" -ForegroundColor Red; exit 1
    }
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: 未找到 npx，请先安装 Node.js（https://nodejs.org）" -ForegroundColor Red
    exit 1
}

# ---------- 1. 备份 ----------
if (Test-Path $asarBak) {
    Write-Host "[1/6] app.asar.bak 已存在，跳过备份（重复运行安全）" -ForegroundColor DarkGray
} else {
    Copy-Item $asar $asarBak -Force
    Write-Host "[1/6] 已备份 app.asar -> app.asar.bak" -ForegroundColor Cyan
}

# ---------- 2. 解包 ----------
$tmp = Join-Path $env:TEMP ("dsh-whale-asar-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    Write-Host "[2/6] 正在解包 app.asar（首次运行需联网下载 asar 工具，请稍候）..." -ForegroundColor Cyan
    & npx -y @electron/asar extract $asar $tmp
    if ($LASTEXITCODE -ne 0) { throw 'asar extract 失败' }
    $tmpMain = Join-Path $tmp 'main.cjs'
    if (-not (Test-Path $tmpMain)) {
        throw "解包后未找到 main.cjs（$tmpMain）"
    }

    # ---------- 3. 打入补丁 ----------
    Copy-Item $srcMain $tmpMain -Force
    Copy-Item $srcBallPreload (Join-Path $tmp 'mini-preload.cjs') -Force
    Copy-Item $srcMainPreload (Join-Path $tmp 'mini-main-preload.cjs') -Force
    Write-Host "[3/6] 补丁已写入：main.cjs / mini-preload.cjs / mini-main-preload.cjs" -ForegroundColor Cyan

    # ---------- 4. 校验 + 回包 ----------
    Write-Host "[4/6] 校验语法..."
    node --check $tmpMain
    if ($LASTEXITCODE -ne 0) { throw 'main.cjs 语法校验失败' }
    node --check (Join-Path $tmp 'mini-preload.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'mini-preload.cjs 语法校验失败' }
    node --check (Join-Path $tmp 'mini-main-preload.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'mini-main-preload.cjs 语法校验失败' }
    Write-Host "  语法 OK，正在重新打包 app.asar..."
    # --unpack "*.node"：若官方包含原生模块，保持其不进入 asar（走 app.asar.unpacked）
    & npx -y @electron/asar pack $tmp $asar --unpack "*.node"
    if ($LASTEXITCODE -ne 0) { throw 'asar pack 失败' }
    Write-Host "[4/6] app.asar 已重新打包完成" -ForegroundColor Cyan
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------- 5. 插件本体（自动创建目录 + manifest） ----------
$srcManifest = Join-Path $Workspace 'package.json'
if (-not (Test-Path $PluginDir)) {
    New-Item -ItemType Directory -Path (Join-Path $PluginDir 'lib') -Force | Out-Null
    Write-Host "[5/6] 插件目录不存在，已创建: $PluginDir" -ForegroundColor DarkGray
}
Copy-Item $srcManifest (Join-Path $PluginDir 'package.json') -Force
Copy-Item $srcClient $dstClient -Force
Copy-Item $srcPlugin $dstPlugin -Force
Write-Host "[5/6] 插件已更新（package.json + client.js + index.js）" -ForegroundColor Cyan

# ---------- 6. 同步 profile 依赖副本 + 注册 cordis ----------
$profilesRoot = Join-Path $env:USERPROFILE '.dsh\profiles'
$nmPkg = Join-Path $profilesRoot 'node_modules\dsh-mini-window'
New-Item -ItemType Directory -Path (Join-Path $nmPkg 'lib') -Force | Out-Null
Copy-Item $srcManifest (Join-Path $nmPkg 'package.json') -Force
Copy-Item $srcClient (Join-Path $nmPkg 'lib\client.js') -Force
Copy-Item $srcPlugin (Join-Path $nmPkg 'lib\index.js') -Force
Write-Host "[6/6] profile 依赖副本已就绪: $nmPkg" -ForegroundColor Cyan
$patchCfg = Join-Path $profilesRoot 'web\cordis.patch.yml'
if (Test-Path $patchCfg) {
    $hasRef = Select-String -Path $patchCfg -Pattern 'dsh-mini-window' -Quiet
    if (-not $hasRef) {
        $block = "`r`n# dsh-mini-window: page fullscreen button + notifications`r`n- insert:`r`n    - id: mini-window`r`n      name: 'dsh-mini-window'`r`n"
        [System.IO.File]::AppendAllText($patchCfg, $block, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "[6/6] 已注册插件到 cordis.patch.yml" -ForegroundColor Cyan
    } else {
        Write-Host "[6/6] cordis.patch.yml 无需修改（已注册）" -ForegroundColor DarkGray
    }
}

# ---------- 完成 ----------
Write-Host ""
if (Test-Path $unpackedDir) {
    Write-Host "提示: 检测到 app.asar.unpacked（原生模块），已保留，打包时对其中的 .node 文件做了 unpack 处理。" -ForegroundColor DarkGray
}
Write-Host "安装完成！请重启 DeepSeek Harness。" -ForegroundColor Green
Write-Host "  - 最小化 -> 小鲸球出现；轻点 -> 恢复并全屏；按下拖动 -> 移动"
Write-Host "  - 关闭主窗口 -> 整个应用（含悬浮球）一起退出"
Write-Host "  - 任务完成 / 需要确认时弹出系统通知"
Write-Host ""
Write-Host "回滚: 将 $asarBak 复制回 $asar 后重启。"
