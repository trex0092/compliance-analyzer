#!/usr/bin/env node
/**
 * hawkeye-mcp — stdio MCP server entrypoint for the Hawkeye
 * compliance brain. Run via:
 *
 *    npx tsx bin/hawkeye-mcp.ts
 *
 * or, after adding a package.json "bin" entry:
 *
 *    hawkeye-mcp
 *
 * External MCP clients (goose, Cursor, Cline, Claude Desktop)
 * can configure this as a stdio server to gain access to the
 * 47 catalogue skills — including the 9 real runners that
 * execute genuine compliance logic (risk-score, tfs-check,
 * pep-check, brain-analyze, cross-case, brain-status,
 * four-eyes-status, ubo-trace, caveman).
 *
 * Example goose config (~/.config/goose/config.yaml):
 *
 *   extensions:
 *     hawkeye-compliance:
 *       type: stdio
 *       command: node
 *       args:
 *         - /absolute/path/to/bin/hawkeye-mcp.ts
 *       enabled: true
 *
 * Regulatory basis: FDL No.10/2025 Art.20-21, Art.29;
 * Cabinet Res 134/2025 Art.19.
 */

import { createInterface } from 'node:readline';
import { runStdioLoop } from '../src/mcp/skillMcpServer';

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, terminal: false });

  // Wrap the readline interface as an async iterable of lines.
  async function* reader(): AsyncIterable<string> {
    for await (const line of rl) yield line;
  }

  await runStdioLoop(reader(), (line) => {
    process.stdout.write(line + '\n');
  });
}

main().catch((err) => {
  process.stderr.write(
    `hawkeye-mcp fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
