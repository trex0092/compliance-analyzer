#!/usr/bin/env bash
# ==========================================================================
# Hawkeye Sterling — one-shot bootstrap
# ==========================================================================
# Sets up a Managed Agent from scratch with a single command.
#
# What it does:
#   1. Verifies prerequisites (node, git, openssl)
#   2. Runs `npm install` if node_modules is missing
#   3. Prompts for ANTHROPIC_API_KEY if not set
#   4. Generates HAWKEYE_BRAIN_TOKEN if not set
#   5. Writes them to .env.local (gitignored)
#   6. Prints instructions for setting HAWKEYE_BRAIN_TOKEN in Netlify
#   7. Runs install-agent.mjs for both agent YAMLs
#   8. Prints the next command to start an agent session
#
# Usage:
#   bash scripts/bootstrap.sh
#
# This script is idempotent — running it twice is safe.
# ==========================================================================
set -euo pipefail

# -- colours ---------------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; CYN=$'\e[36m'; RST=$'\e[0m'
else
  BOLD=''; DIM=''; RED=''; GRN=''; YEL=''; CYN=''; RST=''
fi

step()  { printf '\n%s▸ %s%s\n' "$BOLD" "$1" "$RST"; }
ok()    { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
warn()  { printf '  %s!%s %s\n' "$YEL" "$RST" "$1"; }
fail()  { printf '  %s✗%s %s\n' "$RED" "$RST" "$1"; exit 1; }
info()  { printf '  %s%s%s\n' "$DIM" "$1" "$RST"; }

cd "$(dirname "$0")/.."
ROOT="$PWD"

step "Checking prerequisites"
command -v node     >/dev/null || fail "node is required"
command -v git      >/dev/null || fail "git is required"
command -v openssl  >/dev/null || fail "openssl is required"
ok "node $(node --version)"
ok "git $(git --version | awk '{print $3}')"
ok "openssl present"

step "Checking git branch"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "claude/install-compliance-analyzer-SVN6Y" && "$BRANCH" != "main" ]]; then
  warn "current branch is $BRANCH — the brain + agents code lives on claude/install-compliance-analyzer-SVN6Y"
else
  ok "on $BRANCH"
fi

step "Installing dependencies"
if [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules ]]; then
  npm install --no-audit --no-fund
  ok "npm install complete"
else
  ok "node_modules already present"
fi

step "Loading secrets from .env.local (if present)"
if [[ -f .env.local ]]; then
  set -a; . ./.env.local; set +a
  ok "loaded .env.local"
else
  touch .env.local
  info "no .env.local yet — will create"
fi

# -- ANTHROPIC_API_KEY -----------------------------------------------------
step "Anthropic API key"
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  printf '  Paste your Anthropic API key (sk-ant-...) — get one at\n'
  printf '  https://console.anthropic.com/settings/keys\n'
  printf '  key: '
  read -rs ANTHROPIC_API_KEY
  printf '\n'
  [[ -z "$ANTHROPIC_API_KEY" ]] && fail "no key provided"
  [[ "$ANTHROPIC_API_KEY" != sk-ant-* ]] && warn "key does not start with sk-ant- — continuing anyway"
  # persist
  grep -v '^ANTHROPIC_API_KEY=' .env.local > .env.local.tmp 2>/dev/null || true
  printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY" >> .env.local.tmp
  mv .env.local.tmp .env.local
  export ANTHROPIC_API_KEY
  ok "saved to .env.local"
else
  ok "already set"
fi

# -- HAWKEYE_BRAIN_TOKEN ---------------------------------------------------
step "Hawkeye brain bearer token"
if [[ -z "${HAWKEYE_BRAIN_TOKEN:-}" ]]; then
  HAWKEYE_BRAIN_TOKEN=$(openssl rand -hex 24)
  grep -v '^HAWKEYE_BRAIN_TOKEN=' .env.local > .env.local.tmp 2>/dev/null || true
  printf 'HAWKEYE_BRAIN_TOKEN=%s\n' "$HAWKEYE_BRAIN_TOKEN" >> .env.local.tmp
  mv .env.local.tmp .env.local
  export HAWKEYE_BRAIN_TOKEN
  ok "generated and saved to .env.local"
else
  ok "already set"
fi

# -- HAWKEYE_BRAIN_URL -----------------------------------------------------
if [[ -z "${HAWKEYE_BRAIN_URL:-}" ]]; then
  HAWKEYE_BRAIN_URL="https://compliance-analyzer.netlify.app"
  grep -v '^HAWKEYE_BRAIN_URL=' .env.local > .env.local.tmp 2>/dev/null || true
  printf 'HAWKEYE_BRAIN_URL=%s\n' "$HAWKEYE_BRAIN_URL" >> .env.local.tmp
  mv .env.local.tmp .env.local
  export HAWKEYE_BRAIN_URL
fi
ok "HAWKEYE_BRAIN_URL=$HAWKEYE_BRAIN_URL"

# -- Netlify reminder ------------------------------------------------------
step "Netlify env var reminder"
printf '  You must also set %sHAWKEYE_BRAIN_TOKEN%s in Netlify so that\n' "$BOLD" "$RST"
printf '  /api/brain accepts the orchestrator requests.\n\n'
printf '  Option A — Netlify CLI (if installed):\n'
printf '    %snpx netlify env:set HAWKEYE_BRAIN_TOKEN "%s"%s\n\n' "$CYN" "$HAWKEYE_BRAIN_TOKEN" "$RST"
printf '  Option B — Netlify web UI:\n'
printf '    https://app.netlify.com/sites/compliance-analyzer/settings/env\n'
printf '    Key:   HAWKEYE_BRAIN_TOKEN\n'
printf '    Value: %s%s%s\n' "$BOLD" "$HAWKEYE_BRAIN_TOKEN" "$RST"

# -- Install the two agents ------------------------------------------------
step "Installing managed agents via POST /v1/agents"
for yml in agents/incident-commander.yml agents/hawkeye-mlro.yml; do
  if [[ -f "$yml" ]]; then
    printf '\n  %sinstalling %s%s\n' "$DIM" "$yml" "$RST"
    node scripts/install-agent.mjs "$yml"
  else
    warn "skipped $yml (not found)"
  fi
done

# -- Done ------------------------------------------------------------------
step "Bootstrap complete"
ok "agents installed — see .env.agents for IDs"
printf '\n  To run the incident commander:\n'
printf '    %sbash -c '"'"'set -a; . ./.env.local; set +a; node scripts/agent-orchestrator.mjs incident-commander "Smoke test: call brain_event with kind=manual, severity=info, summary=hello"'"'"'%s\n\n' "$CYN" "$RST"
printf '  To run the MLRO:\n'
printf '    %sbash -c '"'"'set -a; . ./.env.local; set +a; node scripts/agent-orchestrator.mjs hawkeye-mlro "Prepare today'"'"'"'"'"'"'"'"'s briefing review"'"'"'%s\n\n' "$CYN" "$RST"
printf '  %sRemember:%s set HAWKEYE_BRAIN_TOKEN in Netlify (above) before running\n' "$BOLD" "$RST"
printf '  the orchestrator, or /api/brain will return 401.\n'
