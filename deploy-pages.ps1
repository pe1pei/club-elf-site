# GitHub Pages（お試し版）へ反映する。
# tools/build-pages.js で書き出した静的ファイルを gh-pages ブランチとして上書き push する。
# 使い方: PowerShell で  .\deploy-pages.ps1
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$out = Join-Path ([System.IO.Path]::GetTempPath()) ("club-elf-pages-" + [guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory $out | Out-Null
node (Join-Path $src 'tools\build-pages.js') $out
if ($LASTEXITCODE -ne 0) { throw 'build-pages.js に失敗しました' }

$remote = git -C $src remote get-url origin
$email = git -C $src config user.email
$name = git -C $src config user.name

Push-Location $out
try {
  git init -q -b gh-pages
  git config user.name $name
  git config user.email $email
  git config core.autocrlf false
  git add -A
  git commit -q -m "Deploy static site"
  git push -f $remote gh-pages
} finally {
  Pop-Location
}
Write-Host "反映しました。1〜2分で https://pe1pei.github.io/club-elf-site/ に出ます。"
