$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (!(Test-Path '.venv/Scripts/python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
}
$requirementsHash = (Get-FileHash -Algorithm SHA256 -LiteralPath 'requirements.txt').Hash
$installedHash = if (Test-Path '.venv/requirements.sha256') { Get-Content '.venv/requirements.sha256' -Raw } else { '' }
if ($installedHash.Trim() -ne $requirementsHash) {
    & .venv/Scripts/python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    Set-Content -LiteralPath '.venv/requirements.sha256' -Value $requirementsHash -NoNewline
}
Push-Location frontend
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Write-Host 'Kema workspace: http://127.0.0.1:8000'
& .venv/Scripts/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
exit $LASTEXITCODE
