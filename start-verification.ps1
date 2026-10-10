param([switch]$NoBrowser, [switch]$Dev, [string]$PythonExecutable)

& (Join-Path $PSScriptRoot 'start-app.ps1') -Environment Verification @PSBoundParameters
