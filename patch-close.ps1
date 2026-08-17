# ============================================================
# 小鲸球补丁：关闭主窗口时整个应用一起退出
# 修复现象：从任务栏关闭 DeepSeek Harness 后悬浮球残留，
#           且点击悬浮球无法重新打开窗口。
# 用法：以管理员身份运行 PowerShell，然后执行本脚本：
#   powershell -ExecutionPolicy Bypass -File "本文件路径"
# 已打过补丁时重复运行是安全的（会自动跳过）。
# ============================================================
param(
    # 桌面壳主进程文件位置（一般不需要改）
    [string]$MainCjs = "D:\deepseek\DeepSeek Harness\resources\app\main.cjs"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $MainCjs)) {
    Write-Host "找不到文件: $MainCjs" -ForegroundColor Red
    Write-Host "请检查 DeepSeek Harness 的安装位置，或用 -MainCjs 参数指定。" -ForegroundColor Yellow
    exit 1
}

# 用 UTF-8 无 BOM 读写，保持与原文件一致
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText($MainCjs, [System.Text.Encoding]::UTF8)

$old = "window.on('closed', () => { window = null })"
$new = "window.on('closed', () => { window = null; app.quit() })"

try {
    if ($content.Contains($new)) {
        Write-Host "已打过补丁，无需重复操作。" -ForegroundColor Yellow
    }
    elseif ($content.Contains($old)) {
        $content = $content.Replace($old, $new)
        [System.IO.File]::WriteAllText($MainCjs, $content, $utf8NoBom)
        Write-Host "补丁已应用：现在关闭主窗口会连同悬浮球一起退出。" -ForegroundColor Green
    }
    else {
        Write-Host "未找到预期的代码，可能版本不同。请不要继续，把 main.cjs 里"
        Write-Host "  window.on('closed' 附近的内容发给我看看。" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "写入失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "请右键 PowerShell 选择“以管理员身份运行”后再试一次。" -ForegroundColor Yellow
    exit 1
}
