Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -Path ".."

Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "scripts\launcher-server.js" -WorkingDirectory (Get-Location)
