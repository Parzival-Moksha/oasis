// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// VISUAL QA MCP — Parzival's Eyes
// Claude Code sees the Oasis through Chrome DevTools Protocol.
// screenshot, execute_js, navigate, get_tabs, switch_tab, wait
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import CDP from "chrome-remote-interface";
import { z } from "zod";

let client = null;

async function getClient() {
  if (client) return client;
  const targets = await CDP.List({ host: "localhost", port: 9222 });
  const target = targets.find(t => t.type === "page") || targets[0];
  if (!target) throw new Error("No Chrome tabs found on port 9222");
  client = await CDP({ target: target.id, host: "localhost", port: 9222 });
  await enableDomains(client);
  // Auto-reconnect on disconnect
  client.on('disconnect', () => { client = null; });
  return client;
}

async function enableDomains(c) {
  await c.Page.enable();
  await c.Runtime.enable();
  await c.Input.enable();
}

const server = new McpServer({
  name: "visual-qa-mcp",
  version: "1.0.0",
});

// ── SCREENSHOT ───────────────────────────────────────────────────────────

server.tool("screenshot",
  "Capture a screenshot of the current browser tab. Returns base64 PNG.",
  {},
  async () => {
    const c = await getClient();
    const { data } = await c.Page.captureScreenshot({ format: "png" });
    return { content: [{ type: "image", data, mimeType: "image/png" }] };
  }
);

// ── NAVIGATE ─────────────────────────────────────────────────────────────

server.tool("navigate",
  "Navigate the browser tab to a URL.",
  { url: z.string().describe("URL to navigate to") },
  async ({ url }) => {
    const c = await getClient();
    await c.Page.navigate({ url });
    await new Promise(r => setTimeout(r, 3000)); // wait for render
    return { content: [{ type: "text", text: `Navigated to ${url}` }] };
  }
);

// ── EXECUTE JS ───────────────────────────────────────────────────────────

server.tool("execute_js",
  "Execute JavaScript in the page context and return the result.",
  { code: z.string().describe("JavaScript expression to evaluate") },
  async ({ code }) => {
    const c = await getClient();
    const result = await c.Runtime.evaluate({
      expression: code,
      awaitPromise: true,
      returnByValue: true,
    });
    const val = result.result?.value;
    return { content: [{ type: "text", text: JSON.stringify(val ?? result.result) }] };
  }
);

// ── GET TABS ─────────────────────────────────────────────────────────────

server.tool("get_tabs",
  "List all open Chrome tabs.",
  {},
  async () => {
    const targets = await CDP.List({ host: "localhost", port: 9222 });
    const tabs = targets.filter(t => t.type === "page").map(t => ({
      id: t.id, title: t.title, url: t.url
    }));
    return { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] };
  }
);

// ── SWITCH TAB ───────────────────────────────────────────────────────────

server.tool("switch_tab",
  "Switch CDP connection to a different tab.",
  { targetId: z.string().describe("Chrome target ID from get_tabs") },
  async ({ targetId }) => {
    if (client) { await client.close(); client = null; }
    client = await CDP({ target: targetId, host: "localhost", port: 9222 });
    await enableDomains(client);
    client.on('disconnect', () => { client = null; });
    return { content: [{ type: "text", text: `Switched to tab ${targetId}` }] };
  }
);

// ── WAIT ─────────────────────────────────────────────────────────────────

server.tool("wait",
  "Wait for a specified number of milliseconds.",
  { ms: z.number().describe("Milliseconds to wait") },
  async ({ ms }) => {
    await new Promise(r => setTimeout(r, ms));
    return { content: [{ type: "text", text: `Waited ${ms}ms` }] };
  }
);

// ── CLICK ────────────────────────────────────────────────────────────────

server.tool("click",
  "Click at specific coordinates on the page.",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button")
  },
  async ({ x, y, button = "left" }) => {
    const c = await getClient();
    const btn = button === "left" ? "left" : button === "right" ? "right" : "middle";
    await c.Input.dispatchMouseEvent({ type: "mousePressed", x, y, button: btn, clickCount: 1 });
    await c.Input.dispatchMouseEvent({ type: "mouseReleased", x, y, button: btn, clickCount: 1 });
    return { content: [{ type: "text", text: `Clicked at (${x}, ${y}) with ${btn} button` }] };
  }
);

// ── KEYBOARD ─────────────────────────────────────────────────────────────

server.tool("press_key",
  "Press a key on the keyboard.",
  { key: z.string().describe("Key to press (e.g., 'Escape', 'Enter', 'a', 'w')") },
  async ({ key }) => {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: "keyDown", key });
    await c.Input.dispatchKeyEvent({ type: "keyUp", key });
    return { content: [{ type: "text", text: `Pressed key: ${key}` }] };
  }
);

// ── START ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
