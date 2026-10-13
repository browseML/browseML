#!/bin/sh
# SPDX-License-Identifier: MIT OR Apache-2.0
# browseML's browser checks (app/tests/browser.mjs: headless Brave or Chrome, a throwaway profile, the built page served
# cross-origin isolated), appended to the release's record (testing/results/v<version>.txt) after testing/release.sh.
#   testing/browser.sh 0.6.2 [/usr/bin/brave-browser]
set -u
cd "$(dirname "$0")/.."
V="${1:?the version, e.g. 0.6.2}"
BROWSER="${2:-/usr/bin/brave-browser}"
MODELS="${BANKML_MODELS:-$HOME/bML/bankml/.models}"
OUT="testing/results/v$V.txt"
{
  printf '\n== browser: %s, headless, a throwaway profile\n' "$("$BROWSER" --version 2>/dev/null)"
  t0=$(date +%s)
  if (cd app && node tests/browser.mjs --browser "$BROWSER" --models "$MODELS") 2>&1; then r=pass; else r=FAIL; fi
  printf -- '-- browser checks: %s (%ss)\n' "$r" "$(( $(date +%s) - t0 ))"
} | tee -a "$OUT"
tail -n 1 "$OUT" | grep -q -- '-- browser checks: pass'
