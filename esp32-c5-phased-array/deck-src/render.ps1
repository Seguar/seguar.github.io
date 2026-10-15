param([string]$Pptx, [string]$OutDir, [string]$Slides = "")
New-Item -ItemType Directory -Force $OutDir | Out-Null
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $pres = $ppt.Presentations.Open($Pptx, -1, 0, 0)
  $sel = @()
  if ($Slides -ne "") { $sel = $Slides.Split(",") | ForEach-Object { [int]$_ } } else { $sel = 1..$pres.Slides.Count }
  foreach ($i in $sel) { $pres.Slides.Item($i).Export("$OutDir\s$i.png", "PNG", 1600, 900) }
  "rendered {0} slides of {1}" -f $sel.Count, $pres.Slides.Count
  $pres.Close()
} catch { "ERR: " + $_.Exception.Message }
$ppt.Quit()
