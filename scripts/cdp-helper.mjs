#!/usr/bin/env node
// CDP Helper — connects to Chrome via raw CDP WebSocket
// Usage: node scripts/cdp-helper.mjs <command> [args...]

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
const { default: WebSocket } = await import('../node_modules/.pnpm/ws@8.19.0/node_modules/ws/wrapper.mjs');

const SCREENSHOTS_DIR = 'test-screenshots/cdp';
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function getPageWsUrl() {
  const resp = await fetch('http://localhost:9222/json');
  const pages = await resp.json();
  const page = pages.find(p => p.type === 'page' && p.url.includes('localhost:4516')) || pages.find(p => p.type === 'page');
  if (!page) throw new Error('No page found');
  return page.webSocketDebuggerUrl;
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 1;
    const callbacks = new Map();

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg);
        callbacks.delete(msg.id);
      }
    });

    const send = (method, params = {}) => new Promise((res, rej) => {
      const mid = id++;
      callbacks.set(mid, (msg) => {
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (callbacks.has(mid)) { callbacks.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }
      }, 30000);
    });

    ws.on('open', () => resolve({ ws, send }));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 5000);
  });
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const wsUrl = await getPageWsUrl();
  const { ws, send } = await cdpConnect(wsUrl);

  try {
    switch (cmd) {
      case 'screenshot': {
        const name = args[0] || `shot-${Date.now()}`;
        const result = await send('Page.captureScreenshot', { format: 'png' });
        const path = join(SCREENSHOTS_DIR, `${name}.png`);
        writeFileSync(path, Buffer.from(result.data, 'base64'));
        console.log(`Screenshot saved: ${path}`);
        break;
      }
      case 'exec': {
        const js = args.join(' ');
        const result = await send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) {
          console.error('JS Error:', result.exceptionDetails.exception?.description || 'unknown');
        } else {
          console.log(JSON.stringify(result.result?.value, null, 2));
        }
        break;
      }
      case 'click': {
        const x = parseInt(args[0]), y = parseInt(args[1]);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        console.log(`Clicked (${x}, ${y})`);
        break;
      }
      case 'press': {
        const keyMap = {
          'Enter': { key: 'Enter', code: 'Enter', wvk: 13 },
          'Escape': { key: 'Escape', code: 'Escape', wvk: 27 },
          'Tab': { key: 'Tab', code: 'Tab', wvk: 9 },
          'Backspace': { key: 'Backspace', code: 'Backspace', wvk: 8 },
          'Space': { key: ' ', code: 'Space', wvk: 32 },
        };
        const k = args[0];
        const m = keyMap[k] || { key: k, code: `Key${k.toUpperCase()}`, wvk: k.charCodeAt(0) };
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: m.key, code: m.code, windowsVirtualKeyCode: m.wvk, nativeVirtualKeyCode: m.wvk });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: m.key, code: m.code, windowsVirtualKeyCode: m.wvk, nativeVirtualKeyCode: m.wvk });
        console.log(`Pressed ${k}`);
        break;
      }
      case 'type': {
        const text = args.join(' ');
        for (const c of text) {
          await send('Input.dispatchKeyEvent', { type: 'char', text: c });
        }
        console.log(`Typed: ${text}`);
        break;
      }
      case 'wait': {
        const ms = parseInt(args[0]) || 1000;
        await new Promise(r => setTimeout(r, ms));
        console.log(`Waited ${ms}ms`);
        break;
      }
      case 'size': {
        const layout = await send('Page.getLayoutMetrics');
        const vp = layout.cssVisualViewport;
        console.log(`Viewport: ${vp.clientWidth}x${vp.clientHeight}`);
        break;
      }
      default:
        console.error(`Unknown: ${cmd}. Use: screenshot, exec, click, press, type, wait, size`);
        process.exit(1);
    }
  } finally {
    ws.close();
    process.exit(0);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
