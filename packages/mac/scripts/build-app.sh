#!/usr/bin/env bash
# Builds things3pp.app (universal), signs it, and optionally notarizes it and makes a DMG.
#
#   scripts/build-app.sh                  # ad-hoc signed app in dist/ (local testing)
#   SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" \
#   NOTARY_PROFILE=things3pp scripts/build-app.sh --dmg
#
# NOTARY_PROFILE is a notarytool keychain profile: xcrun notarytool store-credentials things3pp ...
# THINGS3PP_SERVER sets the default server the app signs in to.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VERSION="$(node -p "require('../cli/package.json').version" 2>/dev/null || echo 0.0.0)"
SERVER="${THINGS3PP_SERVER:-https://things.paulashraf.com}"
APP="$ROOT/dist/things3pp.app"
MAKE_DMG=0
[[ "${1:-}" == "--dmg" ]] && MAKE_DMG=1

echo "▸ Building things3pp $VERSION (universal)"
swift build -c release --arch arm64 --arch x86_64 >/dev/null
BIN="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/Things3pp"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Things3pp"
cp ../core/src/things/things.jxa.js ../core/src/things/move.applescript "$APP/Contents/Resources/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.things3pp.app</string>
  <key>CFBundleName</key><string>things3pp</string>
  <key>CFBundleDisplayName</key><string>things3pp</string>
  <key>CFBundleExecutable</key><string>Things3pp</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSAppleEventsUsageDescription</key><string>things3pp sends the changes you make on the web to Things.</string>
  <key>NSHumanReadableCopyright</key><string>MIT License. Not affiliated with Cultured Code.</string>
  <key>Things3ppServerURL</key><string>$SERVER</string>
</dict>
</plist>
PLIST

# App icon from the web app's SVG (our own icon, not Cultured Code's).
ICONSET="$ROOT/dist/AppIcon.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
TMP_PNG="$ROOT/dist/icon-1024.png"
if [[ ! -f "$ROOT/Resources/AppIcon-1024.png" ]]; then
  qlmanage -t -s 1024 -o "$ROOT/dist" ../cloud/public/icon.svg >/dev/null 2>&1 && mv "$ROOT/dist/icon.svg.png" "$TMP_PNG"
else
  cp "$ROOT/Resources/AppIcon-1024.png" "$TMP_PNG"
fi
if [[ -f "$TMP_PNG" ]]; then
  for s in 16 32 128 256 512; do
    sips -z $s $s "$TMP_PNG" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$TMP_PNG" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
fi
rm -rf "$ICONSET" "$TMP_PNG"

if [[ -n "${SIGN_IDENTITY:-}" ]]; then
  echo "▸ Signing with $SIGN_IDENTITY"
  codesign --force --options runtime --timestamp --entitlements Things3pp.entitlements --sign "$SIGN_IDENTITY" "$APP"
else
  echo "▸ Ad-hoc signing (set SIGN_IDENTITY to sign for distribution)"
  codesign --force --options runtime --entitlements Things3pp.entitlements --sign - "$APP"
fi
codesign --verify --strict "$APP"

if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  echo "▸ Notarizing"
  ditto -c -k --keepParent "$APP" "$ROOT/dist/things3pp.zip"
  xcrun notarytool submit "$ROOT/dist/things3pp.zip" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP"
  rm -f "$ROOT/dist/things3pp.zip"
fi

if [[ $MAKE_DMG == 1 ]]; then
  echo "▸ Making DMG"
  STAGE="$ROOT/dist/dmg"
  rm -rf "$STAGE" && mkdir -p "$STAGE"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  DMG="$ROOT/dist/things3pp-$VERSION.dmg"
  rm -f "$DMG"
  hdiutil create -volname "things3pp" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
  rm -rf "$STAGE"
  if [[ -n "${SIGN_IDENTITY:-}" ]]; then codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG"; fi
  if [[ -n "${NOTARY_PROFILE:-}" ]]; then
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
  fi
  echo "✔ $DMG"
fi
echo "✔ $APP"
