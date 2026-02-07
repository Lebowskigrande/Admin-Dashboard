$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Start-Sleep -Seconds 1
$pattern = [Regex]::Escape($root) + '\\server\\index.js'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 1

Start-Process -FilePath "node" -ArgumentList "scripts\\start-server.js" -WorkingDirectory $root -WindowStyle Hidden
Start-Process -FilePath "node" -ArgumentList "node_modules\\vite\\bin\\vite.js" -WorkingDirectory $root -WindowStyle Hidden
