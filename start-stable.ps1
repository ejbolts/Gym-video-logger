param(
  [Parameter(Mandatory)][string]$VerifiedCommit,
  [Parameter(Mandatory)][string]$DataRoot,
  [switch]$NoBrowser,
  [string]$PythonExecutable
)

& (Join-Path $PSScriptRoot 'start-app.ps1') -Environment Stable @PSBoundParameters
