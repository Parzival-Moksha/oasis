// CDP Oasis Player — direct Chrome DevTools Protocol interaction
import CDP from 'chrome-remote-interface';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.resolve(TOOL_DIR, '../../test-screenshots');
mkdirSync(SHOT_DIR, { recursive: true });
let shotN = 0;

async function play() {
  const targets = await CDP.List({ host: 'localhost', port: 9222 });
  const target = targets.find(t => t.type === 'page' && t.url.includes('4516')) || targets.find(t => t.type === 'page');
  if (!target) throw new Error('No Oasis tab found');

  const c = await CDP({ target: target.id, host: 'localhost', port: 9222 });
  await c.Page.enable();
  await c.Runtime.enable();
  // Input domain doesn't need enable()

  async function screenshot(label) {
    shotN++;
    const name = `${String(shotN).padStart(2,'0')}-${label}.png`;
    const { data } = await c.Page.captureScreenshot({ format: 'png' });
    writeFileSync(`${SHOT_DIR}/${name}`, Buffer.from(data, 'base64'));
    console.log(`SHOT: ${name}`);
    return name;
  }

  async function wait(ms) { await new Promise(r => setTimeout(r, ms)); }

  async function click(x, y, btn = 'left') {
    await c.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: btn, clickCount: 1 });
    await c.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: btn, clickCount: 1 });
  }

  async function drag(fx, fy, tx, ty, steps = 25, btn = 'left') {
    await c.Input.dispatchMouseEvent({ type: 'mousePressed', x: fx, y: fy, button: btn, clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x: fx+(tx-fx)*t, y: fy+(ty-fy)*t, button: btn });
    }
    await c.Input.dispatchMouseEvent({ type: 'mouseReleased', x: tx, y: ty, button: btn, clickCount: 1 });
  }

  async function keyDown(key) { await c.Input.dispatchKeyEvent({ type: 'keyDown', key }); }
  async function keyUp(key) { await c.Input.dispatchKeyEvent({ type: 'keyUp', key }); }
  async function press(key) { await keyDown(key); await keyUp(key); }

  async function holdKeys(keys, ms) {
    for (const k of keys) await keyDown(k);
    await wait(ms);
    for (const k of keys) await keyUp(k);
  }

  async function evalJS(code) {
    const result = await c.Runtime.evaluate({ expression: code, awaitPromise: true, returnByValue: true });
    return result.result?.value;
  }

  // ═══════════════════════════════════════════════════════════════
  // LET'S PLAY THE OASIS
  // ═══════════════════════════════════════════════════════════════

  console.log('\n╔══════════════════════════════════╗');
  console.log('║  PLAYING THE OASIS via CDP       ║');
  console.log('╚══════════════════════════════════╝\n');

  await wait(2000);
  await screenshot('home');

  // 1. ORBIT — right-click drag to rotate the view
  console.log('>> Orbiting camera (right-drag)...');
  await drag(960, 540, 600, 400, 30, 'right');
  await wait(500);
  await screenshot('orbit-right');

  await drag(600, 400, 1100, 350, 30, 'right');
  await wait(500);
  await screenshot('orbit-left');

  // 2. ZOOM — scroll wheel
  console.log('>> Zooming in...');
  for (let i = 0; i < 5; i++) {
    await c.Input.dispatchMouseEvent({ type: 'mouseWheel', x: 960, y: 540, deltaX: 0, deltaY: -120 });
    await wait(100);
  }
  await wait(500);
  await screenshot('zoom-in');

  // Zoom back out
  for (let i = 0; i < 8; i++) {
    await c.Input.dispatchMouseEvent({ type: 'mouseWheel', x: 960, y: 540, deltaX: 0, deltaY: 120 });
    await wait(100);
  }
  await wait(500);
  await screenshot('zoom-out');

  // 3. Click on an object (the VIBEHACK text is usually center-left)
  console.log('>> Clicking on objects...');
  await click(400, 350);
  await wait(1000);
  await screenshot('click-object');

  // 4. Open WizardConsole (sparkles button at ~112, 36)
  console.log('>> Opening WizardConsole...');
  await click(132, 36);
  await wait(1500);
  await screenshot('wizcon-open');

  // 5. Close WizCon, try Anorak
  await click(132, 36);
  await wait(500);
  console.log('>> Opening Anorak...');
  await click(372, 36);
  await wait(2000);
  await screenshot('anorak-open');

  // Close anorak
  await click(372, 36);
  await wait(500);

  // 6. Try TPS mode — click canvas to enter, then WASD
  console.log('>> Attempting TPS mode...');
  // First check current camera mode
  const mode = await evalJS('document.querySelector("[data-camera-mode]")?.dataset?.cameraMode || "unknown"');
  console.log('Camera mode:', mode);

  // Click canvas to potentially enter pointer lock
  await click(960, 540);
  await wait(500);

  // Try WASD movement
  console.log('>> WASD walk forward...');
  await holdKeys(['w'], 1500);
  await wait(300);
  await screenshot('walked-forward');

  await holdKeys(['a'], 800);
  await wait(300);
  await screenshot('walked-left');

  await holdKeys(['s'], 1000);
  await wait(300);
  await screenshot('walked-back');

  // Escape pointer lock if active
  await press('Escape');
  await wait(500);
  await screenshot('final-state');

  // 7. Get some diagnostic info
  const info = await evalJS(`JSON.stringify({
    objects: document.querySelectorAll('mesh, group').length,
    buttons: document.querySelectorAll('button').length,
    fps: document.querySelector('[class*="fps"]')?.textContent || 'unknown'
  })`);
  console.log('Diagnostics:', info);

  console.log('\n╔══════════════════════════════════╗');
  console.log('║  DONE — check test-screenshots/  ║');
  console.log('╚══════════════════════════════════╝\n');

  await c.close();
}

play().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
