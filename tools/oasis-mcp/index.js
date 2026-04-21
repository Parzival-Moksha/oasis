import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  OASIS_MCP_INSTRUCTIONS,
  OASIS_MCP_TOOL_SPECS,
  prepareOasisToolArgs,
} from "../../src/lib/mcp/oasis-tool-spec.js";

const OASIS_URL = process.env.OASIS_URL || "http://localhost:4516";
const PINNED_WORLD_ID = (process.env.OASIS_ACTIVE_WORLD_ID || "").trim();
const DEFAULT_AGENT_TYPE = normalizeAgentType(process.env.OASIS_AGENT_TYPE || "merlin");

const server = new McpServer(
  { name: "oasis-mcp", version: "1.0.0" },
  {
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    instructions: OASIS_MCP_INSTRUCTIONS,
  },
);

function normalizeAgentType(value, fallback = "merlin") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  return trimmed || fallback;
}

function txt(result, imageBlocks = []) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
      ...imageBlocks,
    ],
    structuredContent: result,
    isError: !result?.ok,
  };
}

function mimeTypeForFormat(format) {
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return "image/jpeg";
}

// Extract base64 captures from screenshot tool results as MCP image content
// blocks so Anorak Pro (via Claude Code CLI) SEES the pixels. Without this,
// captures come through as URLs/paths that Claude Code can't reach.
function extractScreenshotImageBlocks(toolName, result) {
  const isScreenshotTool =
    toolName === "screenshot_viewport" ||
    toolName === "screenshot_avatar" ||
    toolName === "avatarpic_merlin" ||
    toolName === "avatarpic_user";
  if (!isScreenshotTool || !result || typeof result !== "object") return [];
  const data = result.data;
  if (!data || typeof data !== "object") return [];
  const captures = Array.isArray(data.captures) ? data.captures : [];
  const blocks = [];
  for (const capture of captures) {
    if (!capture || typeof capture !== "object") continue;
    const base64 = typeof capture.base64 === "string" ? capture.base64 : "";
    if (!base64) continue;
    blocks.push({
      type: "image",
      data: base64,
      mimeType: mimeTypeForFormat(capture.format),
    });
  }
  return blocks;
}

function compactScreenshotProxyResult(result) {
  if (!result || typeof result !== "object") return result;
  const next = { ...result };
  const data = next.data && typeof next.data === "object" ? { ...next.data } : null;
  if (!data) return next;
  if (Array.isArray(data.captures)) {
    data.captures = data.captures.map(capture => {
      if (!capture || typeof capture !== "object") return capture;
      const compact = { ...capture };
      delete compact.base64;
      return compact;
    });
  }
  delete data.base64;
  next.data = data;
  return next;
}

async function proxyOasisTool(tool, args) {
  try {
    const response = await fetch(`${OASIS_URL}/api/oasis-tools`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        message: data?.message || data?.error || `HTTP ${response.status}`,
      };
    }
    if (!data || typeof data !== "object") {
      return { ok: false, message: "Invalid response from Oasis tools API." };
    }
    return data;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildToolContext() {
  return {
    ...(PINNED_WORLD_ID ? { worldId: PINNED_WORLD_ID } : {}),
    ...(DEFAULT_AGENT_TYPE ? { agentType: DEFAULT_AGENT_TYPE } : {}),
  };
}

function maybeCompactToolResult(toolName, result) {
  if (toolName === "screenshot_viewport" || toolName === "screenshot_avatar" || toolName === "avatarpic_merlin" || toolName === "avatarpic_user") {
    return compactScreenshotProxyResult(result);
  }
  return result;
}

for (const spec of OASIS_MCP_TOOL_SPECS) {
  server.registerTool(
    spec.name,
    {
      title: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
    },
    async (args) => {
      const preparedArgs = prepareOasisToolArgs(spec.name, args || {}, buildToolContext());
      const result = await proxyOasisTool(spec.name, preparedArgs);
      // Extract image blocks BEFORE compacting (compacting strips base64 from the
      // text representation, but we still want pixels in the content array).
      const imageBlocks = extractScreenshotImageBlocks(spec.name, result);
      return txt(maybeCompactToolResult(spec.name, result), imageBlocks);
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
