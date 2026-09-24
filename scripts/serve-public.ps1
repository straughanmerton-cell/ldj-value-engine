<#
把本机跑成「临时公网地址」（零注册、零费用）。

做三件事：
  1. 构建前端产物 apps/web/dist
  2. 以生产形态启动 API（同一个端口既出 /api/**，又托管前端产物）
  3. 用 Cloudflare 快速隧道把它映射成一个 https 公网地址并打印出来

注意：快速隧道的域名是随机的、cloudflared 进程退出即失效，关机重启需要重跑本脚本；
要一个固定网址请走 docs/deploy.md 第 1–3 节的 Render + Neon（那条路需要账号本人授权）。
#>

[CmdletBinding()]
param(
  [int]$Port = 4400,
  # 留空则自动取本脚本的上一级目录（仓库根）。Windows PowerShell 5.1 在参数绑定阶段
  # 拿不到 $PSScriptRoot，所以这里只能在函数体里算。
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"
if (-not $RepoRoot) {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
}
Set-Location $RepoRoot

# ---------- 1. 前端产物 ----------
Write-Host "[1/3] 构建前端产物…"
pnpm --filter @ldj/web build | Out-Host

# ---------- 2. 生产形态 API ----------
$logDir = Join-Path $env:TEMP "ldj-dev-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$apiLog = Join-Path $logDir "api-prod.out.log"
$apiErr = Join-Path $logDir "api-prod.err.log"

# 端口已在监听就复用，避免出现「两个进程抢一个端口」
$alreadyListening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($alreadyListening) {
  Write-Host "[2/3] 端口 $Port 已在监听，复用现有进程（如需重启请先结束它）。"
} else {
  Write-Host "[2/3] 以生产形态启动 API（127.0.0.1:$Port）…"
  $env:NODE_ENV = "production"
  $env:SERVE_WEB = "true"
  $env:API_HOST = "127.0.0.1"
  $env:API_PORT = "$Port"
  Start-Process -FilePath "pnpm.cmd" -ArgumentList "--filter", "@ldj/api", "start" `
    -WorkingDirectory $RepoRoot -WindowStyle Hidden `
    -RedirectStandardOutput $apiLog -RedirectStandardError $apiErr | Out-Null
}

Write-Host "      等待 /api/health 就绪…"
$health = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try {
    $health = (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 5).Content
    break
  } catch {
    # 还没起来，继续等
  }
}
if (-not $health) {
  throw "API 未能就绪，请看日志：$apiLog / $apiErr"
}
Write-Host "      本地健康检查通过：$health"

# ---------- 3. 公网地址 ----------
$tunnelDir = Join-Path $env:TEMP "ldj-tunnel"
New-Item -ItemType Directory -Force -Path $tunnelDir | Out-Null
$exe = Join-Path $tunnelDir "cloudflared.exe"
if (-not (Test-Path $exe)) {
  Write-Host "[3/3] 首次运行需下载 cloudflared（约 55 MB）…"
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
    -OutFile $exe -TimeoutSec 300
}

$tunnelOut = Join-Path $tunnelDir "tunnel.out.log"
$tunnelErr = Join-Path $tunnelDir "tunnel.err.log"
$urlPattern = "https://[a-z0-9-]+\.trycloudflare\.com"

function Get-PublicHealth([string]$Base) {
  try {
    return (Invoke-WebRequest -Uri "$Base/api/health" -UseBasicParsing -TimeoutSec 15).Content
  } catch {
    return $null
  }
}

$url = $null
$cloudflaredPid = $null
$remoteHealth = $null

# 已经在为同一个端口跑隧道就复用（日志只在新隧道启动时被覆盖，所以它属于那条在跑的隧道），
# 免得同一个端口挂出两条隧道、给对方一个会随进程一起消失的地址。
$running = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*--url http://127.0.0.1:$Port*" } |
  Select-Object -First 1
if ($running) {
  $match = Select-String -Path $tunnelErr -Pattern $urlPattern -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($match) {
    $candidate = $match.Matches[0].Value
    $probe = Get-PublicHealth $candidate
    if ($probe) {
      $url = $candidate
      $cloudflaredPid = $running.ProcessId
      $remoteHealth = $probe
      Write-Host "[3/3] 已有 cloudflared（PID $cloudflaredPid）在转发本端口，复用其地址。"
    } else {
      Write-Host "[3/3] 已有 cloudflared 在跑，但日志里的那个地址不通，另起一条隧道。"
    }
  }
}

if (-not $url) {
  $cloudflared = Start-Process -FilePath $exe `
    -ArgumentList "tunnel", "--url", "http://127.0.0.1:$Port", "--no-autoupdate" `
    -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -WindowStyle Hidden -PassThru
  $cloudflaredPid = $cloudflared.Id

  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    $match = Select-String -Path $tunnelErr -Pattern $urlPattern -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) {
      $url = $match.Matches[0].Value
      break
    }
  }
}
if (-not $url) {
  throw "未取得公网地址，请看 tunnel 日志：$tunnelErr"
}

# 地址是先打印、后才建连的，所以要等连接真正注册上
for ($i = 0; $i -lt 60; $i++) {
  if (Select-String -Path $tunnelErr -Pattern "Registered tunnel connection" -ErrorAction SilentlyContinue) {
    break
  }
  Start-Sleep -Seconds 1
}

# ---------- 公网侧自检（走真实域名回来，验证隧道链路） ----------
if (-not $remoteHealth) {
  for ($i = 0; $i -lt 30 -and -not $remoteHealth; $i++) {
    $remoteHealth = Get-PublicHealth $url
    if (-not $remoteHealth) {
      Start-Sleep -Seconds 2
    }
  }
}
if (-not $remoteHealth) {
  throw "公网地址已生成但自检不通：$url（隧道日志：$tunnelErr）"
}
$deepLink = (Invoke-WebRequest -Uri "$url/chat" -UseBasicParsing -TimeoutSec 30).StatusCode

Write-Host ""
Write-Host "=========================== 公网地址 ==========================="
Write-Host "  $url"
Write-Host "  健康检查：$remoteHealth"
Write-Host "  深链 /chat：HTTP $deepLink"
Write-Host "==============================================================="
Write-Host ""
Write-Host "说明："
Write-Host "  · 本地址由 cloudflared（PID $cloudflaredPid）转发到本机 $Port，随进程退出而失效。"
Write-Host "  · 关掉 cloudflared 或重启电脑后需要重跑本脚本，公网域名会变。"
Write-Host "  · 想固定域名请走 Render + Neon 方案，见 docs/deploy.md。"
