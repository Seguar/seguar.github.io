# Inline assets/style.css and every js/*.js into one self-contained HTML file.
#
# The multi-file page in this folder IS the published tool (it is served from
# /eband-distribution/ on seguar.github.io, a branch deploy) and needs no build
# step. This script produces dist/index.html, an optional single-file copy for
# opening straight off disk (file:// blocks nothing) or pasting elsewhere, and
# dist/artifact.html, the same page without its document wrapper for an
# artifact host (gitignored, never committed). Both still link the IBM Plex
# fonts from Google Fonts, as index.html does; offline they fall back to the
# system fonts in the --sans/--mono stacks.
#
# Run it from this folder:
#   pwsh ./build-standalone.ps1
# Windows PowerShell 5.1 works too, but where the execution policy refuses
# unsigned local scripts (it does on the machine this is built on) it needs:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\build-standalone.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# NOTE: keep this script pure ASCII. Windows PowerShell 5.1 reads a .ps1 with
# no BOM using the system ANSI codepage, so a non-ASCII character in the source
# of this file gets mangled before it ever runs.
#
# Encoding matters here for the same reason. Get-Content defaults to ANSI for
# files with no BOM, and every source file in this project is UTF-8, all but
# index.html without one, so a bare Get-Content turns U+00D7 (bytes C3 97) into
# two Latin-1 characters and Out-File then re-encodes that mangled pair as
# UTF-8, which is how doubly-encoded text ends up in the bundle. Always read
# with UTF8 (ReadAllText consumes index.html's BOM, so it is not copied into
# the output), and write with a BOM-less UTF8Encoding: Out-File -Encoding utf8
# emits a BOM on 5.1, which would land mid-document inside the artifact
# fragment.
#
# And insert the sources LITERALLY. -replace and Regex.Replace read $&, $1, $$
# and the like in the replacement string as substitution tokens, and the
# sources contain them: glossary.js escapeRe ends in '\\$&', which came out as
# '\\</body>', so dist never marked a glossary term with a regex metacharacter
# in it, L(f) among them.
function Read-Utf8([string]$path) {
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}
function Write-Utf8NoBom([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

$html = Read-Utf8 (Join-Path $root 'index.html')

# --- inline the stylesheet -------------------------------------------------
$css = Read-Utf8 (Join-Path $root 'assets/style.css')
$link = '<link rel="stylesheet" href="assets/style.css">'
$at = $html.IndexOf($link, [System.StringComparison]::Ordinal)
if ($at -lt 0) { throw 'No <link rel="stylesheet" href="assets/style.css"> tag found in index.html' }
$html = $html.Substring(0, $at) + "<style>`n" + $css + "`n</style>" + $html.Substring($at + $link.Length)

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
  [void]$bundle.AppendLine((Read-Utf8 $path))
}

# drop every script tag, then insert the bundle once, just before the last
# </body> (a splice, not a replace: see the note on substitution tokens above)
$html = $rx.Replace($html, { param($m) '' })
$end = $html.LastIndexOf('</body>', [System.StringComparison]::OrdinalIgnoreCase)
if ($end -lt 0) { throw 'No </body> found in index.html' }
$html = $html.Substring(0, $end) + "<script>`n" + $bundle.ToString() + "`n</script>`n" + $html.Substring($end)

$outDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $outDir | Out-Null
$out = Join-Path $outDir 'index.html'
Write-Utf8NoBom $out $html

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
Write-Utf8NoBom $outA $frag.Trim()
$kbA = [Math]::Round((Get-Item $outA).Length / 1024, 1)
Write-Host "Wrote $outA ($kbA KB, artifact-ready fragment)"

# --- guard: never ship doubly-encoded text again ---------------------------
# U+00C3 and U+00E2 are the first characters of the classic UTF-8-read-as-ANSI
# pairs, and neither appears anywhere in this project's real content. Their
# presence means something read a source file as ANSI. Built from code points
# so this check stays ASCII-safe.
$sentinelBad = [string][char]0x00C3 + '|' + [string][char]0x00E2 + '|' + [string][char]0x00C2
$sentinelGood = [char]0x00D7          # multiplication sign, used in the x-M labels
foreach ($f in @($out, $outA)) {
  $t = Read-Utf8 $f
  $bad = [regex]::Matches($t, $sentinelBad)
  if ($bad.Count -gt 0) {
    throw ("Encoding check FAILED for {0}: {1} doubly-encoded sequences. Sources are UTF-8; something read them as ANSI." -f $f, $bad.Count)
  }
  if ($t.IndexOf($sentinelGood) -lt 0) {
    throw ("Encoding check FAILED for {0}: the multiplication sign is missing entirely, so non-ASCII text was lost." -f $f)
  }
}
Write-Host "Encoding check passed: no doubly-encoded text, non-ASCII glyphs intact."
