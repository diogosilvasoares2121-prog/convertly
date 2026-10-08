# Generates archive test fixtures that cannot be produced from Node:
#  - sample.7z, sample.tar.bz2, sample.tar.xz, sample.iso with Windows' built-in bsdtar (libarchive)
#  - sample.rar (RAR4), sample-rar5.rar, encrypted.rar decoded from libarchive's own BSD-licensed
#    test archives (https://github.com/libarchive/libarchive/tree/v3.7.4/libarchive/test)
# Usage (Windows): powershell -ExecutionPolicy Bypass -File scripts/make-archives.ps1
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$out = Join-Path $root 'test-fixtures'
$work = Join-Path $env:TEMP 'convertly-archives'
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $work 'docs\nested') | Out-Null
Set-Content -Encoding ascii (Join-Path $work 'readme.txt') 'Convertly archive fixture'
Set-Content -Encoding ascii (Join-Path $work 'docs\notes.md') '# Notes'
Set-Content -Encoding ascii (Join-Path $work 'docs\nested\data.json') '{"ok":true}'
Copy-Item (Join-Path $out 'sample.png') (Join-Path $work 'image.png')

Push-Location $work
try {
  & tar.exe --format 7zip -cf (Join-Path $out 'sample.7z') readme.txt docs image.png
  & tar.exe -cjf (Join-Path $out 'sample.tar.bz2') readme.txt docs image.png
  & tar.exe -czf (Join-Path $out 'sample.tar.gz') readme.txt docs
  & node -e "require('fs').writeFileSync(process.argv[1], require('zlib').gzipSync(require('fs').readFileSync(process.argv[2])))" (Join-Path $out 'notes.txt.gz') (Join-Path $out 'sample.txt')
  & tar.exe -cJf (Join-Path $out 'sample.tar.xz') readme.txt docs image.png
  & tar.exe --format iso9660 -cf (Join-Path $out 'sample.iso') readme.txt docs
  # AES-256 encrypted ZIP, password "secret"
  & tar.exe --format zip --options zip:encryption=aes256 --passphrase secret -cf (Join-Path $out 'encrypted.zip') readme.txt docs
} finally {
  Pop-Location
}

$base = 'https://raw.githubusercontent.com/libarchive/libarchive/v3.7.4/libarchive/test'
$rars = @{ 'test_read_format_rar.rar.uu' = 'sample.rar'; 'test_read_format_rar5_compressed.rar.uu' = 'sample-rar5.rar'; 'test_read_format_rar_encryption_data.rar.uu' = 'encrypted.rar' }
foreach ($name in $rars.Keys) {
  $uu = Join-Path $work $name
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $uu
  & node (Join-Path $root 'scripts\uudecode.mjs') $uu (Join-Path $out $rars[$name])
}
Write-Output 'archive fixtures written'
