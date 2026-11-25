# Run from the repository root in a clean Python 3.13 x64 environment.
$ErrorActionPreference = 'Stop'
python -m pip install 'playwright==1.65.2' 'pyinstaller==6.22.3'
if ($LASTEXITCODE) { exit $LASTEXITCODE }
python -m PyInstaller --noconfirm --onedir --additional-hooks-dir obs-koprusu/hooks --windowed --noupx --name obs-bridge --add-data "$((Resolve-Path public).Path);public" --copy-metadata playwright obs-koprusu/windows_obs.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = Join-Path (Resolve-Path dist) ("runtime-" + [guid]::NewGuid() + ".zip")
try {
    [IO.Compression.ZipFile]::CreateFromDirectory((Resolve-Path dist/obs-bridge).Path, $archive)
    $compiler = Join-Path $env:windir 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll "/resource:$archive,runtime.zip" /out:dist\Degerlendirici-OBS-Koprusu.exe obs-koprusu\Launcher.cs
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
}
