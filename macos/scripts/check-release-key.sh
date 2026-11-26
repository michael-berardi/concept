#!/bin/sh
# Refuses a release while SUPublicEDKey is the placeholder or not a 32-byte EdDSA key.
#   scripts/check-release-key.sh [path/to/Info.plist]
# Get the public key with: .build/artifacts/sparkle/Sparkle/bin/generate_keys -p
set -eu
cd "$(dirname "$0")/.."
plist="${1:-Resources/Info.plist}"
key="$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$plist" 2>/dev/null || true)"
if [ -z "$key" ] || [ "$key" = "REPLACE_WITH_CONCEPT_SPARKLE_EDDSA_PUBLIC_KEY" ]; then
  echo "Release refused: SUPublicEDKey in $plist is the placeholder. Set it to the output of generate_keys -p." >&2
  exit 1
fi
if ! printf '%s' "$key" | LC_ALL=C grep -Eq '^[A-Za-z0-9+/]{43}=$'; then
  echo "Release refused: SUPublicEDKey in $plist is not a 32-byte base64 EdDSA public key." >&2
  exit 1
fi
