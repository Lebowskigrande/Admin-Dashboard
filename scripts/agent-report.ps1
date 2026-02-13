param(
    [Parameter(Mandatory = $true)]
    [string]$Agent,

    [Parameter(Mandatory = $true)]
    [string[]]$Tickets,

    [Parameter(Mandatory = $true)]
    [string]$Branch,

    [Parameter(Mandatory = $true)]
    [string]$Head,

    [Parameter(Mandatory = $true)]
    [string[]]$Checks,

    [Parameter()]
    [string[]]$Notes = @()
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$reportDir = Join-Path $root "agent-reports"
$timestamp = Get-Date -Format "yyyyMMdd-HHmm"
$agentSlug = $Agent.ToLowerInvariant()
$outputPath = Join-Path $reportDir ("agent-{0}-{1}.md" -f $agentSlug, $timestamp)

if (-not (Test-Path $reportDir)) {
    New-Item -ItemType Directory -Path $reportDir | Out-Null
}

$ticketLines = @()
foreach ($ticket in $Tickets) {
    $ticketLines += "- $ticket"
}

$checkLines = @()
foreach ($check in $Checks) {
    $checkLines += "- $check"
}

$noteLines = @()
if ($Notes.Count -gt 0) {
    foreach ($note in $Notes) {
        $noteLines += "- $note"
    }
}
else {
    $noteLines += "- none"
}

$content = @(
    "# Agent Report: $Agent",
    "",
    "## Summary",
    "- Agent: `$Agent`",
    "- Branch: `$Branch`",
    "- Head: `$Head`",
    "- Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")",
    "",
    "## Tickets",
    $ticketLines,
    "",
    "## Checks",
    $checkLines,
    "",
    "## Notes",
    $noteLines
) -join [Environment]::NewLine

Set-Content -Path $outputPath -Value $content -Encoding UTF8
Write-Host "[agent-report] OK path=$outputPath"
