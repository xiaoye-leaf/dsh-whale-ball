# ============================================================
#  小鲸球 (dsh-whale-ball) - 一键卸载脚本
#
#  支持两种安装方式（自动识别）：
#    1. 官方打包版（resources\app.asar）：
#       用备份 app.asar.bak 恢复原版，删除备份
#    2. 解包/开发版（resources\app\main.cjs）：
#       用备份 main.cjs.bak 恢复原版，删除 mini-preload.cjs /
#       mini-main-preload.cjs 与 main.cjs.bak
#
#  除插件目录外，还会清理 DSH profile 里的残留，避免卸载后
#  DeepSeek Harness 启动报 "Cannot find package 'dsh-mini-window'"：
#    - %USERPROFILE%\.dsh\plugins\dsh-mini-window（插件本体）
#    - %USERPROFILE%\.dsh\profiles\node_modules\dsh-mini-window
#      （profile 依赖副本/软链接）
#    - profiles\web\cordis.yml / cordis.patch.yml 中的引用条目
#    - profiles\web\package.json 中的依赖声明（如有）
#
#  用法：
#    右键 -> 使用 PowerShell 运行（建议管理员）
#    或：powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#    若 DeepSeek Harness 不在默认路径：
#        powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -ResourcesDir "D:\xxx\resources"
#
#  卸载前请先退出 DeepSeek Harness，卸载完成后重启。
#  若只想还原桌面壳、保留插件（如重新安装场景），加 -KeepPlugin。
# ============================================================

[CmdletBinding()]
param(
    # DeepSeek Harness 的 resources 目录（含 app.asar 或 app 文件夹）
    [string]$ResourcesDir,
    # 插件安装目录，默认 %USERPROFILE%\.dsh\plugins\dsh-mini-window
    [string]$PluginDir,
    # 保留插件目录与 profile 残留（默认全部删除）
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

# ============================================================
#  辅助：从 YAML 配置中移除包含指定关键字的条目块
#  覆盖两种形态：
#    形态A：- id: xxx / - name: xxx（独立列表项，含缩进子行）
#    形态B：- insert: 块，其中某个子项含关键字（整块删除）
#  实现：先扫描标记删除区间，再统一过滤重建，保证不残留半个块。
#  修改前自动备份为 <文件>.bak；返回是否发生了删除。
# ============================================================
function Remove-YamlEntryContaining {
    param([string]$Path, [string]$Needle)

    if (-not (Test-Path $Path)) { return $false }
    $lines = [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)

    # ---- 第一遍：标记删除区间 ----
    $ranges = New-Object 'System.Collections.Generic.List[object]'
    $i = 0
    while ($i -lt $lines.Count) {
        $line = $lines[$i]

        if ($line -match [regex]::Escape($Needle)) {
            # 注释行：只删本行
            if ($line -match '^\s*#') {
                $ranges.Add(@($i, ($i + 1))); $i++; continue
            }

            # 形态B：命中 name: dsh-mini-window（insert 块的子项）→ 向上找 - insert: 起点，整块删
            if ($line -match '^\s+name\s*:') {
                $start = $i
                while ($start -ge 0 -and $lines[$start] -notmatch '^\s*- insert\s*:') { $start-- }
                if ($start -lt 0) { $start = $i }
                $insertIndent = ($lines[$start] -replace '\S.*$', '').Length
                $end = $start
                while ($end -lt $lines.Count) {
                    $l = $lines[$end]
                    if ($end -eq $start) { $end++; continue }
                    if ($l -match '^\s*$') { $end++; continue }
                    if (($l -replace '\S.*$', '').Length -gt $insertIndent) { $end++; continue }
                    break
                }
                $ranges.Add(@($start, $end))
                $i = $end
                continue
            }

            # 形态A：- id: dsh-mini-window 等独立列表项 → 删本行及其缩进子行
            $indent = ($line -replace '\S.*$', '').Length
            $end = $i + 1
            while ($end -lt $lines.Count -and $lines[$end] -match '^\s' -and ($lines[$end] -replace '\S.*$', '').Length -gt $indent) { $end++ }
            $ranges.Add(@($i, $end))
            $i = $end
            continue
        }

        $i++
    }

    if ($ranges.Count -eq 0) { return $false }

    # ---- 第二遍：按区间过滤重建 ----
    $result = New-Object 'System.Collections.Generic.List[string]'
    for ($k = 0; $k -lt $lines.Count; $k++) {
        $skip = $false
        foreach ($r in $ranges) {
            if ($k -ge $r[0] -and $k -lt $r[1]) { $skip = $true; break }
        }
        if (-not $skip) { $result.Add($lines[$k]) }
    }

    Copy-Item $Path "$Path.bak" -Force
    [System.IO.File]::WriteAllLines($Path, $result, (New-Object System.Text.UTF8Encoding($true)))
    Write-Host "  已更新 $Path（原文件备份为 .bak）" -ForegroundColor DarkGray
    return $true
}

# ============================================================
#  辅助：从 package.json 的 dependencies 中移除指定包
# ============================================================
function Remove-PackageJsonDependency {
    param([string]$Path, [string]$PackageName)

    if (-not (Test-Path $Path)) { return $false }
    try {
        $json = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch { return $false }
    $removed = $false
    foreach ($section in @('dependencies', 'devDependencies')) {
        if ($json.PSObject.Properties.Name -contains $section -and $json.$section.PSObject.Properties.Name -contains $PackageName) {
            $json.$section.PSObject.Properties.Remove($PackageName)
            $removed = $true
        }
    }
    if ($removed) {
        Copy-Item $Path "$Path.bak" -Force
        $json | ConvertTo-Json -Depth 10 | Set-Content $Path -Encoding UTF8
        Write-Host "  已从 package.json 移除依赖 $PackageName（原文件备份为 .bak）" -ForegroundColor DarkGray
    }
    return $removed
}

# ---------- 1. 恢复桌面壳 ----------
if ($isAsar) {
    Write-Host "[1/4] 检测到官方打包版（app.asar）..." -ForegroundColor DarkGray
    if (Test-Path $asarBak) {
        Copy-Item $asarBak $asar -Force
        Remove-Item $asarBak -Force
        Write-Host "[1/4] 已用 app.asar.bak 恢复原版 app.asar" -ForegroundColor Cyan
    } else {
        Write-Host "[1/4] WARNING: 未找到 app.asar.bak，无法自动还原原版。" -ForegroundColor Yellow
        Write-Host "         （若需要完整原版，请重新安装 DeepSeek Harness 覆盖即可）" -ForegroundColor Yellow
    }
} else {
    Write-Host "[1/4] 检测到解包/开发版（app 文件夹）..." -ForegroundColor DarkGray
    if (Test-Path $mainBak) {
        Copy-Item $mainBak $mainCjs -Force
        Remove-Item $mainBak -Force
        Write-Host "[1/4] 已用 main.cjs.bak 恢复原版 main.cjs" -ForegroundColor Cyan
    } else {
        Write-Host "[1/4] WARNING: 未找到 main.cjs.bak，无法自动还原原版 main.cjs。" -ForegroundColor Yellow
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
    Write-Host "[2/4] 已按 -KeepPlugin 保留插件目录与 profile 残留" -ForegroundColor DarkGray
} else {
    if (Test-Path $PluginDir) {
        Remove-Item $PluginDir -Recurse -Force
        Write-Host "[2/4] 已删除插件目录: $PluginDir" -ForegroundColor Cyan
    } else {
        Write-Host "[2/4] 插件目录不存在，无需删除" -ForegroundColor DarkGray
    }
}

# ---------- 3. 清理 profile 残留（防 Cannot find package 报错） ----------
if ($KeepPlugin) {
    Write-Host "[3/4] 已跳过 profile 清理（-KeepPlugin）" -ForegroundColor DarkGray
} else {
    Write-Host "[3/4] 清理 DSH profile 残留..." -ForegroundColor DarkGray

    $profilesRoot = Join-Path $env:USERPROFILE '.dsh\profiles'
    $webDir = Join-Path $profilesRoot 'web'

    # 3a. profiles\node_modules 里的依赖副本/软链接
    $nmPkg = Join-Path $profilesRoot 'node_modules\dsh-mini-window'
    if (Test-Path $nmPkg) {
        Remove-Item $nmPkg -Recurse -Force
        Write-Host "  已删除 profile 依赖副本: $nmPkg" -ForegroundColor Cyan
    }

    # 3b. cordis.yml / cordis.patch.yml 里的引用条目
    foreach ($cfg in @((Join-Path $webDir 'cordis.yml'), (Join-Path $webDir 'cordis.patch.yml'))) {
        $had = Remove-YamlEntryContaining -Path $cfg -Needle 'dsh-mini-window'
        if ($had) { Write-Host "  已从 $(Split-Path $cfg -Leaf) 移除 dsh-mini-window 引用" -ForegroundColor Cyan }
    }

    # 3c. package.json 里的依赖声明
    Remove-PackageJsonDependency -Path (Join-Path $webDir 'package.json') -PackageName 'dsh-mini-window' | Out-Null
}

# ---------- 4. 完成 ----------
Write-Host "[4/4] 卸载完成！请重启 DeepSeek Harness。" -ForegroundColor Green
Write-Host "  - 桌面壳已恢复原版，悬浮球功能已移除"
Write-Host "  - 插件目录与 profile 残留已清理，不会再报 Cannot find package"
$unpackedDir = Join-Path $resDir 'app.asar.unpacked'
if ($isAsar -and (Test-Path $unpackedDir)) {
    Write-Host "  - 提示: 检测到 app.asar.unpacked 目录。若安装前不存在（可能是安装时打包工具生成的），可手动删除；若不确定请保留。" -ForegroundColor DarkGray
}
