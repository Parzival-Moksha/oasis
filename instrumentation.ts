// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Next.js instrumentation — runs once on Node startup, before route code.
// ─═̷─═̷─🌐─═̷─═̷─ Force DNS resolution to prefer IPv4 for outbound fetches.
//
// Symptom this fixes: Windows Node dev servers sometimes hit
// `getaddrinfo ENOTFOUND <hostname>` on calls to api.elevenlabs.io,
// queue.fal.run, openrouter.ai etc., even when those hostnames resolve
// fine from curl/nslookup on the same machine. Root cause: libuv's DNS
// resolver can prefer AAAA records first; on half-broken IPv6 paths the
// lookup fails fast without trying IPv4. curl falls back transparently;
// Node's fetch (undici) does not.
//
// IMPORTANT: requires `experimental.instrumentationHook: true` in
// next.config.mjs on Next 14.x (auto-loads on Next 15+).
//
// Belt-and-suspenders: we call setDefaultResultOrder both at module load
// AND inside register(). Module-load fires when this file is first imported
// by Next's bootstrap; register() is the documented entry point. If either
// path runs, the DNS preference is set process-wide.
//
// Reference: https://nodejs.org/api/dns.html#dnssetdefaultresultorderorder
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

let dnsPinned = false

function pinDnsToIpv4(source: string): void {
  if (dnsPinned) return
  if (typeof process === 'undefined' || process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dns = require('node:dns') as typeof import('node:dns')
    dns.setDefaultResultOrder('ipv4first')
    dnsPinned = true
    console.info(`[instrumentation] DNS result order pinned to ipv4first via ${source} (avoids ENOTFOUND on half-IPv6 networks)`)
  } catch (err) {
    console.warn(`[instrumentation] failed to set DNS ipv4first via ${source}:`, err)
  }
}

// Module-load attempt — runs the first time Next imports this file.
pinDnsToIpv4('module-load')

export async function register() {
  pinDnsToIpv4('register-hook')
}
