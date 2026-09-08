# Inline assets/style.css and every js/*.js into one self-contained HTML file.
#
# The multi-file site in the repo root IS the GitHub Pages site and needs no
# build step. This script only produces dist/index.html, a single-file copy for
# opening straight off disk (file:// blocks nothing) or pasting elsewhere.
#
#   pwsh ./build-standalone.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$html = Get-Content (Join-Path $root 'index.html') -Raw

# --- inline the stylesheet -------------------------------------------------
$css = Get-Content (Join-Path $root 'assets/style.css') -Raw
$html = $html -replace '<link rel="stylesheet" href="assets/style\.css">', ("<style>`n" + $css + "`n</style>")

# --- inline the scripts, in document order --------------------------------
$rx = [regex]'<script src="js/([^"]+)"></script>'
$matches = $rx.Matches($html)
if ($matches.Count -eq 0) { throw 'No <script src="js/..."> tags found in index.html' }

$bundle = New-Object System.Text.StringBuilder
foreach ($m in $matches) {
  $name = $m.Groups[1].Value
  $path = Join-Path $root (Join-Path 'js' $name)
  if (-not (Test-Path $path)) { throw "Missing script: $path" }
  [void]$bundle.AppendLine("/* ===== js/$name ===== */")
  [void]$bundle.AppendLine((Get-Content $path -Raw))
}

# replace the first script tag with the bundle, drop the rest
$html = $rx.Replace($html, { param($m) '' })
$html = $html -replace '(?s)</body>', ("<script>`n" + $bundle.ToString() + "`n</script>`n</body>")

$outDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $outDir | Out-Null
$out = Join-Path $outDir 'index.html'
$html | Out-File -Encoding utf8 $out

$kb = [Math]::Round((Get-Item $out).Length / 1024, 1)
Write-Host "Wrote $out  ($kb KB, $($matches.Count) scripts inlined)"

# --- artifact variant -----------------------------------------------------
# The Artifact host supplies <!doctype>/<html>/<head>/<body>, so strip our own
# document wrapper and emit only the page content.
$frag = $html
$frag = [regex]::Replace($frag, '(?is)^.*?<head[^>]*>', '')
$frag = [regex]::Replace($frag, '(?is)</head>\s*<body[^>]*>', "`n")
$frag = [regex]::Replace($frag, '(?is)</body>\s*</html>\s*$', '')
# these are supplied by the host
$frag = [regex]::Replace($frag, '(?i)<meta charset[^>]*>', '')
$frag = [regex]::Replace($frag, '(?i)<meta name="viewport"[^>]*>', '')

$outA = Join-Path $outDir 'artifact.html'
$frag.Trim() | Out-File -Encoding utf8 $outA
$kbA = [Math]::Round((Get-Item $outA).Length / 1024, 1)
Write-Host "Wrote $outA ($kbA KB, artifact-ready fragment)"
