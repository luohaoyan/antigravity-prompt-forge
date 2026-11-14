# Antigravity Prompt Forge - 一键部署 / 全自动部署
# 用法（普通用户）：右键 -> 使用 PowerShell 运行
# 用法（无人值守）：powershell -NoProfile -ExecutionPolicy Bypass -File .\oneclick.ps1 -Auto
#   -Auto        全自动：不询问、自动装 Node、自动冻结更新、自动启动
#   -NoLaunch    不启动反重力
#   -PluginOnly  只装 .gemini 插件，不改 app.asar
#   -SkipBackup  跳过对话存档备份（不推荐）
#   -ZipPath     指定 zip 包，脚本会自行解压
param(
  [string]$ZipPath = "",
  [switch]$Auto,
  [switch]$NoLaunch,
  [switch]$PluginOnly,
  [switch]$SkipBackup
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Say($m, $c = "Gray") { Write-Host $m -ForegroundColor $c }
function Fail($m) { Say ("[FAIL] " + $m) "Red"; if (-not $Auto) { Read-Host "按回车退出" }; exit 1 }
function Step($n, $m) { Say ("[" + $n + "/8] " + $m) "Cyan" }

# ---- 0. 清宿主注入变量（否则 Electron 以纯 Node 模式秒退）----
foreach ($v in @("ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE", "NODE_OPTIONS")) {
  Remove-Item ("Env:" + $v) -ErrorAction SilentlyContinue
  Set-Item ("Env:" + $v) "" -ErrorAction SilentlyContinue
}

Say "==========================================================" "Cyan"
Say "  Antigravity Prompt Forge - 一键部署" "Cyan"
Say "==========================================================" "Cyan"

# ---- 1. 定位仓库根 ----
$root = $PSScriptRoot
if (-not (Test-Path (Join-Path $root "installer\install.mjs"))) {
  $found = Get-ChildItem -Path $PWD.Path, $env:TEMP, "$env:USERPROFILE\Downloads" -Filter "install.mjs" -Recurse -Depth 4 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $root = Split-Path (Split-Path $found.FullName -Parent) -Parent }
  else { Fail "找不到 installer\install.mjs，请在解压后的仓库根目录运行本脚本。" }
}
Step 1 ("仓库根: " + $root)

# ---- 2. 解压 zip（可选）----
if ($ZipPath) {
  if (-not (Test-Path $ZipPath)) { Fail ("zip 不存在: " + $ZipPath) }
  $dest = Join-Path $env:TEMP ("ag-forge-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $dest -Force
  $inner = Get-ChildItem $dest -Directory | Select-Object -First 1
  if (Test-Path (Join-Path $inner.FullName "installer\install.mjs")) { $root = $inner.FullName }
  Step 2 ("已解压: " + $root)
} else { Step 2 "使用现有目录（未指定 -ZipPath）" }

# ---- 3. Node.js：检测 → 自动安装 ----
function Get-NodePath {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}
$nodeExe = Get-NodePath
if (-not $nodeExe) {
  Say "[!] 未检测到 Node.js，尝试自动安装..." "Yellow"
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $wargs = @("install", "--id", "OpenJS.NodeJS.LTS", "-e", "--accept-source-agreements", "--accept-package-agreements", "--silent")
    if ($Auto) { $wargs += "--disable-interactivity" }
    try { & winget @wargs | Out-Host } catch { Say ("winget 安装失败: " + $_.Exception.Message) "Yellow" }
  } else {
    Say "[!] 没有 winget。请手动安装 Node.js LTS: https://nodejs.org/" "Yellow"
    if (-not $Auto) { Start-Process "https://nodejs.org/"; Read-Host "装完按回车继续" }
  }
  $nodeExe = Get-NodePath
}
if (-not $nodeExe) { Fail "Node.js 仍不可用。装好 LTS（>=18）后重新运行本脚本。" }
$env:Path = (Split-Path $nodeExe -Parent) + ";" + $env:Path
$nodeVer = (& $nodeExe -v).Trim()
Step 3 ("Node.js " + $nodeVer + "  " + $nodeExe)

# ---- 4. 反重力安装路径检测 ----
$ag = $null
foreach ($p in @("$env:LOCALAPPDATA\Programs\antigravity", "$env:ProgramFiles\Antigravity", "${env:ProgramFiles(x86)}\Antigravity")) {
  if ((Test-Path (Join-Path $p "Antigravity.exe")) -and (Test-Path (Join-Path $p "resources\app.asar"))) { $ag = $p; break }
}
if ($ag) { Step 4 ("反重力: " + $ag) } else {
  Say "[!] 未找到 Antigravity 安装目录（可能装在非标准位置）。" "Yellow"
  Say "    可继续只装插件，或手动指定 --asar 路径做注入。" "Yellow"
  if ($PluginOnly -eq $false) { $PluginOnly = $true }
  Step 4 "未检测到反重力，降级为只装插件"
}

# ---- 5. 依赖预装 ----
$dep = Join-Path $root "installer\node_modules\@electron\asar"
if (-not $PluginOnly -and -not (Test-Path $dep)) {
  Step 5 "安装 @electron/asar（首次 10-30 秒）..."
  Push-Location (Join-Path $root "installer")
  try { & npm install --no-audit --no-fund --loglevel=error 2>&1 | Out-Host } catch { Say "[WARN] npm install 失败，稍后回退 npx 模式" "Yellow" }
  Pop-Location
} else { Step 5 "依赖检查完成" }

# ---- 6. 备份对话存档（只读复制，绝不删除）----
$agHome = Join-Path $env:USERPROFILE ".gemini\antigravity"
if ($SkipBackup) { Step 6 "已跳过存档备份（-SkipBackup）" }
elseif (Test-Path $agHome) {
  $bk = Join-Path $env:USERPROFILE ("Documents\Antigravity_Backup\auto_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
  New-Item -ItemType Directory -Force -Path $bk | Out-Null
  foreach ($sub in @("conversations", "brain", "annotations")) {
    $src = Join-Path $agHome $sub
    if (Test-Path $src) { Copy-Item $src -Destination (Join-Path $bk $sub) -Recurse -Force -ErrorAction SilentlyContinue }
  }
  Step 6 ("对话存档已备份: " + $bk)
} else { Step 6 "未发现存档目录（首次安装可忽略）" }

# ---- 7. 注入 + 插件 ----
Step 7 "体检 + 注入 app.asar + 安装插件"
& $nodeExe (Join-Path $root "installer\install.mjs") "--check" 2>&1 | Out-Host
$ia = @((Join-Path $root "installer\install.mjs"))
if ($PluginOnly) { $ia += "--plugin-only" }
& $nodeExe @ia 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "安装器返回失败，请把上面的输出贴给维护者。" }

# ---- 8. 冻结更新 + 启动 + 自检 ----
Step 8 "冻结自动更新 / 启动反重力"
& $nodeExe (Join-Path $root "installer\install.mjs") "--freeze-update" 2>&1 | Out-Host

if (-not $NoLaunch -and $ag) {
  Get-Process Antigravity -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
  $env2 = @{}
  foreach ($k in $env:Path) { }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Join-Path $ag "Antigravity.exe")
  $psi.UseShellExecute = $true
  [System.Diagnostics.Process]::Start($psi) | Out-Null
  Say "  已启动反重力，等待 12 秒做自检..." "Gray"
  Start-Sleep -Seconds 12
  $procs = @(Get-Process Antigravity -ErrorAction SilentlyContinue)
  if ($procs.Count -gt 0) { Say ("  [OK] 反重力进程 " + $procs.Count + " 个") "Green" }
  else { Say "  [FAIL] 反重力没起来 —— 跑 doctor.bat，或 rollback.bat 回滚" "Red" }
}

Say ""
Say "==========================================================" "Green"
Say "  完成：看输入框右下角是否有 [增强] 按钮" "Green"
Say "  没有 -> doctor.bat 体检；回滚 -> rollback.bat" "Green"
Say "==========================================================" "Green"
if (-not $Auto) { Read-Host "按回车退出" }
