#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

Write-Host "Scanning for private key patterns..."

# Get tracked files, exclude node_modules
$trackedFiles = git ls-files | Where-Object { $_ -notmatch "node_modules" }

$found = @()
foreach ($file in $trackedFiles) {
  if (-not (Test-Path $file)) { continue }
  $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
  if ($null -eq $content) { continue }
  if ($file -match '\.env$|secrets\.yaml$|\.example$') { continue }
  if ($content -match '0x[0-9a-fA-F]{64}') {
    $found += $file
  }
}

if ($found.Count -gt 0) {
  Write-Host "ERROR: Found potential private keys in tracked files:"
  $found | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Write-Host "Scanning for PRIVATE_KEY assignments..."
$foundPk = @()
foreach ($file in $trackedFiles) {
  if (-not (Test-Path $file)) { continue }
  $content = Get-Content $file -Raw -ErrorAction SilentlyContinue
  if ($null -eq $content) { continue }
  if ($file -match '\.env\.example$|secrets\.yaml$') { continue }
  # Look for PRIVATE_KEY= followed by actual value (not just pattern chars in docs)
  if ($content -match 'PRIVATE_KEY\s*=\s*[0-9a-fA-FxX]') {
    $foundPk += $file
  }
}

if ($foundPk.Count -gt 0) {
  Write-Host "ERROR: Found PRIVATE_KEY assignments in tracked files:"
  $foundPk | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Write-Host "✓ No secrets found in tracked files"
exit 0
