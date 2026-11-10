#!/bin/bash
# Builds Concept.app: universal (arm64 + x86_64) release build of the Concept
# executable, Info.plist, programmatically generated icon, codesign, and a zip in dist/.
#
# Signing: set CONCEPT_SIGNING_IDENTITY to a "Developer ID Application: ..." identity
# for a release. Set CONCEPT_NOTARY_PROFILE (a notarytool keychain profile) to notarize
# and staple. Without them the app is ad-hoc signed, for local builds only.
# Usage: scripts/bundle.sh
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="0.1.3"
# Prefer a version from git tags when available (read-only).
if command -v git >/dev/null 2>&1; then
  GIT_VERSION="$(git describe --tags --abbrev=0 2>/dev/null || true)"
  if [ -n "${GIT_VERSION:-}" ]; then VERSION="${GIT_VERSION#v}"; fi
fi

SIGN_ID="${CONCEPT_SIGNING_IDENTITY:--}"
if [ "$SIGN_ID" != "-" ] && [ -n "${CONCEPT_NOTARY_PROFILE:-}" ]; then NOTARIZE=1; else NOTARIZE=0; fi

ARCHS=(--arch arm64 --arch x86_64)
echo "==> swift build -c release (universal)"
swift build -c release "${ARCHS[@]}"
BIN="$(swift build -c release "${ARCHS[@]}" --show-bin-path)/Concept"

APP="Concept.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
rm -rf "$APP" dist
mkdir -p "$MACOS" "$RESOURCES"

echo "==> assembling $APP"
cp "$BIN" "$MACOS/Concept"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key> <string>Concept</string>
    <key>CFBundleDisplayName</key> <string>Concept</string>
    <key>CFBundleIdentifier</key> <string>dev.concept.Concept</string>
    <key>CFBundleVersion</key> <string>$VERSION</string>
    <key>CFBundleShortVersionString</key> <string>$VERSION</string>
    <key>CFBundlePackageType</key> <string>APPL</string>
    <key>CFBundleExecutable</key> <string>Concept</string>
    <key>CFBundleIconFile</key> <string>Concept</string>
    <key>LSMinimumSystemVersion</key> <string>14.0</string>
    <key>NSHighResolutionCapable</key> <true/>
    <key>NSHumanReadableCopyright</key> <string>MIT License</string>
    <key>CFBundleDocumentTypes</key>
    <array>
        <dict>
            <key>CFBundleTypeName</key> <string>Concept Vault</string>
            <key>CFBundleTypeRole</key> <string>Editor</string>
            <key>LSItemContentTypes</key> <array><string>public.folder</string></array>
        </dict>
    </array>
</dict>
</plist>
PLIST

echo "==> generating icon (programmatically drawn)"
cat > /tmp/concept-icon.swift <<'SWIFT'
import AppKit
// Thin-stroke "C" mark on a dark tile — matches the design language.
let size = 1024
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
NSColor(calibratedRed: 0, green: 0, blue: 0, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: size, height: size), xRadius: 180, yRadius: 180).fill()
// hairline inset border
let border = NSBezierPath(roundedRect: NSRect(x: 40, y: 40, width: size - 80, height: size - 80), xRadius: 150, yRadius: 150)
border.lineWidth = 8
NSColor(calibratedWhite: 0.16, alpha: 1).setStroke()
border.stroke()
// The "C": an open circle arc, thin stroke.
let arc = NSBezierPath()
arc.appendArc(withCenter: NSPoint(x: size / 2, y: size / 2), radius: 270,
              startAngle: 40, endAngle: 320, clockwise: false)
arc.lineWidth = 64
arc.lineCapStyle = .round
NSColor(calibratedRed: 0.369, green: 0.545, blue: 1.0, alpha: 1).setStroke()
arc.stroke()
// Small rank tick: three ascending dots to the lower right.
for (i, alpha) in [0.35, 0.6, 1.0].enumerated() {
    let dot = NSBezierPath(ovalIn: NSRect(x: 640 + CGFloat(i) * 74, y: 250, width: 30, height: 30))
    NSColor(calibratedWhite: 0.9, alpha: alpha).setFill()
    dot.fill()
}
image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write(Data("icon generation failed\n".utf8))
    exit(1)
}
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
SWIFT
ICONSET="$PWD/icon.iconset"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
ICON_TMP="$(mktemp -d /tmp/concept-icon-XXXXXX)"
ICON_PNG="$ICON_TMP/Concept-icon.png"
swiftc -o /tmp/concept-icon-gen /tmp/concept-icon.swift
/tmp/concept-icon-gen "$ICON_PNG"
for spec in "16 16" "32 32" "64 64" "128 128" "256 256" "512 512" "1024 1024"; do
  set -- $spec
  sips -z "$2" "$2" "$ICON_PNG" --out "$ICONSET/icon_${1}x${1}.png" >/dev/null
  sips -z "$2" "$2" "$ICON_PNG" --out "$ICONSET/icon_${1}x${1}@2x.png" >/dev/null 2>&1 || true
done
iconutil -c icns "$ICONSET" -o "$RESOURCES/Concept.icns"
rm -rf "$ICONSET" "$ICON_TMP" /tmp/concept-icon-gen /tmp/concept-icon.swift

# Extended attributes (quarantine, provenance) are not part of the code signature.
# Drop them before signing so the zip carries no AppleDouble (._) entries.
xattr -cr "$APP"

if [ "$SIGN_ID" = "-" ]; then
  echo "==> ad-hoc codesign (local build only; not notarized)"
  codesign --force --deep --sign - "$APP"
else
  echo "==> Developer ID codesign"
  codesign --force --deep --timestamp --options runtime --sign "$SIGN_ID" "$APP"
fi
codesign --verify --deep --strict "$APP"

if [ "$NOTARIZE" = 1 ]; then
  echo "==> notarizing (notarytool profile: $CONCEPT_NOTARY_PROFILE)"
  NOTARY_TMP="$(mktemp -d /tmp/concept-notary-XXXXXX)"
  trap 'rm -rf "$NOTARY_TMP"' EXIT
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$NOTARY_TMP/Concept.zip"
  xcrun notarytool submit "$NOTARY_TMP/Concept.zip" --keychain-profile "$CONCEPT_NOTARY_PROFILE" --wait --output-format json > "$NOTARY_TMP/submit.json"
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("status") == "Accepted", "notarization not accepted: " + str(d.get("status"))' "$NOTARY_TMP/submit.json"
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
  spctl -a -vv -t exec "$APP"
fi

mkdir -p dist
ZIP="dist/Concept-macos-universal.zip"
echo "==> zipping to $ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
echo "done: $APP and $ZIP"
