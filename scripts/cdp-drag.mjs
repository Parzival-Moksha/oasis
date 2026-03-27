#!/usr/bin/env node
// CDP drag helper — simulates mouse drag for orbit/look testing
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
const { default: WebSocket } = await import('../node_modules/.pnpm/ws@8.19.0/node_modules/ws/wrapper.mjs');

async function main() {
  const resp = await fetch('http://localhost:9222/json');
  const pages = await resp.json();
  const page = pages.find(p => p.type === 'page' && p.url.includes('localhost:4516'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  let id = 1;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = id++;
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === mid) { ws.off('message', handler); if (msg.error) rej(new Error(msg.error.message)); else res(msg.result); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => rej(new Error('timeout')), 10000);
  });

  const [action] = process.argv.slice(2);

  if (action === 'orbit-drag') {
    // Left-click drag to orbit
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 400, button: 'left', clickCount: 1 });
    for (let i = 0; i < 20; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 500 + i * 5, y: 400 - i * 2, button: 'left' });
      await new Promise(r => setTimeout(r, 16));
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 360, button: 'left' });
    console.log('Orbit drag complete');
  } else if (action === 'screenshot') {
    const name = process.argv[3] || 'drag-test';
    const result = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync('test-screenshots/cdp', { recursive: true });
    writeFileSync(join('test-screenshots/cdp', `${name}.png`), Buffer.from(result.data, 'base64'));
    console.log(`Screenshot: test-screenshots/cdp/${name}.png`);
  } else if (action === 'eval') {
    const js = process.argv.slice(3).join(' ');
    const result = await send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(result.result?.value));
  }

  ws.close();
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
