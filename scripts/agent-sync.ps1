param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [Parameter(Mandatory = $true)]
    [string]$Branch
)

$ErrorActionPreference = "Stop"

function Invoke-GitStep {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,

        [Parameter(Mandatory = $true)]
        [string[]]$Args
    )

    & git @Args
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed."
    }
}

$startedAt = Get-Date

try {
    if (-not (Test-Path $RepoPath)) {
        throw "RepoPath does not exist: $RepoPath"
    }

    Push-Location $RepoPath

    Invoke-GitStep -Label "git fetch --all --prune" -Args @("fetch", "--all", "--prune")
    Invoke-GitStep -Label "git checkout $Branch" -Args @("checkout", $Branch)
    Invoke-GitStep -Label "git pull --rebase origin $Branch" -Args @("pull", "--rebase", "origin", $Branch)

    $sha = (git rev-parse --short HEAD).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "git rev-parse --short HEAD failed."
    }

    $elapsed = [int]((Get-Date) - $startedAt).TotalSeconds
    Write-Host "[agent-sync] OK repo=$RepoPath branch=$Branch head=$sha elapsed=${elapsed}s"
}
catch {
    $elapsed = [int]((Get-Date) - $startedAt).TotalSeconds
    Write-Error "[agent-sync] FAIL repo=$RepoPath branch=$Branch elapsed=${elapsed}s error=$($_.Exception.Message)"
    exit 1
}
finally {
    Pop-Location
}
