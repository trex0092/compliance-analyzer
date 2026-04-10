# Graphify + Obsidian Setup

This project uses **Graphify** to build a persistent, queryable knowledge graph
over the codebase and Claude configuration. Combined with the Obsidian 3D Graph
plugin, it provides both a token-efficient query layer for Claude and a visual
map of the project for humans.

This guide walks through the full setup. Once complete, Claude will answer
questions against the graph instead of re-reading raw files, dramatically
reducing token usage.

## Why Graphify

- **Token efficiency**: Claude queries the graph in plain English instead of
  reading whole files. In practice this cuts per-task token usage significantly
  for navigation and discovery tasks.
- **Persistence**: The graph is incremental — after the first build, only
  changed files are reprocessed.
- **Complements `code-review-graph`**: Graphify covers all files (including
  `CLAUDE.md`, skills, docs), while `code-review-graph` provides structural
  call/impact analysis for source code.

## Step 1 — Install Graphify

Run this once per machine:

```bash
pip install graphifyy && graphify install
```

Two things happen:

1. The `graphifyy` Python package is installed.
2. Graphify registers itself as a Claude Code skill (available as `/graphify`).

## Step 2 — Build the Knowledge Graph

### Option A: Graph your Claude configuration

From Claude Code, run:

```
/graphify ~/.claude
```

This scans `CLAUDE.md`, skills, memory files, and any other configuration in
`~/.claude`, and builds a persistent graph.

### Option B: Graph this project

From Claude Code, run:

```
/graphify .
```

This builds the graph for the `compliance-analyzer` repo. The first run takes
a few minutes depending on repo size; subsequent runs are incremental.

Output lands in `graphify-out/` (gitignored). Key files:

- `graphify-out/wiki/index.md` — navigation entrypoint
- `graphify-out/GRAPH_REPORT.md` — community/group breakdown used for coloring

## Step 3 — Context Navigation Rule (already configured)

The project `CLAUDE.md` already contains a `Context Navigation` section telling
Claude to:

1. Query the graph first: `/graphify query "your question"`
2. Only read raw files when explicitly asked
3. Use `graphify-out/wiki/index.md` as the navigation entrypoint

No further action needed in this repo.

## Bonus — Obsidian 3D Graph Visualization

Optional, but useful for getting a visual map of the project.

### Install Obsidian and open the vault

1. Download Obsidian from <https://obsidian.md>.
2. Open the `compliance-analyzer` folder as a vault.

### Install the 3D Graph plugin (via BRAT)

1. Settings → Community Plugins → disable Restricted Mode.
2. Browse → search for **BRAT** → install and enable.
3. Command palette (Cmd/Ctrl + P) → **BRAT: Add a beta plugin**.
4. Paste the 3D Graph plugin repo (Aryan Gupta, version 2.4.1).
5. Enable **3D Graph** in Community Plugins.
6. Command palette → **3D Graph: Open 3D Graph View**.

### Recommended display settings

**Nodes**

- Base node size: `6–8`
- Enable **Scale by connections** so hub concepts appear larger

**Links**

- Opacity: `0.15–0.2`
- Thickness: `1–2`

**Display**

- Dark background
- Enable bloom/glow if available
- Slightly increase repulsion so clusters spread out

### Group colors

Graphify clusters files into communities. Suggested palette:

| Group | Purpose          | Hex       |
| ----- | ---------------- | --------- |
| 0     | Core / Entry     | `#3B82F6` |
| 1     | Logic / Services | `#10B981` |
| 2     | Data / Models    | `#F59E0B` |
| 3     | Config / Utils   | `#EC4899` |
| 4     | Docs / Tests     | `#8B5CF6` |
| 5     | (cycle)          | `#06B6D4` |
| 6     | (cycle)          | `#EF4444` |
| 7     | (cycle)          | `#84CC16` |

To map your actual groups to purposes, paste this into Claude Code after the
first graph build:

```
Read graphify-out/GRAPH_REPORT.md and list every community/group number with a
short description of what files and concepts are in each one. For each group,
suggest a hex color that visually represents its purpose. Format it as a table
I can use to set up my 3D Graph plugin colors in Obsidian.
```

## Keeping the graph fresh

- After significant code changes, re-run `/graphify .` — the build is
  incremental, so this is cheap.
- `graphify-out/` is gitignored; each developer maintains their own local copy.
- For structural code analysis (call graphs, impact radius), continue to use
  the `code-review-graph` MCP tool per `CLAUDE.md` → *Token-Efficient Workflow*.
