# ============================================================
#  小鲸球 (dsh-whale-ball) - DeepSeek Harness 桌面悬浮球
#  一键安装脚本
#
#  作用：
#    1. 备份并替换 <AppDir>\main.cjs
#       加入：桌面悬浮球（最小化 -> 小球；点击球心 -> 恢复+全屏）
#            主窗口原生桥接 IPC（dsh-native:set-fullscreen）
#            宿主 IPC 消费（approval / turn-end / agent-status）
#    2. 写入 <AppDir>\mini-preload.cjs（小球页面桥接）
#    3. 写入 <AppDir>\mini-main-preload.cjs（主窗口全屏桥接）
#    4. 替换插件 <PluginDir>\lib\client.js（双层全屏修复 + 通知）
#    5. 替换插件 <PluginDir>\lib\index.js（IPC 转发 node 端）
#
#  用法：
#    右键 -> 使用 PowerShell 运行（建议管理员）
#    或：powershell -ExecutionPolicy Bypass -File .\install.ps1
#    若 DeepSeek Harness 不在默认路径：
#        powershell -ExecutionPolicy Bypass -File .\install.ps1 -AppDir "D:\xxx\resources\app"
#
#  安装前请先退出 DeepSeek Harness，安装完成后重启。
#  回滚：将 <AppDir>\main.cjs.bak 复制回 main.cjs 并重启。
# ============================================================

[CmdletBinding()]
param(
    # DeepSeek Harness 的 resources\app 目录（含 main.cjs）
    [string]$AppDir,
    # 插件安装目录，默认 %USERPROFILE%\.dsh\plugins\dsh-mini-window
    [string]$PluginDir,
    # 本仓库源码目录，默认脚本所在目录
    [string]$Workspace
)

$ErrorActionPreference = 'Stop'

# ---------- 路径解析 ----------
if (-not $Workspace) { $Workspace = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $PluginDir) { $PluginDir = Join-Path $env:USERPROFILE '.dsh\plugins\dsh-mini-window' }

# ---------- AppDir 自动检测 ----------
$appCandidates = @(
    $AppDir,
    'D:\deepseek\DeepSeek Harness\resources\app',
    'C:\Program Files\DeepSeek Harness\resources\app',
    'C:\Program Files (x86)\DeepSeek Harness\resources\app'
) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'main.cjs')) }

if ($appCandidates.Count -eq 0) {
    Write-Host "ERROR: 未找到 DeepSeek Harness 的 resources\app 目录。" -ForegroundColor Red
    $resCandidates = @(
        'D:\deepseek\DeepSeek Harness\resources',
        'C:\Program Files\DeepSeek Harness\resources',
        'C:\Program Files (x86)\DeepSeek Harness\resources'
    ) | Where-Object { Test-Path (Join-Path $_ 'app.asar') }
    if ($resCandidates.Count -gt 0) {
        Write-Host "检测到你的桌面版是官方打包版（app.asar），请改用 install-asar.ps1：" -ForegroundColor Yellow
        Write-Host "  powershell -ExecutionPolicy Bypass -File .\install-asar.ps1" -ForegroundColor Yellow
    } else {
        Write-Host "请用 -AppDir 参数指定，例如：" -ForegroundColor Yellow
        Write-Host "  powershell -ExecutionPolicy Bypass -File .\install.ps1 -AppDir ""D:\你的路径\resources\app""" -ForegroundColor Yellow
    }
    exit 1
}
# 注意：候选过滤后只剩一个元素时会被解包成标量，[0] 会取到字符串首字符，
# 因此这里用 Select-Object -First 1 保证拿到完整路径。
$appDir = $appCandidates | Select-Object -First 1
if ($appCandidates.Count -gt 1) {
    Write-Host "检测到多个候选目录，使用: $appDir" -ForegroundColor DarkGray
}

$srcMain        = Join-Path $Workspace 'desktop\main.cjs'
$srcBallPreload = Join-Path $Workspace 'desktop\mini-preload.cjs'
$srcMainPreload = Join-Path $Workspace 'desktop\mini-main-preload.cjs'
$srcClient      = Join-Path $Workspace 'lib\client.js'
$srcPlugin      = Join-Path $Workspace 'lib\index.js'

$dstMain        = Join-Path $appDir 'main.cjs'
$dstBallPreload = Join-Path $appDir 'mini-preload.cjs'
$dstMainPreload = Join-Path $appDir 'mini-main-preload.cjs'
$dstClient      = Join-Path $PluginDir 'lib\client.js'
$dstPlugin      = Join-Path $PluginDir 'lib\index.js'

Write-Host "目标: $appDir" -ForegroundColor Cyan
Write-Host "插件: $PluginDir" -ForegroundColor Cyan

# ---------- 检查 ----------
if (-not (Test-Path $appDir)) {
    Write-Host "ERROR: app 目录不存在: $appDir" -ForegroundColor Red; exit 1
}
foreach ($src in @($srcMain, $srcBallPreload, $srcMainPreload, $srcClient, $srcPlugin)) {
    if (-not (Test-Path $src)) {
        Write-Host "ERROR: 源码文件缺失: $src" -ForegroundColor Red; exit 1
    }
}

# ---------- 1. main.cjs ----------
if (Test-Path $dstMain) {
    $bak = Join-Path $appDir 'main.cjs.bak'
    if (-not (Test-Path $bak)) {
        Copy-Item $dstMain $bak -Force
        Write-Host "[1/6] 已备份 main.cjs -> main.cjs.bak" -ForegroundColor Cyan
    } else {
        Write-Host "[1/6] main.cjs.bak 已存在，跳过备份" -ForegroundColor DarkGray
    }
}
Copy-Item $srcMain $dstMain -Force
Write-Host "[1/6] main.cjs 已替换（桌面悬浮球 + 原生桥接）" -ForegroundColor Cyan

# ---------- 2. 小球 preload ----------
Copy-Item $srcBallPreload $dstBallPreload -Force
Write-Host "[2/6] mini-preload.cjs 已写入（小球桥接）" -ForegroundColor Cyan

# ---------- 3. 主窗口 preload ----------
Copy-Item $srcMainPreload $dstMainPreload -Force
Write-Host "[3/6] mini-main-preload.cjs 已写入（窗口全屏桥接）" -ForegroundColor Cyan

# ---------- 4. 插件本体（自动创建目录 + manifest） ----------
$srcManifest = Join-Path $Workspace 'package.json'
if (-not (Test-Path $PluginDir)) {
    New-Item -ItemType Directory -Path (Join-Path $PluginDir 'lib') -Force | Out-Null
    Write-Host "[4/6] 插件目录不存在，已创建: $PluginDir" -ForegroundColor DarkGray
}
Copy-Item $srcManifest (Join-Path $PluginDir 'package.json') -Force
Copy-Item $srcClient $dstClient -Force
Write-Host "[4/6] 插件已更新（package.json + client.js + index.js）" -ForegroundColor Cyan
Copy-Item $srcPlugin $dstPlugin -Force

# ---------- 5. 同步 profile 依赖副本（cordis require 的解析位置） ----------
$profilesRoot = Join-Path $env:USERPROFILE '.dsh\profiles'
$nmPkg = Join-Path $profilesRoot 'node_modules\dsh-mini-window'
New-Item -ItemType Directory -Path (Join-Path $nmPkg 'lib') -Force | Out-Null
Copy-Item $srcManifest (Join-Path $nmPkg 'package.json') -Force
Copy-Item $srcClient (Join-Path $nmPkg 'lib\client.js') -Force
Copy-Item $srcPlugin (Join-Path $nmPkg 'lib\index.js') -Force
Write-Host "[5/6] profile 依赖副本已就绪: $nmPkg" -ForegroundColor Cyan

# ---------- 6. 注册 cordis.patch.yml + 清理残留 ----------
$patchCfg = Join-Path $profilesRoot 'web\cordis.patch.yml'
$patchInserted = $false
if (Test-Path $patchCfg) {
    $hasRef = Select-String -Path $patchCfg -Pattern 'dsh-mini-window' -Quiet
    if (-not $hasRef) {
        $block = "`r`n# dsh-mini-window: page fullscreen button + notifications`r`n- insert:`r`n    - id: mini-window`r`n      name: 'dsh-mini-window'`r`n"
        [System.IO.File]::AppendAllText($patchCfg, $block, (New-Object System.Text.UTF8Encoding($false)))
        $patchInserted = $true
    }
}
if ($patchInserted) {
    Write-Host "[6/6] 已注册插件到 cordis.patch.yml（重启后页面内按钮生效）" -ForegroundColor Cyan
} else {
    Write-Host "[6/6] cordis.patch.yml 无需修改（已注册或不存在）" -ForegroundColor DarkGray
}
$pluginBak = Join-Path $PluginDir 'lib\index.js.bak'
if (Test-Path $pluginBak) {
    Remove-Item $pluginBak -Force
    Write-Host "[6/6] 已删除插件内残留 index.js.bak" -ForegroundColor DarkGray
}

# ---------- 校验 ----------
Write-Host ""
Write-Host "正在校验语法..."
node --check $dstMain
Write-Host "  main.cjs: $(if ($LASTEXITCODE -eq 0) {'OK'} else {'ERROR'})"
node --check $dstBallPreload
Write-Host "  mini-preload.cjs: $(if ($LASTEXITCODE -eq 0) {'OK'} else {'ERROR'})"
node --check $dstMainPreload
Write-Host "  mini-main-preload.cjs: $(if ($LASTEXITCODE -eq 0) {'OK'} else {'ERROR'})"

Write-Host ""
Write-Host "安装完成！请重启 DeepSeek Harness。" -ForegroundColor Green
Write-Host "  - 最小化 -> 小鲸球出现（任务栏入口保留）"
Write-Host "  - 单击小球 -> 恢复并全屏；长按约 0.4 秒 -> 拖动"
Write-Host "  - 关闭主窗口 -> 整个应用（含悬浮球）一起退出"
Write-Host "  - 页面内按钮可同时退出页面级与窗口级全屏"
Write-Host "  - 任务完成 / 需要确认时弹出系统通知"
Write-Host ""
Write-Host "回滚: 将 $appDir\main.cjs.bak 复制回 main.cjs 后重启。"
