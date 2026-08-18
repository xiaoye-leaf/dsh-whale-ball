# ============================================================
#  小鲸球 (dsh-whale-ball) - 一键卸载脚本
#
#  支持两种安装方式（自动识别）：
#    1. 官方打包版（resources\app.asar）：
#       用备份 app.asar.bak 恢复原版，删除备份
#    2. 解包/开发版（resources\app\main.cjs）：
#       用备份 main.cjs.bak 恢复原版，删除 mini-preload.cjs /
#       mini-main-preload.cjs 与 main.cjs.bak
#   两种方式都会删除插件目录 %USERPROFILE%\.dsh\plugins\dsh-mini-window
#   （可用 -KeepPlugin 保留）。
#
#  用法：
#    右键 -> 使用 PowerShell 运行（建议管理员）
#    或：powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#    若 DeepSeek Harness 不在默认路径：
#        powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -ResourcesDir "D:\xxx\resources"
#
#  卸载前请先退出 DeepSeek Harness，卸载完成后重启。
# ============================================================

[CmdletBinding()]
param(
    # DeepSeek Harness 的 resources 目录（含 app.asar 或 app 文件夹）
    [string]$ResourcesDir,
    # 插件安装目录，默认 %USERPROFILE%\.dsh\plugins\dsh-mini-window
    [string]$PluginDir,
    # 保留插件目录（默认删除）
    [switch]$KeepPlugin
)

$ErrorActionPreference = 'Stop'

if (-not $PluginDir) { $PluginDir = Join-Path $env:USERPROFILE '.dsh\plugins\dsh-mini-window' }

# ---------- resources 自动检测 ----------
$resCandidates = @(
    $ResourcesDir,
    'D:\deepseek\DeepSeek Harness\resources',
    'C:\Program Files\DeepSeek Harness\resources',
    'C:\Program Files (x86)\DeepSeek Harness\resources',
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources')
) | Where-Object { $_ -and (Test-Path $_) }

if ($resCandidates.Count -eq 0) {
    Write-Host "ERROR: 未找到 DeepSeek Harness 的 resources 目录。" -ForegroundColor Red
    Write-Host "请用 -ResourcesDir 参数指定，例如：" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -ResourcesDir ""D:\你的路径\resources""" -ForegroundColor Yellow
    exit 1
}
# 过滤后只剩一个元素时会被解包成标量，[0] 会取到字符串首字符，
# 因此这里用 Select-Object -First 1 保证拿到完整路径。
$resDir = $resCandidates | Select-Object -First 1
if ($resCandidates.Count -gt 1) {
    Write-Host "检测到多个候选目录，使用: $resDir" -ForegroundColor DarkGray
}

$asar        = Join-Path $resDir 'app.asar'
$asarBak     = Join-Path $resDir 'app.asar.bak'
$appDir      = Join-Path $resDir 'app'
$mainCjs     = Join-Path $appDir 'main.cjs'
$mainBak     = Join-Path $appDir 'main.cjs.bak'

$isAsar      = Test-Path $asar
$isExtracted = Test-Path $mainCjs

if (-not $isAsar -and -not $isExtracted) {
    Write-Host "ERROR: 未找到可卸载的安装（resources 下既无 app.asar 也无 app\main.cjs）。" -ForegroundColor Red
    Write-Host "若你从未安装过小鲸球，无需卸载。" -ForegroundColor Yellow
    exit 1
}

Write-Host "目标: $resDir" -ForegroundColor Cyan

# ---------- 1. 恢复桌面壳 ----------
if ($isAsar) {
    Write-Host "[1/3] 检测到官方打包版（app.asar）..." -ForegroundColor DarkGray
    if (Test-Path $asarBak) {
        Copy-Item $asarBak $asar -Force
        Remove-Item $asarBak -Force
        Write-Host "[1/3] 已用 app.asar.bak 恢复原版 app.asar" -ForegroundColor Cyan
    } else {
        Write-Host "[1/3] WARNING: 未找到 app.asar.bak，无法自动还原原版。" -ForegroundColor Yellow
        Write-Host "         （若需要完整原版，请重新安装 DeepSeek Harness 覆盖即可）" -ForegroundColor Yellow
    }
} else {
    Write-Host "[1/3] 检测到解包/开发版（app 文件夹）..." -ForegroundColor DarkGray
    if (Test-Path $mainBak) {
        Copy-Item $mainBak $mainCjs -Force
        Remove-Item $mainBak -Force
        Write-Host "[1/3] 已用 main.cjs.bak 恢复原版 main.cjs" -ForegroundColor Cyan
    } else {
        Write-Host "[1/3] WARNING: 未找到 main.cjs.bak，无法自动还原原版 main.cjs。" -ForegroundColor Yellow
    }
    foreach ($f in @((Join-Path $appDir 'mini-preload.cjs'), (Join-Path $appDir 'mini-main-preload.cjs'))) {
        if (Test-Path $f) {
            Remove-Item $f -Force
            Write-Host "  已删除 $(Split-Path $f -Leaf)" -ForegroundColor DarkGray
        }
    }
}

# ---------- 2. 插件目录 ----------
if ($KeepPlugin) {
    Write-Host "[2/3] 已按 -KeepPlugin 保留插件目录: $PluginDir" -ForegroundColor DarkGray
} elseif (Test-Path $PluginDir) {
    Remove-Item $PluginDir -Recurse -Force
    Write-Host "[2/3] 已删除插件目录: $PluginDir" -ForegroundColor Cyan
} else {
    Write-Host "[2/3] 插件目录不存在，无需删除" -ForegroundColor DarkGray
}

# ---------- 3. 完成 ----------
Write-Host "[3/3] 卸载完成！请重启 DeepSeek Harness。" -ForegroundColor Green
Write-Host "  - 桌面壳已恢复原版，悬浮球功能已移除"
$unpackedDir = Join-Path $resDir 'app.asar.unpacked'
if ($isAsar -and (Test-Path $unpackedDir)) {
    Write-Host "  - 提示: 检测到 app.asar.unpacked 目录。若安装前不存在（可能是安装时打包工具生成的），可手动删除；若不确定请保留。" -ForegroundColor DarkGray
}
Write-Host "  - 若还用过 dsh plugin 命令安装插件本体，可执行：dsh plugin --profile web remove dsh-mini-window" -ForegroundColor DarkGray
