param(
  [Parameter(Mandatory=$true)][string]$DocPath,
  [Parameter(Mandatory=$true)][string]$PrinterName
)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0  # wdAlertsNone

try {
  # Open invisibly, read-only
  $doc = $word.Documents.Open($DocPath, $false, $true)

  # Target your dedicated logical printer
  $word.ActivePrinter = $PrinterName

  # Print using the printer instance defaults (booklet/saddle stitch live there)
  $doc.PrintOut()

  # Close without saving
  $doc.Close([ref]0)  # wdDoNotSaveChanges
}
finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
