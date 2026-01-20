Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$iconPath = Join-Path $root "src-tauri\\icons\\icon.ico"

$notify = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $iconPath) {
    $notify.Icon = New-Object System.Drawing.Icon($iconPath)
}
$notify.Text = "Admin Dashboard"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$restartItem = $menu.Items.Add("Restart Server")
$quitItem = $menu.Items.Add("Quit")
$notify.ContextMenuStrip = $menu

$serverProcess = $null

function Start-Server {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        return
    }
    $serverProcess = Start-Process -FilePath "node" `
        -ArgumentList "server/index.js" `
        -WorkingDirectory $root `
        -PassThru
}

function Stop-Server {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        $serverProcess.Kill()
        $serverProcess.WaitForExit()
    }
}

$restartItem.Add_Click({
    Stop-Server
    Start-Server
})

$quitItem.Add_Click({
    Stop-Server
    $notify.Visible = $false
    $notify.Dispose()
    $context.ExitThread()
})

$notify.Add_DoubleClick({
    Start-Process "http://localhost:5173"
})

Start-Server

$context = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($context)
