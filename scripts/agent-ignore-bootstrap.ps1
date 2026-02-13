param(
    [Parameter()]
    [string[]]$WorktreePaths
)

$ErrorActionPreference = "Stop"

if (-not $WorktreePaths -or $WorktreePaths.Count -eq 0) {
    $base = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $WorktreePaths = @(
        (Join-Path $base "AdminDashboard-A"),
        (Join-Path $base "AdminDashboard-B"),
        (Join-Path $base "AdminDashboard-C"),
        (Join-Path $base "AdminDashboard-D"),
        (Join-Path $base "AdminDashboard-E"),
        (Join-Path $base "AdminDashboard-F"),
        (Join-Path $base "AdminDashboard-G")
    )
}

$success = 0
$skipped = 0
$failed = 0

foreach ($path in $WorktreePaths) {
    try {
        $excludePath = Join-Path $path ".git\info\exclude"

        if (-not (Test-Path $excludePath)) {
            Write-Host "[agent-ignore-bootstrap] skip path=$path reason=missing-exclude"
            $skipped++
            continue
        }

        $existing = Get-Content $excludePath -ErrorAction Stop
        if ($existing -contains "AGENT_INSTRUCTIONS.md") {
            Write-Host "[agent-ignore-bootstrap] ok path=$path status=already-present"
            $success++
            continue
        }

        Add-Content -Path $excludePath -Value "AGENT_INSTRUCTIONS.md"
        Write-Host "[agent-ignore-bootstrap] ok path=$path status=added"
        $success++
    }
    catch {
        Write-Host "[agent-ignore-bootstrap] fail path=$path error=$($_.Exception.Message)"
        $failed++
    }
}

Write-Host "[agent-ignore-bootstrap] summary success=$success skipped=$skipped failed=$failed total=$($WorktreePaths.Count)"
if ($failed -gt 0) {
    exit 1
}
