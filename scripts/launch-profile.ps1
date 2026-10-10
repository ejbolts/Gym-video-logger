function Get-GymLaunchProfile {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [ValidateSet('Stable', 'Verification')][string]$Environment = 'Verification',
    [string]$VerifiedCommit,
    [string]$DataRoot,
    [switch]$Dev
  )

  $root = [IO.Path]::GetFullPath($ProjectRoot)
  if (-not (Test-Path -LiteralPath (Join-Path $root '.git') -PathType Leaf)) {
    throw 'Use a separate Git worktree for this instance; do not launch from the main checkout.'
  }
  $commit = & git -C $root rev-parse --verify HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Could not identify this worktree commit.' }
  $branch = & git -C $root branch --show-current
  if ($LASTEXITCODE -ne 0) { throw 'Could not identify this worktree branch.' }
  $changes = & git -C $root status --porcelain
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the working tree.' }

  if ($Environment -eq 'Stable') {
    if ($Dev) { throw 'Stable mode cannot run a development server.' }
    if (-not $VerifiedCommit -or -not $DataRoot) {
      throw 'Stable mode requires -VerifiedCommit and an explicit -DataRoot.'
    }
    if ($branch) { throw 'Stable mode requires a detached worktree pinned to the verified commit.' }
    $expected = & git -C $root rev-parse --verify "${VerifiedCommit}^{commit}"
    if ($LASTEXITCODE -ne 0 -or $expected -ne $commit) {
      throw 'This worktree does not match the requested verified commit.'
    }
    if ($changes) {
      throw 'Stable mode requires a clean worktree; preserve edits and use another checkout.'
    }
    if (-not [IO.Path]::IsPathRooted($DataRoot)) { throw 'Stable -DataRoot must be an absolute path.' }
    $storage = [IO.Path]::GetFullPath($DataRoot)
    $backendPort = 8000
    $httpsPort = 8446
  }
  else {
    if (-not $branch) { throw 'Verification mode requires a task branch, not a detached stable worktree.' }
    if ($DataRoot) { throw 'Verification storage is fixed to this worktree; do not supply real data.' }
    $storage = Join-Path $root '.runtime\verification-data'
    $backendPort = 8001
    $httpsPort = 8447
  }

  $rolePath = Join-Path $storage '.gym-environment'
  if (Test-Path -LiteralPath $rolePath) {
    if (([IO.File]::ReadAllText($rolePath)).Trim() -ne $Environment) {
      throw 'This data directory belongs to the other environment.'
    }
  }
  $frontendDist = Join-Path $root ("frontend\dist-" + $Environment.ToLowerInvariant())
  $variables = @{
    GYM_DATA_DIR = $storage
    GYM_DATABASE_PATH = (Join-Path $storage 'gym-video-logger.db')
    GYM_WEB_PUSH_VAPID_PRIVATE_KEY_PATH = (Join-Path $storage 'web-push-vapid-private.pem')
    GYM_FRONTEND_DIST_DIR = $frontendDist
    GYM_BACKEND_URL = "http://127.0.0.1:$backendPort"
    GYM_SEED_SAMPLE_DATA = 'false'
  }
  if ($Environment -eq 'Verification') {
    $variables.GYM_YOUTUBE_MOCK_MODE = 'true'
    $variables.GYM_SEED_SAMPLE_DATA = 'true'
    $variables.GYM_YOUTUBE_CLIENT_SECRET_PATH = Join-Path $storage 'secrets\youtube-client-secret.json'
    $variables.GYM_YOUTUBE_TOKEN_PATH = Join-Path $storage 'secrets\youtube-token.json'
  }
  [PSCustomObject]@{
    Environment = $Environment
    ProjectRoot = $root
    Commit = $commit
    Branch = $branch
    HasUncommittedChanges = [bool]$changes
    DataRoot = $storage
    BackendPort = $backendPort
    FrontendPort = 5175
    HttpsPort = $httpsPort
    FrontendDist = $frontendDist
    Variables = $variables
    RolePath = $rolePath
    LogRoot = (Join-Path $root ('.runtime\' + $Environment.ToLowerInvariant() + '\logs'))
  }
}
