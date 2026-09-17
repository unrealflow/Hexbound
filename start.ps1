# Hexbound 一键启动（Windows / pwsh）
# 与 npm start 共用同一实现：scripts/start.mjs
# 用法: .\start.ps1 [-Port 5173] [--no-open]
param(
    [int]$Port = 5173,
    [switch]$NoOpen,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '[错误] 未找到 node，请先安装 Node.js (https://nodejs.org)' -ForegroundColor Red
    exit 1
}

$args = @('scripts/start.mjs', '--port', "$Port")
if ($NoOpen) { $args += '--no-open' }
if ($Rest) { $args += $Rest }

node @args
exit $LASTEXITCODE
