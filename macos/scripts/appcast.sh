#!/bin/sh
# Writes appcast.xml next to the notarized release ZIP (bundle.sh runs this for releases).
#   scripts/appcast.sh dist/Concept-macos-universal.zip [path/to/Info.plist]
# The enclosure is signed with the EdDSA private key from the login keychain account
# "concept" (SPARKLE_ACCOUNT) or from SPARKLE_KEY_FILE. Release notes are this
# version's CHANGELOG section. Upload appcast.xml as a release asset next to the ZIP.
set -eu
cd "$(dirname "$0")/.."
zip_path="$1"
plist="${2:-Resources/Info.plist}"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")"
build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist")"
feed="$(/usr/libexec/PlistBuddy -c 'Print :SUFeedURL' "$plist")"
repo="$(printf '%s' "$feed" | sed -E 's#^https://github.com/([^/]+/[^/]+)/.*#\1#')"
base="${CONCEPT_DOWNLOAD_BASE:-https://github.com/$repo/releases/download/v$version}"
bin=.build/artifacts/sparkle/Sparkle/bin

scripts/check-release-key.sh "$plist"
if [ -n "${SPARKLE_KEY_FILE:-}" ]; then
  sig="$("$bin/sign_update" --ed-key-file "$SPARKLE_KEY_FILE" "$zip_path")"
else
  sig="$("$bin/sign_update" --account "${SPARKLE_ACCOUNT:-concept}" "$zip_path")"
fi
notes="$(awk -v v="$version" 'index($0, "## [" v "]") == 1 { on = 1; next } on && /^## \[/ { exit } on { print }' ../CHANGELOG.md)"
if [ -z "$notes" ]; then
  echo "CHANGELOG.md has no section for $version." >&2
  exit 1
fi
cat > "$(dirname "$zip_path")/appcast.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Concept</title>
    <item>
      <title>Concept $version</title>
      <pubDate>$(LC_ALL=C date -u "+%a, %d %b %Y %H:%M:%S +0000")</pubDate>
      <sparkle:version>$build</sparkle:version>
      <sparkle:shortVersionString>$version</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <description sparkle:format="markdown"><![CDATA[
$notes
]]></description>
      <enclosure url="$base/$(basename "$zip_path")" type="application/zip" $sig />
    </item>
  </channel>
</rss>
XML
echo "Wrote $(dirname "$zip_path")/appcast.xml"
