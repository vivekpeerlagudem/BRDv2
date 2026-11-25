# Export every slide of a .pptx to PNG with Microsoft PowerPoint (COM), for a visual check of weekly report decks.
#
#   powershell -ExecutionPolicy Bypass -File scripts/export-slides.ps1 -Path <deck.pptx> [-OutDir <folder>] [-Prefix slide]
#
# Opens the file read-only without a window. PowerPoint opening the file without a repair prompt is part of the check:
# a damaged file makes Presentations.Open fail here.
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$OutDir,
  [string]$Prefix = 'slide'
)
$ErrorActionPreference = 'Stop'
$file = (Resolve-Path $Path).Path
if (-not $OutDir) { $OutDir = Split-Path -Parent $file }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$out = (Resolve-Path $OutDir).Path

$app = New-Object -ComObject PowerPoint.Application
try {
  # Open(FileName, ReadOnly = true, Untitled = false, WithWindow = false)
  $deck = $app.Presentations.Open($file, -1, 0, 0)
  try {
    $count = $deck.Slides.Count
    for ($i = 1; $i -le $count; $i++) {
      $png = Join-Path $out "$Prefix-$i.png"
      $deck.Slides.Item($i).Export($png, 'PNG', 1920, 1080)
      Write-Output "exported $png"
    }
    Write-Output "slides: $count"
  }
  finally { $deck.Close() }
}
finally {
  $app.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
