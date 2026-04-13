#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# compute-sri.sh — regenerate Subresource Integrity hashes for the CDN
# scripts referenced by index.html.
#
# Usage: ./tools/compute-sri.sh
#
# For each script URL listed below, fetches the body, computes sha384,
# and prints a JSON-ready line that can be used as `integrity="..."`
# in a <script> tag. The output is meant to be pasted into index.html
# by the release engineer OR consumed by a CI step that rewrites the
# tags automatically.
#
# Why not hard-code the hashes?
#   - The CDN may serve a different build at the same version tag if
#     the upstream minifier output changes.
#   - Pinning the hash means a silent CDN-side rebuild causes a hard
#     fail in the browser, which is what we want for AML/CFT use.
#
# Run this in CI on every deploy — not on every commit — so CDN drift
# is caught at deploy time, not sooner.
#
# Regulatory basis:
#   OWASP ASVS 14.5.3 (SRI for third-party resources)
#   NIST SP 800-218 PW.4.1 (verify integrity of acquired software)
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

URLS=(
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
  "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js"
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"
  "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
)

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required" >&2
  exit 1
fi

echo "# Generated $(date -u +%FT%TZ)"
echo "# Paste these integrity attributes into the matching <script> tags."
for url in "${URLS[@]}"; do
  body=$(curl -fsSL --max-time 30 "$url") || {
    echo "# FAILED: $url" >&2
    continue
  }
  hash=$(printf '%s' "$body" | openssl dgst -sha384 -binary | openssl base64 -A)
  printf 'integrity="sha384-%s" src="%s"\n' "$hash" "$url"
done
