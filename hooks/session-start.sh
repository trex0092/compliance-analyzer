#!/bin/bash
# Session Start Hook — ensures code-review-graph is up to date
# Runs automatically when a new Claude Code session begins

set -e

GRAPH_DIR=".code-review-graph"
GRAPH_DB="$GRAPH_DIR/graph.db"

# If graph exists, do incremental update; otherwise full build
if [ -f "$GRAPH_DB" ]; then
  echo "Updating code-review-graph (incremental)..."
  uvx code-review-graph update 2>/dev/null || true
else
  echo "Building code-review-graph (first time)..."
  uvx code-review-graph build 2>/dev/null || true
fi
