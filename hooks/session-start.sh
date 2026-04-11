#!/bin/bash
# Session Start Hook — ensures code-review-graph is up to date
# and loads recent Weaponized Brain lessons for the advisor.
#
# Runs automatically when a new Claude Code session begins.
#
# Phase 3 weaponization extension: also reports on the most recent
# brain-lessons so the advisor knows about recent MLRO overrides and
# degraded subsystems without having to re-scan the audit log.

set -e

GRAPH_DIR=".code-review-graph"
GRAPH_DB="$GRAPH_DIR/graph.db"
LESSONS_DIR=".claude/brain-lessons"

# Code-review-graph (existing behaviour, unchanged)
if [ -f "$GRAPH_DB" ]; then
  echo "Updating code-review-graph (incremental)..."
  uvx code-review-graph update 2>/dev/null || true
else
  echo "Building code-review-graph (first time)..."
  uvx code-review-graph build 2>/dev/null || true
fi

# Brain-lessons (Phase 3 — self-evolving hook)
#
# Report on the lesson files + session index. The report is printed to
# stdout so the harness captures it as session-start context. No code is
# executed; no files are modified. This is strictly READ + PRINT.
if [ -d "$LESSONS_DIR" ]; then
  LESSON_COUNT="$(find "$LESSONS_DIR" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$LESSON_COUNT" -gt 0 ]; then
    echo "[brain] loaded $LESSON_COUNT brain-lesson file(s) from $LESSONS_DIR"
    # Print the 5 most recent lesson files for context.
    find "$LESSONS_DIR" -name '*.jsonl' -type f 2>/dev/null \
      | head -5 \
      | while read -r f; do
          echo "  - $(basename "$f")"
        done
  else
    echo "[brain] $LESSONS_DIR present but empty — no lessons yet"
  fi
fi
