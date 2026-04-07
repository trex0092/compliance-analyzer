# MCP Server Setup Guide

## Active: code-review-graph
Already configured in `.mcp.json`. Auto-updates via session-start hook.

## Optional: Asana MCP
Add to `.mcp.json` to manage Asana tasks directly from Claude:

```json
{
  "mcpServers": {
    "code-review-graph": {
      "command": "uvx",
      "args": ["code-review-graph", "serve"]
    },
    "asana": {
      "command": "npx",
      "args": ["-y", "@anthropic/asana-mcp-server"],
      "env": {
        "ASANA_TOKEN": "your-personal-access-token"
      }
    }
  }
}
```

## Optional: Netlify MCP
Add to `.mcp.json` to deploy and manage Netlify from Claude:

```json
{
  "mcpServers": {
    "netlify": {
      "command": "npx",
      "args": ["-y", "netlify-mcp-server"],
      "env": {
        "NETLIFY_AUTH_TOKEN": "your-netlify-token"
      }
    }
  }
}
```

## Optional: GitHub MCP
Already available in Claude Code web sessions via platform integration.
For CLI usage, add:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic/github-mcp-server"],
      "env": {
        "GITHUB_TOKEN": "your-github-token"
      }
    }
  }
}
```
