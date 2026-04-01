// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// GAMER MCP — The Oasis Eyes
// Tester and Gamer agents see the Oasis through Chrome DevTools Protocol.
// screenshot, execute_js, navigate, click, type, key_down/up, mouse, scroll
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

// ── KEY DOWN / UP (for holding keys — WASD movement) ────────────────────

server.tool("key_down",
  "Press and HOLD a key (use key_up to release). For WASD movement, pointer lock camera, etc.",
  { key: z.string().describe("Key to hold (e.g., 'w', 'a', 's', 'd', 'Shift')") },
  async ({ key }) => {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: "keyDown", key });
    return { content: [{ type: "text", text: `Key down: ${key}` }] };
  }
);

server.tool("key_up",
  "Release a held key.",
  { key: z.string().describe("Key to release") },
  async ({ key }) => {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: "keyUp", key });
    return { content: [{ type: "text", text: `Key up: ${key}` }] };
  }
);

// ── MOUSE DRAG (orbit camera, resize, drag objects) ─────────────────────

server.tool("mouse_drag",
  "Click and drag from one point to another. For orbit camera rotation, object dragging, panel resize.",
  {
    fromX: z.number().describe("Start X"),
    fromY: z.number().describe("Start Y"),
    toX: z.number().describe("End X"),
    toY: z.number().describe("End Y"),
    steps: z.number().optional().describe("Interpolation steps (default 20)"),
    button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default left)")
  },
  async ({ fromX, fromY, toX, toY, steps = 20, button = "left" }) => {
    const c = await getClient();
    await c.Input.dispatchMouseEvent({ type: "mousePressed", x: fromX, y: fromY, button, clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = fromX + (toX - fromX) * t;
      const y = fromY + (toY - fromY) * t;
      await c.Input.dispatchMouseEvent({ type: "mouseMoved", x, y, button });
    }
    await c.Input.dispatchMouseEvent({ type: "mouseReleased", x: toX, y: toY, button, clickCount: 1 });
    return { content: [{ type: "text", text: `Dragged from (${fromX},${fromY}) to (${toX},${toY}) in ${steps} steps` }] };
  }
);

// ── MOUSE MOVE (hover, pointer lock camera look) ────────────────────────

server.tool("mouse_move",
  "Move the mouse to coordinates. Dispatches mouseMoved events — works for hover effects and pointer-lock camera.",
  {
    x: z.number().describe("Target X"),
    y: z.number().describe("Target Y"),
  },
  async ({ x, y }) => {
    const c = await getClient();
    await c.Input.dispatchMouseEvent({ type: "mouseMoved", x, y });
    return { content: [{ type: "text", text: `Mouse moved to (${x}, ${y})` }] };
  }
);

// ── SCROLL (zoom in orbit mode) ─────────────────────────────────────────

server.tool("scroll",
  "Mouse wheel scroll at coordinates. Positive deltaY = scroll down / zoom out, negative = zoom in.",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    deltaY: z.number().describe("Scroll amount (negative=up/zoom-in, positive=down/zoom-out)")
  },
  async ({ x, y, deltaY }) => {
    const c = await getClient();
    await c.Input.dispatchMouseEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY });
    return { content: [{ type: "text", text: `Scrolled ${deltaY > 0 ? 'down' : 'up'} at (${x}, ${y})` }] };
  }
);

// ── TYPE TEXT (fill inputs, chat) ───────────────────────────────────────

server.tool("type_text",
  "Type a string of text character by character. For chat inputs, search fields, etc.",
  { text: z.string().describe("Text to type") },
  async ({ text }) => {
    const c = await getClient();
    for (const char of text) {
      await c.Input.dispatchKeyEvent({ type: "keyDown", text: char, key: char });
      await c.Input.dispatchKeyEvent({ type: "keyUp", key: char });
    }
    return { content: [{ type: "text", text: `Typed: "${text}"` }] };
  }
);

// ── START ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
