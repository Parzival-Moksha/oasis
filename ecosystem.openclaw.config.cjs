/**
 * PM2 ecosystem config for openclaw.04515.xyz.
 *
 * Three processes, all managed by PM2:
 *   openclaw-oasis-web    → Next.js app, listens on 127.0.0.1:4516
 *   openclaw-oasis-relay  → hosted relay sidecar (OpenClaw/Hermes WSS), 127.0.0.1:4517
 *   openclaw-oasis-room   → Colyseus multiplayer room sidecar, 127.0.0.1:4519
 *
 * Nginx terminates TLS on 443, routes:
 *   /relay     → 127.0.0.1:4517   (WSS upgrade — OpenClaw/Hermes)
 *   /rooms/*   → 127.0.0.1:4519   (WSS upgrade — Colyseus multiplayer)
 *   anything   → 127.0.0.1:4516   (Next)
 *
 * Required env (set in the shell PM2 inherits, in /etc/environment, or
 * via `pm2 start ... --update-env` after `export`-ing them):
 *
 *   OASIS_MODE=hosted
 *   RELAY_SIGNING_KEY=<long random string; openssl rand -base64 48>
 *   RELAY_ALLOWED_ORIGINS=https://openclaw.04515.xyz
 *   DATABASE_URL=file:/srv/af_oasis/prisma/data/oasis.db
 *
 * Optional:
 *   RELAY_LOG_FRAMES=1     # log every envelope type at info (debug only)
 *
 * Run:
 *   pm2 start ecosystem.openclaw.config.cjs
 *   pm2 logs openclaw-oasis-room
 *   pm2 save
 *   pm2 startup       # one-time, hooks PM2 into systemd
 */

module.exports = {
  apps: [
    {
      name: 'openclaw-oasis-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 4516',
      // Adjust if you check this repo out somewhere else on the box.
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        OASIS_MODE: 'hosted',
      },
      max_memory_restart: '1G',
      autorestart: true,
      restart_delay: 2000,
      out_file: 'logs/web.out.log',
      error_file: 'logs/web.err.log',
      time: true,
    },
    {
      name: 'openclaw-oasis-relay',
      script: 'scripts/openclaw-relay.mjs',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        OASIS_MODE: 'hosted',
        RELAY_PORT: '4517',
      },
      max_memory_restart: '256M',
      autorestart: true,
      restart_delay: 2000,
      out_file: 'logs/relay.out.log',
      error_file: 'logs/relay.err.log',
      time: true,
    },
    {
      // Colyseus multiplayer room sidecar. Compiled with `pnpm --dir
      // packages/oasis-room-server build` before PM2 reload — see
      // scripts/deploy-openclaw-parzival.mjs.
      name: 'openclaw-oasis-room',
      script: 'packages/oasis-room-server/dist/server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        OASIS_MODE: 'hosted',
        OASIS_ROOM_PORT: '4519',
      },
      max_memory_restart: '512M',
      autorestart: true,
      restart_delay: 2000,
      out_file: 'logs/room.out.log',
      error_file: 'logs/room.err.log',
      time: true,
    },
  ],
}
