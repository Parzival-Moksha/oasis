#!/usr/bin/env node
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MISSION DB — Direct SQLite backdoor for when the dev server is down
// Usage:
//   node tools/mission-db.mjs list                    — list todo missions
//   node tools/mission-db.mjs get <id>                — full mission row
//   node tools/mission-db.mjs queue                   — curator queue (immature)
//   node tools/mission-db.mjs mature <id> <json>      — write curator enrichment
//   node tools/mission-db.mjs create <json>           — create new mission
//   node tools/mission-db.mjs update <id> <json>      — update any fields
//   node tools/mission-db.mjs sql "<query>"           — raw SQL (read-only)
//
// No dev server needed. No MCP needed. Just Prisma + SQLite.
// Any agent can use this as a subprocess when MCP tools are unavailable.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { createRequire } from "module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(TOOL_DIR, "../prisma/data/oasis.db");
const DB_PATH = process.env.OASIS_DB_PATH || DEFAULT_DB_PATH;
const DB_URL = DB_PATH.startsWith("file:") ? DB_PATH : `file:${DB_PATH.replace(/\\/g, "/")}`;

const { PrismaClient } = require("../node_modules/.prisma/client/default.js");
const prisma = new PrismaClient({
  datasources: { db: { url: DB_URL } },
});

// WAL mode for concurrent access
await prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {});
await prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000").catch(() => {});

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    // ═══════════════════════════════════════════════════════════════════
    case "list": {
      const status = args[0] || "todo";
      const missions = await prisma.mission.findMany({
        where: status === "all" ? {} : { status },
        orderBy: [{ priority: "desc" }, { id: "desc" }],
        select: { id: true, name: true, status: true, maturityLevel: true, assignedTo: true, priority: true, flawlessPercent: true },
      });
      console.log(JSON.stringify(missions, null, 2));
      break;
    }

    // ═══════════════════════════════════════════════════════════════════
    case "get": {
      const id = parseInt(args[0]);
      if (!id) throw new Error("Usage: get <id>");
      const mission = await prisma.mission.findUnique({ where: { id } });
      if (!mission) throw new Error(`Mission ${id} not found`);
      // Parse history for readability
      if (mission.history) {
        try { mission.history = JSON.parse(mission.history); } catch {}
      }
      console.log(JSON.stringify(mission, null, 2));
      break;
    }

    // ═══════════════════════════════════════════════════════════════════
    case "queue": {
      const missions = await prisma.mission.findMany({
        where: { maturityLevel: { lt: 3 }, status: "todo" },
        orderBy: [{ curatorQueuePosition: "asc" }, { priority: "desc" }],
        take: parseInt(args[0]) || 20,
        select: { id: true, name: true, maturityLevel: true, assignedTo: true, priority: true, flawlessPercent: true, description: true },
      });
      console.log(JSON.stringify(missions, null, 2));
      break;
    }

    // ═══════════════════════════════════════════════════════════════════
    case "mature": {
      const id = parseInt(args[0]);
      if (!id) throw new Error("Usage: mature <id> <json>");
      const data = JSON.parse(args.slice(1).join(" "));
      const { carbonDescription, siliconDescription, curatorMsg, silicondevMsg, silicondevConfidence, flawlessPercent, dharmaPath, urgency, easiness, impact } = data;

      const mission = await prisma.mission.findUnique({ where: { id } });
      if (!mission) throw new Error(`Mission ${id} not found`);

      let history = [];
      try { history = JSON.parse(mission.history || "[]"); } catch { history = []; }

      history.push({
        timestamp: new Date().toISOString(),
        actor: "curator",
        action: "mature",
        curatorMsg,
        silicondevMsg,
        silicondevConfidence,
        flawlessPercent,
        fromLevel: mission.maturityLevel,
        toLevel: mission.maturityLevel,
        dharma: dharmaPath || undefined,
      });

      const updateData = {
        carbonDescription,
        siliconDescription,
        flawlessPercent,
        history: JSON.stringify(history),
        assignedTo: "carbondev",
        ...(dharmaPath ? { dharmaPath } : {}),
      };

      if (urgency !== undefined || easiness !== undefined || impact !== undefined) {
        const u = urgency ?? mission.urgency;
        const e = easiness ?? mission.easiness;
        const i = impact ?? mission.impact;
        Object.assign(updateData, { urgency: u, easiness: e, impact: i, priority: (u * e * i) / 125 });
      }

      await prisma.mission.update({ where: { id }, data: updateData });
      console.log(`Mission #${id} enriched. flawless: ${flawlessPercent}%. Assigned to carbondev.`);
      break;
    }

    // ═══════════════════════════════════════════════════════════════════
    case "create": {
      const data = JSON.parse(args.join(" "));
      const { name, description, assignedTo = "anorak", urgency = 5, easiness = 5, impact = 5 } = data;
      const priority = (urgency * easiness * impact) / 125;
      const mission = await prisma.mission.create({
        data: { name, description, assignedTo, urgency, easiness, impact, priority, maturityLevel: 0 },
      });
      console.log(`Created mission #${mission.id}: "${name}" (para, assigned to ${assignedTo})`);
      break;
    }

    // ═══════════════════════════════════════════════════════════════════
    case "update": {
      const id = parseInt(args[0]);
      if (!id) throw new Error("Usage: update <id> <json>");
      const data = JSON.parse(args.slice(1).join(" "));
      await prisma.mission.update({ where: { id }, data });
      console.log(`Mission #${id} updated.`);
      break;
    }

    // ═══════════════════════════════════════════════════════════════════
    case "sql": {
      const query = args.join(" ");
      if (!query) throw new Error("Usage: sql \"<query>\"");
      const result = await prisma.$queryRawUnsafe(query);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    // ═══════════════════════════════════════════════════════════════════
    default:
      console.log(`Mission DB — Direct SQLite backdoor
Usage:
  list [status]        List missions (default: todo, or 'all')
  get <id>             Full mission row with parsed history
  queue [limit]        Curator queue (immature todos)
  mature <id> <json>   Write curator enrichment
  create <json>        Create new mission
  update <id> <json>   Update any fields
  sql "<query>"        Raw SQL query`);
  }
} catch (err) {
  console.error("Error:", err.message || err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
