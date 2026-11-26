#!/bin/bash
# Builds Concept.app: universal (arm64 + x86_64) release build of the Concept
# executable, Info.plist, programmatically generated icon, codesign, and a zip in dist/.
#
# Signing: set CONCEPT_SIGNING_IDENTITY to a "Developer ID Application: ..." identity
# for a release. Set CONCEPT_NOTARY_PROFILE (a notarytool keychain profile) to notarize
# and staple. Without them the app is ad-hoc signed, for local builds only.
# Releases (any non-ad-hoc identity, or CONCEPT_RELEASE=1) refuse the placeholder
# SUPublicEDKey before building, embed Sparkle and write dist/appcast.xml.
# The version comes from Resources/Info.plist, the same value the appcast uses.
# Usage: scripts/bundle.sh
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' Resources/Info.plist)"

SIGN_ID="${CONCEPT_SIGNING_IDENTITY:--}"
if [ "$SIGN_ID" != "-" ] && [ -n "${CONCEPT_NOTARY_PROFILE:-}" ]; then NOTARIZE=1; else NOTARIZE=0; fi
RELEASE_MODE=0
if [ "${CONCEPT_RELEASE:-0}" = "1" ] || [ "$SIGN_ID" != "-" ]; then RELEASE_MODE=1; fi
if [ "$RELEASE_MODE" = 1 ]; then
  scripts/check-release-key.sh Resources/Info.plist
fi

# Temporary icon and notary files are removed on success and on any failure.
ICON_TMP=""
NOTARY_TMP=""
trap 'rm -rf ${ICON_TMP:+"$ICON_TMP"} ${NOTARY_TMP:+"$NOTARY_TMP"} icon.iconset' EXIT

ARCHS=(--arch arm64 --arch x86_64)
echo "==> swift build -c release (universal) for $VERSION"
swift build -c release "${ARCHS[@]}"
BIN="$(swift build -c release "${ARCHS[@]}" --show-bin-path)/Concept"

APP="Concept.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
rm -rf "$APP" dist
mkdir -p "$MACOS" "$RESOURCES" "$CONTENTS/Frameworks"

echo "==> assembling $APP"
cp "$BIN" "$MACOS/Concept"
ditto .build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework \
  "$CONTENTS/Frameworks/Sparkle.framework"
cp Resources/Info.plist "$CONTENTS/Info.plist"

echo "==> generating icon (programmatically drawn)"
ICON_TMP="$(mktemp -d "${TMPDIR:-/tmp}/concept-icon-XXXXXX")"
cat > "$ICON_TMP/icon.swift" <<'SWIFT'
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
ICON_PNG="$ICON_TMP/Concept-icon.png"
swiftc -o "$ICON_TMP/icon-gen" "$ICON_TMP/icon.swift"
"$ICON_TMP/icon-gen" "$ICON_PNG"
for spec in "16 16" "32 32" "64 64" "128 128" "256 256" "512 512" "1024 1024"; do
  set -- $spec
  sips -z "$2" "$2" "$ICON_PNG" --out "$ICONSET/icon_${1}x${1}.png" >/dev/null
  sips -z "$2" "$2" "$ICON_PNG" --out "$ICONSET/icon_${1}x${1}@2x.png" >/dev/null 2>&1 || true
done
iconutil -c icns "$ICONSET" -o "$RESOURCES/Concept.icns"
rm -rf "$ICONSET"

# Extended attributes (quarantine, provenance) are not part of the code signature.
# Drop them before signing so the zip carries no AppleDouble (._) entries.
xattr -cr "$APP"

# Sign inside out: Sparkle helpers, framework, then the app itself.
sign() {
  if [ "$SIGN_ID" = "-" ]; then
    codesign --force --sign - "$@"
  else
    codesign --force --timestamp --options runtime --sign "$SIGN_ID" "$@"
  fi
}
FW="$CONTENTS/Frameworks/Sparkle.framework/Versions/B"
if [ "$SIGN_ID" = "-" ]; then
  echo "==> ad-hoc codesign (local build only; not notarized)"
else
  echo "==> Developer ID codesign"
fi
sign "$FW/XPCServices/Installer.xpc"
sign --preserve-metadata=entitlements "$FW/XPCServices/Downloader.xpc"
sign "$FW/Autoupdate"
sign "$FW/Updater.app"
sign "$FW"
sign "$APP"
codesign --verify --deep --strict "$APP"

if [ "$NOTARIZE" = 1 ]; then
  echo "==> notarizing (notarytool profile: $CONCEPT_NOTARY_PROFILE)"
  NOTARY_TMP="$(mktemp -d "${TMPDIR:-/tmp}/concept-notary-XXXXXX")"
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
if [ "$RELEASE_MODE" = 1 ]; then
  echo "==> signing the Sparkle appcast"
  scripts/appcast.sh "$ZIP" "$CONTENTS/Info.plist"
fi
echo "done: $APP and $ZIP"
