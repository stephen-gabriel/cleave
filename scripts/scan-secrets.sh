#!/bin/bash
# Scan for potential secrets in tracked files
set -e

# Check for 0x followed by 64 hex characters (private keys)
echo "Scanning for private key patterns..."
if git ls-files | xargs grep -l "0x[0-9a-fA-F]\{64\}" 2>/dev/null | grep -v "secrets.yaml\|\.env\|node_modules" | head -c 0 >/dev/null 2>&1; then
  # More precise check
  FOUND=$(git ls-files | grep -v node_modules | xargs grep -l "0x[0-9a-fA-F]\{64\}" 2>/dev/null | grep -v "\.env$\|secrets.yaml$\|\.example$")
  if [ ! -z "$FOUND" ]; then
    echo "ERROR: Found potential private keys in tracked files:"
    echo "$FOUND"
    exit 1
  fi
fi

# Check for PRIVATE_KEY= with value
echo "Scanning for PRIVATE_KEY assignments..."
FOUND_PK=$(git ls-files | grep -v node_modules | xargs grep -l "PRIVATE_KEY=[a-zA-Z0-9]" 2>/dev/null | grep -v "\.env\.example$\|secrets.yaml$")
if [ ! -z "$FOUND_PK" ]; then
  echo "ERROR: Found PRIVATE_KEY assignments in tracked files:"
  echo "$FOUND_PK"
  exit 1
fi

echo "✓ No secrets found in tracked files"
exit 0
