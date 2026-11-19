// A fake `ssh` for testing remote Hermes agents (src/hermes.js, `remote`) without a second machine. It takes the
// arguments the engine gives ssh, does the -R reverse forward for real (on this machine), and runs FAKE_SSH_REMOTE
// (a JSON argv, e.g. node fake-acp.mjs <dir>) as "the remote command", wired to its stdin/stdout/stderr.
// Used by scripts/hermes-remote-smoke.mjs, through OASIS_SSH='["<node>", "<this file>"]'.
//
// FAKE_SSH_DIR holds: ssh-calls.jsonl (every call: host, the remote command line, the options); `down` (while it
// exists, a call fails at once like an unreachable host, exit 255); `drop` (when it appears, a running line dies like
// a lost network, exit 255).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = process.env.FAKE_SSH_DIR;
const WITH_VALUE = new Set(['-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w']);
const args = process.argv.slice(2);
const options = [];
const forwards = [];
let i = 0;
for (; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('-')) break;
  if (WITH_VALUE.has(a)) { const v = args[++i]; options.push([a, v]); if (a === '-R') forwards.push(v); } else options.push([a]);
}
const host = args[i];
const remote = args.slice(i + 1).join(' ');
// `ssh -G <host>` prints the resolved config without connecting (hermes.js reads the HostName for HostKeyAlias).
if (options.some(([o]) => o === '-G')) { process.stdout.write(`hostname ${host}.fake.local\nuser fake\n`); process.exit(0); }
fs.appendFileSync(path.join(dir, 'ssh-calls.jsonl'), JSON.stringify({ host, remote, options, at: Date.now() }) + '\n');

if (fs.existsSync(path.join(dir, 'down'))) {
  process.stderr.write(`ssh: connect to host ${host} port 22: Connection timed out\n`);
  process.exit(255);
}

// -R [bind:]port:host:hostport — "the remote machine" is this one, so it listens here, on the port shifted by
// FAKE_PORT_SHIFT (fake-acp.mjs shifts the URLs it is given the same way): its port numbers are not ours.
const SHIFT = Number(process.env.FAKE_PORT_SHIFT) || 0;
const servers = [];
for (const spec of forwards) {
  const parts = spec.split(':');
  const [listenPort, toHost, toPort] = parts.length === 4 ? [parts[1], parts[2], parts[3]] : parts;
  const srv = net.createServer((sock) => {
    const up = net.connect(Number(toPort), toHost);
    sock.pipe(up).pipe(sock);
    up.on('error', () => sock.destroy());
    sock.on('error', () => up.destroy());
  });
  srv.on('error', () => process.stderr.write(`Warning: remote port forwarding failed for listen port ${listenPort}\n`));
  srv.listen(Number(listenPort) + SHIFT, '127.0.0.1');
  servers.push(srv);
}

// The remote shell's part of the line: it prints the home folder (OASIS_CWD) before it becomes `hermes acp`.
if (/OASIS_CWD/.test(remote)) process.stderr.write('OASIS_CWD /home/fake\n');
const argv = JSON.parse(process.env.FAKE_SSH_REMOTE || '[]');
const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.stdin.on('error', () => {});
const end = (code) => { for (const s of servers) s.close(); process.exit(code); };
child.on('exit', (code) => end(code ?? 0));
const watch = setInterval(() => {
  if (fs.existsSync(path.join(dir, 'drop'))) {
    clearInterval(watch);
    process.stderr.write(`Timeout, server ${host} not responding.\n`);
    child.kill();
    end(255);
  }
}, 100);
watch.unref();
