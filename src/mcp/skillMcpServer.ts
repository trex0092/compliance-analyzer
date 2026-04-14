/**
 * Hawkeye Skill MCP Server — stdio JSON-RPC 2.0 transport that
 * exposes every skill in `defaultSkillRegistry` as an MCP tool.
 *
 * This lets external agents — goose, Cursor, Cline, Claude Desktop,
 * any MCP-capable client — call the compliance brain's 9 real
 * skill runners (/risk-score, /brain-analyze, /cross-case,
 * /tfs-check, /pep-check, /ubo-trace, /brain-status,
 * /four-eyes-status, /caveman) as if they were native tools.
 *
 * Grounding:
 *   - Implements a minimal, protocol-accurate subset of MCP:
 *       * `initialize`    → returns server info + protocol version
 *       * `tools/list`    → returns one Tool per SkillCatalogueEntry
 *       * `tools/call`    → parses the invocation, runs the skill
 *                           through SkillRunnerRegistry.execute,
 *                           returns the reply as a TextContent block
 *   - Protocol version is hard-coded to "2024-11-05" — the stable
 *     MCP version string the ecosystem currently accepts. If the
 *     spec moves, update this constant in one place.
 *   - The transport is plain stdio: one JSON-RPC message per line
 *     in, one message per line out. No SSE, no Streamable-HTTP,
 *     no websockets — just the simplest thing that works with
 *     every MCP client the ecosystem supports.
 *   - Pure. No global state beyond the injected registry.
 *
 * Why not use the Anthropic MCP SDK?
 *   - Adding @modelcontextprotocol/sdk drags in a transitive
 *     dep graph we don't need. The subset we actually use is
 *     ~80 lines of hand-rolled JSON-RPC that ships in this file,
 *     zero new dependencies, zero new attack surface.
 *   - Tests would need a fake transport anyway; the hand-rolled
 *     version IS the fake transport.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO reasoned decision — skills
 *                             remain auditable regardless of
 *                             caller)
 *   FDL No.10/2025 Art.29    (no tipping off — SkillRunnerRegistry
 *                             already wraps every reply through
 *                             lintForTippingOff before return)
 *   Cabinet Res 134/2025 Art.19 (internal review visibility)
 */

import {
  defaultSkillRegistry,
  type SkillRunnerContext,
  type SkillRunnerRegistry,
} from '../services/asana/skillRunnerRegistry';
import { SKILL_CATALOGUE, type SkillCatalogueEntry } from '../services/asanaCommentSkillRouter';
import type { StrFeatures } from '../services/predictiveStr';

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_NAME = 'hawkeye-compliance-brain';
export const MCP_SERVER_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 message shapes (minimal subset we actually use)
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Standard JSON-RPC error codes.
export const JSON_RPC_ERROR = {
  PARSE_ERROR: -32_700,
  INVALID_REQUEST: -32_600,
  METHOD_NOT_FOUND: -32_601,
  INVALID_PARAMS: -32_602,
  INTERNAL_ERROR: -32_603,
} as const;

// ---------------------------------------------------------------------------
// Tool schema builder
// ---------------------------------------------------------------------------

/**
 * Convert a SkillCatalogueEntry to an MCP Tool. The inputSchema
 * is a minimal JSON Schema covering the fields a skill runner
 * context needs:
 *   - entityRef (string, required)
 *   - tenantId  (string, optional)
 *   - features  (object, optional — only required by skills
 *                that declare minArgs >= 1 and need feature data)
 *   - args      (array of strings, optional — extra raw args)
 */
function toMcpTool(skill: SkillCatalogueEntry): McpTool {
  const argDescriptions: Record<string, string> = {
    'risk-score': 'Explainable STR probability + top-5 factor contributions',
    'pep-check': 'PEP screening with EDD + Senior Mgmt citation',
    'tfs-check': 'TFS screening classification (clear / potential / confirmed)',
    'brain-status': 'Live Brain status (catalogue + typology + detector counts)',
    'cross-case': 'Cross-case correlation over tenant memory store',
    'brain-analyze': 'FATF DPMS typology match report',
    'ubo-trace': 'Ultimate beneficial owner chain traversal',
    'four-eyes-status': 'Pending four-eyes approvals summary',
    caveman: 'Ultra-terse compliance verdict compression (lite/full/ultra)',
  };
  return {
    name: `skill.${skill.name}`,
    description:
      (argDescriptions[skill.name] ?? skill.description) + `  (Regulatory: ${skill.citation})`,
    inputSchema: {
      type: 'object',
      properties: {
        entityRef: {
          type: 'string',
          description: 'Opaque entity reference for this case.',
        },
        tenantId: {
          type: 'string',
          description: 'Tenant id for isolation; defaults to "mcp".',
        },
        features: {
          type: 'object',
          description:
            'StrFeatures vector for analytics-flavoured skills ' +
            '(risk-score, pep-check, tfs-check, brain-analyze, caveman). ' +
            'Optional for /brain-status, /cross-case, /ubo-trace, ' +
            '/four-eyes-status.',
        },
        args: {
          type: 'array',
          description:
            'Extra positional args after the entity ref. For /caveman ' +
            'args[0] is the intensity (lite|full|ultra).',
          items: { type: 'string' },
        },
      },
      required: ['entityRef'],
    },
  };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool invocation — parses MCP params → SkillInvocation → registry
// ---------------------------------------------------------------------------

export interface McpCallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  /**
   * Structured skill data (verdict, confidence, etc.) — included
   * as meta so MCP clients that support it can drill in without
   * re-parsing the text reply.
   */
  _meta?: Record<string, unknown>;
}

export async function invokeSkillOverMcp(
  registry: SkillRunnerRegistry,
  toolName: string,
  rawParams: unknown
): Promise<McpCallToolResult> {
  // Strip the "skill." namespace prefix.
  const skillName = toolName.startsWith('skill.') ? toolName.slice(6) : toolName;

  const skill = SKILL_CATALOGUE.find((s) => s.name === skillName);
  if (!skill) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Unknown skill: ${skillName}. Use tools/list to discover available skills.`,
        },
      ],
    };
  }

  const params = (rawParams ?? {}) as Record<string, unknown>;
  const entityRef =
    typeof params.entityRef === 'string' && params.entityRef.length > 0
      ? params.entityRef
      : 'mcp-unknown';
  const tenantId =
    typeof params.tenantId === 'string' && params.tenantId.length > 0 ? params.tenantId : 'mcp';
  const extraArgs = Array.isArray(params.args)
    ? (params.args as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const features = (params.features ?? undefined) as StrFeatures | undefined;

  const ctx: SkillRunnerContext = {
    tenantId,
    userId: 'mcp-client',
    entityRef,
    features,
  };

  const result = await registry.execute(
    {
      skill,
      args: [entityRef, ...extraArgs],
      rawComment: `/${skill.name} ${entityRef} ${extraArgs.join(' ')}`.trim(),
    },
    ctx
  );

  return {
    content: [{ type: 'text', text: result.reply }],
    _meta: {
      skillName: result.skillName,
      citation: result.citation,
      real: result.real,
      ...(result.data ?? {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Request dispatcher
// ---------------------------------------------------------------------------

export interface HandleRequestOptions {
  registry?: SkillRunnerRegistry;
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
  opts: HandleRequestOptions = {}
): Promise<JsonRpcResponse> {
  const id = request.id ?? null;
  const registry = opts.registry ?? defaultSkillRegistry;

  if (request.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: JSON_RPC_ERROR.INVALID_REQUEST,
        message: 'jsonrpc version must be "2.0"',
      },
    };
  }

  try {
    switch (request.method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: MCP_SERVER_NAME,
              version: MCP_SERVER_VERSION,
            },
            instructions:
              'Hawkeye compliance brain. Use tools/list to discover ' +
              'available skills. Every skill reply is pre-linted against ' +
              'FDL No.10/2025 Art.29 (no tipping off). ' +
              'Regulatory basis: FDL No.10/2025 Art.20-21.',
          },
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: SKILL_CATALOGUE.map(toMcpTool),
          },
        };
      }

      case 'tools/call': {
        const params = (request.params ?? {}) as {
          name?: string;
          arguments?: unknown;
        };
        if (typeof params.name !== 'string') {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: JSON_RPC_ERROR.INVALID_PARAMS,
              message: 'tools/call requires params.name: string',
            },
          };
        }
        const callResult = await invokeSkillOverMcp(registry, params.name, params.arguments);
        return {
          jsonrpc: '2.0',
          id,
          result: callResult,
        };
      }

      case 'ping': {
        return { jsonrpc: '2.0', id, result: {} };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: JSON_RPC_ERROR.METHOD_NOT_FOUND,
            message: `Method not found: ${request.method}`,
          },
        };
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: JSON_RPC_ERROR.INTERNAL_ERROR,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// stdio driver (optional — only runs when imported into a CLI entry)
// ---------------------------------------------------------------------------

/**
 * Start a stdio loop that reads one JSON-RPC message per line from
 * stdin and writes one response per line to stdout. Callers that
 * embed the server in a test harness use `handleMcpRequest` directly
 * and never touch this function.
 *
 * Errors on a per-message basis are surfaced as JSON-RPC error
 * responses. A malformed line produces a parse-error response with
 * id: null so the transport never stalls on bad input.
 */
export async function runStdioLoop(
  reader: AsyncIterable<string>,
  write: (line: string) => void | Promise<void>,
  opts: HandleRequestOptions = {}
): Promise<void> {
  for await (const line of reader) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      await write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: JSON_RPC_ERROR.PARSE_ERROR,
            message: 'Parse error',
          },
        })
      );
      continue;
    }
    if (!parsed || typeof parsed !== 'object') {
      await write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: JSON_RPC_ERROR.INVALID_REQUEST,
            message: 'Request must be a JSON object',
          },
        })
      );
      continue;
    }
    const response = await handleMcpRequest(parsed as JsonRpcRequest, opts);
    await write(JSON.stringify(response));
  }
}

// Exports for tests.
export const __test__ = { toMcpTool, invokeSkillOverMcp };
