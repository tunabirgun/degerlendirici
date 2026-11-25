# Run from the repository root in a clean Python 3.13 x64 build environment.
$ErrorActionPreference = 'Stop'
$env:PLAYWRIGHT_BROWSERS_PATH = '0'
python -m pip install 'playwright==1.65.2' 'pyinstaller==6.22.3'
if ($LASTEXITCODE) { exit $LASTEXITCODE }
python -m playwright install chromium --no-shell
if ($LASTEXITCODE) { exit $LASTEXITCODE }
python -m PyInstaller --noconfirm --onefile --windowed --noupx --name 'Degerlendirici-OBS-Koprusu' --add-data "$((Resolve-Path public).Path);public" --copy-metadata playwright obs-koprusu/windows_obs.py
exit $LASTEXITCODE
