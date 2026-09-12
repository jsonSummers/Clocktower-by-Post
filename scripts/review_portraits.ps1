<#
.SYNOPSIS
    Regenerate every painted character portrait and composite them into one
    labelled grid at design/portraits-review.png.

.DESCRIPTION
    PowerShell equivalent of review_portraits.sh, for running straight from
    a Windows PowerShell prompt with no bash/WSL required. Requires Python
    with pillow/numpy/scipy installed (the same ones scripts/stained_glass.py
    needs). Any arguments you pass are forwarded straight through to
    review_portraits.py — see `python scripts/review_portraits.py --help`
    for the full list.

.EXAMPLE
    ./scripts/review_portraits.ps1

.EXAMPLE
    ./scripts/review_portraits.ps1 --strength strong --backlight-warmth 0.5

.EXAMPLE
    ./scripts/review_portraits.ps1 --team demon --team minion
#>

$ErrorActionPreference = 'Stop'

# Repo root is the parent of this script's own folder, regardless of where
# you're currently cd'd when you run it.
Set-Location (Join-Path $PSScriptRoot '..')

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $py) {
    Write-Error "Python not found on PATH (tried 'python' and 'python3'). Install Python 3, or make sure it's on PATH."
    exit 1
}

& $py.Source "scripts/review_portraits.py" @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$out = "design/portraits-review.png"
if (Test-Path $out) {
    # Opens with whatever's associated with .png (Photos, etc.) — same idea
    # as the bash version's explorer.exe/open/xdg-open fallback chain.
    Invoke-Item $out
}
