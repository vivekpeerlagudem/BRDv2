# Open an .xlsx read-only in Microsoft Excel (no window) and print each sheet's name, used size and first cells.
# A damaged workbook makes Workbooks.Open fail (or ask to repair), so a clean run is the "opens without repair" check.
#
#   powershell -ExecutionPolicy Bypass -File scripts/check-xlsx.ps1 -Path <file.xlsx>
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$file = (Resolve-Path $Path).Path
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  # Open(Filename, UpdateLinks = 0, ReadOnly = true)
  $book = $excel.Workbooks.Open($file, 0, $true)
  try {
    foreach ($sheet in $book.Worksheets) {
      $used = $sheet.UsedRange
      $a2 = $sheet.Cells.Item(2, 1).Text
      $b2 = $sheet.Cells.Item(2, 2).Text
      $d2 = $sheet.Cells.Item(2, 4).Text
      Write-Output ("{0}: {1} rows x {2} columns | A1='{3}' | row 2: '{4}' | '{5}' | '{6}'" -f $sheet.Name, $used.Rows.Count, $used.Columns.Count, $sheet.Cells.Item(1, 1).Text, $a2, $b2, $d2)
    }
    Write-Output "sheets: $($book.Worksheets.Count)"
  }
  finally { $book.Close($false) }
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
}
