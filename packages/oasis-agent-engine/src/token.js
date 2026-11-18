// The local key. A package that runs agents on someone's machine must not obey whoever can reach its port:
// another user of the same computer, or a page in another browser tab on some other localhost port.
//
// scripts/oasis.mjs makes the key once (~/.oasis/token, readable by its owner only), hands it to both servers
// as OASIS_LOCAL_TOKEN and opens the village with it; the page keeps it in a cookie and sends it along.
// With OASIS_LOCAL_TOKEN unset (the workshop as it always ran) nothing is asked for: loopback Host and Origin
// stay the only checks.
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const tokenFile = () => process.env.OASIS_TOKEN_FILE || path.join(process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis'), 'token');

/** The key the servers were started with; '' means no key is asked for. */
export const requiredToken = (env = process.env) => (env.OASIS_LOCAL_TOKEN || '').trim();

/** The key for a client on this machine (a script an agent runs): from its environment, else the file. */
export function clientToken(env = process.env) {
  if (env.OASIS_LOCAL_TOKEN) return env.OASIS_LOCAL_TOKEN.trim();
  try { return fs.readFileSync(tokenFile(), 'utf8').trim(); } catch { return ''; }
}

/** Headers for a request to the engine or the page server from this machine. */
export function tokenHeaders(env = process.env) {
  const token = clientToken(env);
  return token ? { 'x-oasis-token': token } : {};
}

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The key a request carries: `Authorization: Bearer`, `x-oasis-token`, or `?token=` (WebSocket and file links). */
export function tokenOf(req, url) {
  const auth = String(req.headers?.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.headers?.['x-oasis-token']) return String(req.headers['x-oasis-token']).trim();
  return url?.searchParams?.get('token') || '';
}

/** True when no key is required, or the request carries the right one. */
export function tokenAllowed(req, url, required = requiredToken()) {
  if (!required) return true;
  const given = tokenOf(req, url);
  return Boolean(given) && same(given, required);
}
