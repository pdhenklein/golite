# Publica uma nova versão do GoLite no GitHub.
# Uso:   .\publish.ps1 -Version 1.1.0 -Notes "O que mudou"
# 1ª vez (gera também o pacote completo p/ novos usuários):   .\publish.ps1 -Version 1.0.0 -Full
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Notes = "",
  [switch]$Full
)

$ErrorActionPreference = 'Stop'
$appDir  = $PSScriptRoot
$rootDir = Split-Path (Split-Path $appDir)          # pasta do GoLite.exe
$Version = $Version.TrimStart('v')
$tag     = "v$Version"
$work    = Join-Path $env:TEMP "golite-release"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI (gh) não encontrado. Instale: winget install GitHub.cli" }
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { throw "Você não está logado no gh. Rode: gh auth login" }

Write-Host "[1/5] Atualizando versão para $Version..." -ForegroundColor Cyan
$pkgPath = Join-Path $appDir 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$pkg.version = $Version
[IO.File]::WriteAllText($pkgPath, ($pkg | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))

Write-Host "[2/5] Gerando app.zip (somente o código do app)..." -ForegroundColor Cyan
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
$stage = Join-Path $work 'app'
robocopy $appDir $stage /E /XD .git /XF publish.ps1 README.md LICENSE .gitignore golite_debug.log | Out-Null
$appZip = Join-Path $work 'app.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $appZip -Force
$assets = @($appZip)

if ($Full) {
  Write-Host "[2b/5] Gerando pacote completo (primeira instalação, ~200 MB)..." -ForegroundColor Cyan
  $fullStage = Join-Path $work 'GoLite'
  robocopy $rootDir $fullStage /E /XD .git /XF golite_debug.log | Out-Null
  $fullZip = Join-Path $work 'GoLite-Windows.zip'
  Compress-Archive -Path $fullStage -DestinationPath $fullZip -Force
  $assets += $fullZip
}

Write-Host "[3/5] Commit + tag..." -ForegroundColor Cyan
Push-Location $appDir
git add -A
git commit -m "Release $tag" --allow-empty
git tag -f $tag

Write-Host "[4/5] Enviando para o GitHub..." -ForegroundColor Cyan
git push origin HEAD
git push origin $tag --force

Write-Host "[5/5] Criando Release $tag..." -ForegroundColor Cyan
if (-not $Notes) { $Notes = "GoLite $tag" }
gh release create $tag @assets --title "GoLite $tag" --notes $Notes
Pop-Location

Write-Host "Pronto! Quem já tem o app verá o botão 'Instalar $tag'." -ForegroundColor Green
