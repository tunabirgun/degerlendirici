#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
python -m PyInstaller --noconfirm --onedir --additional-hooks-dir obs-koprusu/hooks --noupx --name obs-bridge --add-data "public:public" --copy-metadata playwright obs-koprusu/macos_obs.py
app="dist/Değerlendirici OBS Köprüsü.app"
osacompile -o "$app" obs-koprusu/launcher.applescript
mv dist/obs-bridge "$app/Contents/Resources/runtime"
plist="$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.tunabirgun.degerlendirici.obs" "$plist" || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.tunabirgun.degerlendirici.obs" "$plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes array' -c 'Add :CFBundleURLTypes:0 dict' -c 'Add :CFBundleURLTypes:0:CFBundleURLName string OBS' -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string degerlendirici-obs' "$plist"
codesign --force --sign - "$app"
codesign --verify "$app"
ditto -c -k --keepParent "$app" "dist/Degerlendirici-OBS-macOS-$(uname -m).zip"
