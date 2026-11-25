# Open a .docx read-only in Microsoft Word (no window) and export it to PDF next to it. Prints the page count.
# A damaged file makes Documents.Open fail (or ask to repair), so a clean run is also the "opens without repair" check.
#
#   powershell -ExecutionPolicy Bypass -File scripts/export-docx-pdf.ps1 -Path deliverables\<file>.docx
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$file = (Resolve-Path $Path).Path
$pdf = [System.IO.Path]::ChangeExtension($file, '.pdf')
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  # Open(FileName, ConfirmConversions = false, ReadOnly = true, AddToRecentFiles = false, ..., OpenAndRepair = false)
  $doc = $word.Documents.Open($file, $false, $true, $false, '', '', $false, '', '', 0, 0, $false, $false)
  try {
    $pages = $doc.ComputeStatistics(2)
    $doc.ExportAsFixedFormat($pdf, 17)
    Write-Output "pages: $pages"
    Write-Output "pdf: $pdf"
  }
  finally { $doc.Close(0) }
}
finally {
  $word.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
