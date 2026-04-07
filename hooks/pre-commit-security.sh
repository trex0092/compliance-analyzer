#!/bin/bash
# Pre-commit security check — catches common issues before they land
# Scans staged files for hardcoded secrets, dangerous patterns, etc.

set -e

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
ISSUES=0

for file in $STAGED_FILES; do
  # Skip binary files and non-code files
  case "$file" in
    *.js|*.ts|*.tsx|*.mjs|*.mts) ;;
    *) continue ;;
  esac

  # Check for hardcoded API keys/tokens (common patterns)
  if grep -nE "(ASANA_TOKEN|api_key|apiKey|secret|password)\s*[:=]\s*['\"][^'\"]{8,}" "$file" 2>/dev/null | grep -v "\.env" | grep -v "example" | grep -v "your-" | grep -v "process\.env" > /dev/null; then
    echo "WARNING: Possible hardcoded secret in $file"
    ISSUES=$((ISSUES + 1))
  fi

  # Check for eval/Function constructor
  if grep -nE "\beval\s*\(|\bnew\s+Function\s*\(" "$file" 2>/dev/null > /dev/null; then
    echo "BLOCKED: eval() or new Function() detected in $file"
    ISSUES=$((ISSUES + 1))
  fi

  # Check for dangerouslySetInnerHTML
  if grep -n "dangerouslySetInnerHTML" "$file" 2>/dev/null > /dev/null; then
    echo "WARNING: dangerouslySetInnerHTML in $file — ensure content is sanitized"
  fi

  # Check for console.log (should use console.warn/error instead)
  if grep -nE "console\.log\b" "$file" 2>/dev/null > /dev/null; then
    echo "WARNING: console.log in $file — use console.warn/error for production"
  fi
done

if [ $ISSUES -gt 0 ]; then
  echo ""
  echo "Found $ISSUES security issue(s). Fix before committing."
  exit 1
fi
