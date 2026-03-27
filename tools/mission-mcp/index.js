// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MISSION MCP — Anorak Pro's hands on oasis.db
// Curator, reviewer, tester, and coder all use these tools to
// read/write mission state. The orchestrator stays thin.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "module";

// Resolve Prisma client from the main oasis project (where prisma generate runs)
const require = createRequire(import.meta.url);
const { PrismaClient } = require("../../node_modules/.prisma/client/default.js");

const prisma = new PrismaClient({
  datasources: { db: { url: `file:${process.env.OASIS_DB_PATH || "c:/af_oasis/prisma/data/oasis.db"}` } },
});

// Enable WAL mode for concurrent access (MCP server + Next.js both hit the same .db)
prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {});
prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000").catch(() => {});

const server = new McpServer({
  name: "mission-mcp",
  version: "1.0.0",
});

// ═══════════════════════════════════════════════════════════════════════════
// GET MISSION — read full mission row
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "get_mission",
  "Read a mission by ID. Returns full row including history, specs, scores.",
  { id: z.number().describe("Mission ID") },
  async ({ id }) => {
    const mission = await prisma.mission.findUnique({ where: { id } });
    if (!mission) return { content: [{ type: "text", text: `Mission ${id} not found` }] };
    return { content: [{ type: "text", text: JSON.stringify(mission, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// GET MISSIONS QUEUE — curator's priority list
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "get_missions_queue",
  "Read missions in the curator queue (immature + assigned to anorak). Sorted by curatorQueuePosition then priority.",
  {
    limit: z.number().optional().describe("Max missions to return (default 20)"),
    status: z.string().optional().describe("Filter by status (todo, wip, done)"),
  },
  async ({ limit = 20, status }) => {
    const where = {
      maturityLevel: { lt: 3 },
      assignedTo: { in: ["anorak", "anorak-pro"] },
      ...(status ? { status } : {}),
    };
    const missions = await prisma.mission.findMany({
      where,
      orderBy: [
        { curatorQueuePosition: "asc" },
        { priority: "desc" },
        { createdAt: "asc" },
      ],
      take: limit,
    });
    return { content: [{ type: "text", text: JSON.stringify(missions, null, 2) }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// MATURE MISSION — curator writes enrichment to DB
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "mature_mission",
  "Write curator enrichment to a mission. Sets carbon/silicon descriptions, flawless%, history entry, dharma paths. Assigns to carbondev for feedback.",
  {
    id: z.number().describe("Mission ID"),
    carbonDescription: z.string().describe("The war cry — emotional, vibes, analogies. Zero technical jargon."),
    siliconDescription: z.string().describe("The coder's bible — exact files, functions, edge cases, blast radius, step-by-step approach."),
    curatorMsg: z.string().describe("Curator's analysis — what was found in the code, risks, honest assessment."),
    silicondevMsg: z.string().describe("SiliconDev prediction — speak AS carbondev, predict what they'd say."),
    silicondevConfidence: z.number().min(0).max(1).describe("0.0-1.0 confidence in silicondev prediction"),
    flawlessPercent: z.number().min(0).max(100).describe("0-100 confidence that coder will pass reviewer ≥90 and tester 100% on first try"),
    dharmaPath: z.string().optional().describe("Comma-separated Noble Eightfold paths: view,intention,speech,action,livelihood,effort,mindfulness,concentration"),
    urgency: z.number().min(1).max(10).optional().describe("1-10, only if deep dive reveals misestimation"),
    easiness: z.number().min(1).max(10).optional().describe("1-10, only if deep dive reveals misestimation"),
    impact: z.number().min(1).max(10).optional().describe("1-10, only if deep dive reveals misestimation"),
  },
  async ({ id, carbonDescription, siliconDescription, curatorMsg, silicondevMsg, silicondevConfidence, flawlessPercent, dharmaPath, urgency, easiness, impact }) => {
    const mission = await prisma.mission.findUnique({ where: { id } });
    if (!mission) return { content: [{ type: "text", text: `Mission ${id} not found` }] };

    // Parse existing history
    // TODO: history grows unboundedly — add size cap or rotation when this becomes a problem
    let history = [];
    try { history = JSON.parse(mission.history || "[]"); } catch { history = []; }

    // Append curator entry
    history.push({
      timestamp: new Date().toISOString(),
      actor: "curator",
      action: "mature",
      curatorMsg,
      silicondevMsg,
      silicondevConfidence,
      flawlessPercent,
      fromLevel: mission.maturityLevel,
      toLevel: mission.maturityLevel, // Not bumped — carbondev decides
      dharma: dharmaPath || undefined,
    });

    // Build update data
    const updateData = {
      carbonDescription,
      siliconDescription,
      flawlessPercent,
      history: JSON.stringify(history),
      assignedTo: "carbondev",
      ...(dharmaPath ? { dharmaPath } : {}),
    };

    // Only update UEI if curator provides new values
    if (urgency !== undefined || easiness !== undefined || impact !== undefined) {
      const u = urgency ?? mission.urgency;
      const e = easiness ?? mission.easiness;
      const i = impact ?? mission.impact;
      Object.assign(updateData, {
        urgency: u, easiness: e, impact: i,
        priority: (u * e * i) / 125,
      });
    }

    await prisma.mission.update({ where: { id }, data: updateData });

    return { content: [{ type: "text", text: `Mission #${id} enriched. flawless: ${flawlessPercent}%. Assigned to carbondev.` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// REPORT REVIEW — reviewer writes score + findings
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "report_review",
  "Reviewer writes score and findings to mission. First-pass score is saved as RL signal.",
  {
    id: z.number().describe("Mission ID"),
    score: z.number().min(0).max(100).describe("Reviewer score 0-100"),
    findings: z.string().optional().describe("Summary of findings (HIGH/MEDIUM/LOW)"),
    discoveredIssues: z.array(z.object({
      name: z.string(),
      description: z.string(),
    })).optional().describe("Collateral bugs found — will be created as para missions"),
  },
  async ({ id, score, findings, discoveredIssues }) => {
    const mission = await prisma.mission.findUnique({ where: { id } });
    if (!mission) return { content: [{ type: "text", text: `Mission ${id} not found` }] };

    let history = [];
    try { history = JSON.parse(mission.history || "[]"); } catch { history = []; }

    history.push({
      timestamp: new Date().toISOString(),
      actor: "reviewer",
      action: "review",
      reviewerScore: score,
      comment: findings || undefined,
      discoveredIssues: discoveredIssues || undefined,
    });

    const isFirstPass = mission.reviewerScore === null;

    // Transactional: main update + para mission creates
    const txOps = [
      prisma.mission.update({
        where: { id },
        data: {
          history: JSON.stringify(history),
          ...(isFirstPass ? { reviewerScore: score } : {}),
        },
      }),
      ...(discoveredIssues || []).map(issue =>
        prisma.mission.create({
          data: {
            name: issue.name,
            description: issue.description,
            maturityLevel: 0,
            assignedTo: "anorak",
          },
        })
      ),
    ];
    await prisma.$transaction(txOps);

    return { content: [{ type: "text", text: `Review recorded: ${score}/100. ${isFirstPass ? "(first pass — saved as RL signal)" : "(re-review)"}${discoveredIssues?.length ? ` Created ${discoveredIssues.length} para missions.` : ""}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// REPORT TEST — tester writes score + valor
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "report_test",
  "Tester writes score, valor, and findings to mission. First-pass score is saved as RL signal.",
  {
    id: z.number().describe("Mission ID"),
    score: z.number().min(0).max(100).describe("Tester score 0-100 (tests passed / total × 100)"),
    valor: z.number().min(0).max(2).optional().describe("0.0-2.0 holistic quality assessment (only when score = 100)"),
    findings: z.string().optional().describe("Test results summary"),
    newTestsWritten: z.number().min(0).optional().describe("How many new test files/cases written"),
    discoveredIssues: z.array(z.object({
      name: z.string(),
      description: z.string(),
    })).optional().describe("Collateral bugs found — will be created as para missions"),
  },
  async ({ id, score, valor, findings, newTestsWritten, discoveredIssues }) => {
    const mission = await prisma.mission.findUnique({ where: { id } });
    if (!mission) return { content: [{ type: "text", text: `Mission ${id} not found` }] };

    let history = [];
    try { history = JSON.parse(mission.history || "[]"); } catch { history = []; }

    history.push({
      timestamp: new Date().toISOString(),
      actor: "tester",
      action: "test",
      testerScore: score,
      testerValor: valor || undefined,
      comment: findings || undefined,
      discoveredIssues: discoveredIssues || undefined,
    });

    const isFirstPass = mission.testerScore === null;

    // Transactional: main update + para mission creates
    const txOps = [
      prisma.mission.update({
        where: { id },
        data: {
          history: JSON.stringify(history),
          ...(isFirstPass ? { testerScore: score } : {}),
          ...(valor !== undefined ? { valor } : {}),
        },
      }),
      ...(discoveredIssues || []).map(issue =>
        prisma.mission.create({
          data: {
            name: issue.name,
            description: issue.description,
            maturityLevel: 0,
            assignedTo: "anorak",
          },
        })
      ),
    ];
    await prisma.$transaction(txOps);

    return { content: [{ type: "text", text: `Test recorded: ${score}/100${valor !== undefined ? `, valor: ${valor}` : ""}. ${isFirstPass ? "(first pass — saved as RL signal)" : "(re-test)"}${newTestsWritten ? ` ${newTestsWritten} new tests written.` : ""}${discoveredIssues?.length ? ` Created ${discoveredIssues.length} para missions.` : ""}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// CREATE MISSION — any agent can spawn para missions
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "create_mission",
  "Create a new mission (typically para/level 0). Used by reviewer/tester/curator to report discovered bugs and debt.",
  {
    name: z.string().describe("Short mission name"),
    description: z.string().optional().describe("What needs doing"),
    assignedTo: z.string().optional().describe("Who owns it (default: anorak)"),
    urgency: z.number().min(1).max(10).optional().describe("1-10 (default 5)"),
    easiness: z.number().min(1).max(10).optional().describe("1-10 (default 5)"),
    impact: z.number().min(1).max(10).optional().describe("1-10 (default 5)"),
  },
  async ({ name, description, assignedTo = "anorak", urgency = 5, easiness = 5, impact = 5 }) => {
    const priority = (urgency * easiness * impact) / 125;
    const mission = await prisma.mission.create({
      data: { name, description, assignedTo, urgency, easiness, impact, priority, maturityLevel: 0 },
    });
    return { content: [{ type: "text", text: `Created mission #${mission.id}: "${name}" (para 🌑, assigned to ${assignedTo})` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// MULTIMODAL — image, voice, video generation via Oasis API
// ═══════════════════════════════════════════════════════════════════════════

const OASIS_URL = process.env.OASIS_URL || "http://localhost:4516";

server.tool("generate_image",
  "Generate an image from a text prompt. Returns a URL. Models: gemini-flash, riverflow, seedream, flux-klein.",
  { prompt: z.string(), model: z.string().optional() },
  async ({ prompt, model }) => {
    try {
      const res = await fetch(`${OASIS_URL}/api/media/image`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model }) });
      const data = await res.json();
      if (!res.ok) return { content: [{ type: "text", text: `Image gen failed: ${data.error || res.status}` }] };
      const url = data.url?.startsWith('http') ? data.url : `${OASIS_URL}${data.url}`;
      return { content: [{ type: "text", text: `Image generated: ${url}` }] };
    } catch (e) { return { content: [{ type: "text", text: `Image gen error: ${e}` }] }; }
  }
);

server.tool("generate_voice",
  "Generate a voice note from text (ElevenLabs TTS). Voices: rachel, adam, sam, elli.",
  { text: z.string(), voice: z.string().optional() },
  async ({ text, voice }) => {
    try {
      const res = await fetch(`${OASIS_URL}/api/media/voice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }) });
      const data = await res.json();
      if (!res.ok) return { content: [{ type: "text", text: `Voice gen failed: ${data.error || res.status}` }] };
      const url = data.url?.startsWith('http') ? data.url : `${OASIS_URL}${data.url}`;
      return { content: [{ type: "text", text: `Voice note generated: ${url}` }] };
    } catch (e) { return { content: [{ type: "text", text: `Voice gen error: ${e}` }] }; }
  }
);

server.tool("generate_video",
  "Generate a video from a text prompt (fal.ai LTX 2.3). Submits job, polls until done.",
  { prompt: z.string(), duration: z.number().min(2).max(10).optional() },
  async ({ prompt, duration }) => {
    try {
      const submitRes = await fetch(`${OASIS_URL}/api/media/video`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, duration }) });
      const submitData = await submitRes.json();
      if (!submitRes.ok) return { content: [{ type: "text", text: `Video submit failed: ${submitData.error}` }] };
      if (submitData.status === "completed" && submitData.url) return { content: [{ type: "text", text: `Video generated: ${submitData.url}` }] };
      if (submitData.requestId) {
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const pollRes = await fetch(`${OASIS_URL}/api/media/video?requestId=${submitData.requestId}`);
          const pollData = await pollRes.json();
          if (pollData.status === "completed" && pollData.url) return { content: [{ type: "text", text: `Video generated: ${pollData.url}` }] };
          if (pollData.status === "failed") return { content: [{ type: "text", text: `Video failed: ${pollData.error}` }] };
        }
        return { content: [{ type: "text", text: "Video generation timed out" }] };
      }
      return { content: [{ type: "text", text: `Unexpected: ${JSON.stringify(submitData)}` }] };
    } catch (e) { return { content: [{ type: "text", text: `Video gen error: ${e}` }] }; }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════

const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown — disconnect Prisma on process exit
process.on("SIGTERM", () => { prisma.$disconnect().then(() => process.exit(0)); });
process.on("SIGINT", () => { prisma.$disconnect().then(() => process.exit(0)); });
