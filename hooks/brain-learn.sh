#!/usr/bin/env bash
#
# brain-learn.sh — Phase 3 self-evolving hook (Stop event).
#
# Runs at the end of every Claude Code session. Its job is narrow:
#
#   1. Scan `.claude/brain-lessons/` for any lesson files from the
#      current session and confirm they're present.
#   2. Append a session-summary stub so the next SessionStart hook has
#      a place to load from.
#   3. NEVER touch code. Lessons are DATA — human-auditable JSONL files
#      that only affect how the advisor is briefed next session.
#
# Scope control (the non-negotiable safety line):
#   - This hook only WRITES to `.claude/brain-lessons/**`.
#   - It NEVER runs git commands that mutate state.
#   - It NEVER edits files under src/, tests/, or netlify/.
#   - It NEVER touches src/domain/constants.ts or CLAUDE.md.
#
# If the hook ever needs to propose a code change, it opens an Asana
# task via the scripts/brain-score.ts runner instead. Regulatory logic
# cannot evolve without a human per Cabinet Res 134/2025 Art.19.
#
# Regulatory basis:
#   - FDL No.10/2025 Art.20-21 (CO duty of care — documented learning)
#   - Cabinet Res 134/2025 Art.19 (internal review before change)
#   - FATF Rec 18 (internal controls proportionate to risk)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LESSONS_DIR="${REPO_ROOT}/.claude/brain-lessons"
SESSIONS_INDEX="${LESSONS_DIR}/sessions.jsonl"

mkdir -p "${LESSONS_DIR}"

# Count the lesson files generated during this session.
LESSON_COUNT="$(find "${LESSONS_DIR}" -name 'session-*.jsonl' -mmin -60 2>/dev/null | wc -l | tr -d ' ')"

# Append a session marker to sessions.jsonl so the SessionStart hook
# knows this session existed and can load its lessons.
printf '{"at":"%s","lessonFiles":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${LESSON_COUNT}" \
  >> "${SESSIONS_INDEX}"

echo "[brain-learn] recorded session stop at $(date -u +%Y-%m-%dT%H:%M:%SZ), ${LESSON_COUNT} lesson file(s) in window"
