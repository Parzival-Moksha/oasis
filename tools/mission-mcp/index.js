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
    executionMode: z.enum(["crispr", "builder"]).optional().describe("crispr = worktree (touches Next.js module graph), builder = direct (safe files only)"),
  },
  async ({ id, carbonDescription, siliconDescription, curatorMsg, silicondevMsg, silicondevConfidence, flawlessPercent, dharmaPath, urgency, easiness, impact, executionMode }) => {
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
      ...(executionMode ? { executionMode } : {}),
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
// REPORT GAME — gamer writes score + verdict
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "report_game",
  "Gamer writes score, verdict, and findings to mission. First-pass score is saved as RL signal.",
  {
    id: z.number().describe("Mission ID"),
    score: z.number().min(0).max(100).describe("Gamer score 0-100 (phases passed / total × 100)"),
    verdict: z.enum(["PASS", "FAIL", "BLOCKED"]).describe("Overall gameplay verdict"),
    findings: z.string().optional().describe("Gameplay findings summary"),
    screenshots: z.array(z.string()).optional().describe("Screenshot paths or descriptions"),
    discoveredIssues: z.array(z.object({
      name: z.string(),
      description: z.string(),
    })).optional().describe("Collateral bugs found — will be created as para missions"),
  },
  async ({ id, score, verdict, findings, screenshots, discoveredIssues }) => {
    const mission = await prisma.mission.findUnique({ where: { id } });
    if (!mission) return { content: [{ type: "text", text: `Mission ${id} not found` }] };

    let history = [];
    try { history = JSON.parse(mission.history || "[]"); } catch { history = []; }

    history.push({
      timestamp: new Date().toISOString(),
      actor: "gamer",
      action: "game",
      gamerScore: score,
      gamerVerdict: verdict,
      comment: findings || undefined,
      screenshots: screenshots || undefined,
      discoveredIssues: discoveredIssues || undefined,
    });

    const isFirstPass = mission.gamerScore === null;

    const txOps = [
      prisma.mission.update({
        where: { id },
        data: {
          history: JSON.stringify(history),
          gamerVerdict: verdict,
          ...(isFirstPass ? { gamerScore: score } : {}),
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

    return { content: [{ type: "text", text: `Game recorded: ${score}/100, verdict: ${verdict}. ${isFirstPass ? "(first pass — saved as RL signal)" : "(re-game)"}${discoveredIssues?.length ? ` Created ${discoveredIssues.length} para missions.` : ""}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// CREATE PARA MISSION — quick bug report, minimal fields, level 0
// Used by reviewer, tester, gamer, coder when they discover collateral bugs
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "create_para_mission",
  "Create a para (🌑 level 0) mission — a quick bug/debt report. Minimal fields. For any agent that spots a collateral issue.",
  {
    name: z.string().describe("Short mission name — one-liner"),
    description: z.string().optional().describe("What's wrong, vibes, what you saw"),
    urgency: z.number().min(1).max(10).optional().describe("1-10 (default 5)"),
    impact: z.number().min(1).max(10).optional().describe("1-10 (default 5)"),
  },
  async ({ name, description, urgency = 5, impact = 5 }) => {
    const easiness = 5;
    const priority = (urgency * easiness * impact) / 125;
    const mission = await prisma.mission.create({
      data: { name, description, assignedTo: "anorak", urgency, easiness, impact, priority, maturityLevel: 0 },
    });
    return { content: [{ type: "text", text: `Created para mission #${mission.id}: "${name}" (🌑 level 0, assigned to anorak)` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// CREATE PASHYANTI MISSION — enriched mission with specs, level 1
// Used by curator, Claude Code, Anorak, Anorak Pro after deep analysis
// ═══════════════════════════════════════════════════════════════════════════

server.tool(
  "create_pashyanti_mission",
  "Create a pashyanti (🌒 level 1) mission — enriched with specs, scoring, and curator analysis. For agents that have done deep codebase investigation.",
  {
    name: z.string().describe("Short mission name"),
    description: z.string().optional().describe("What needs doing"),
    carbonDescription: z.string().optional().describe("War cry — emotional, vibes, analogies. Zero technical jargon."),
    siliconDescription: z.string().optional().describe("Coder's bible — exact files, functions, edge cases, blast radius."),
    acceptanceCriteria: z.string().optional().describe("What 'done' means"),
    curatorMsg: z.string().optional().describe("Curator analysis — what was found, risks, assessment"),
    silicondevMsg: z.string().optional().describe("SiliconDev prediction — speak AS carbondev"),
    silicondevConfidence: z.number().min(0).max(1).optional().describe("0.0-1.0 confidence in silicondev prediction"),
    flawlessPercent: z.number().min(0).max(100).optional().describe("0-100 execution confidence"),
    dharmaPath: z.string().optional().describe("Comma-separated: view,intention,speech,action,livelihood,effort,mindfulness,concentration"),
    executionMode: z.enum(["crispr", "builder"]).optional().describe("crispr = worktree (touches Next.js module graph), builder = direct (safe files only)"),
    urgency: z.number().min(1).max(10).optional().describe("1-10 (default 5)"),
    easiness: z.number().min(1).max(10).optional().describe("1-10 (default 5)"),
    impact: z.number().min(1).max(10).optional().describe("1-10 (default 5)"),
  },
  async ({ name, description, carbonDescription, siliconDescription, acceptanceCriteria, curatorMsg, silicondevMsg, silicondevConfidence, flawlessPercent, dharmaPath, executionMode, urgency = 5, easiness = 5, impact = 5 }) => {
    const priority = (urgency * easiness * impact) / 125;

    let history = [];
    if (curatorMsg || silicondevMsg) {
      history.push({
        timestamp: new Date().toISOString(),
        actor: "curator",
        action: "create-pashyanti",
        curatorMsg: curatorMsg || undefined,
        silicondevMsg: silicondevMsg || undefined,
        silicondevConfidence: silicondevConfidence || undefined,
      });
    }

    const mission = await prisma.mission.create({
      data: {
        name, description, assignedTo: "anorak",
        urgency, easiness, impact, priority,
        maturityLevel: 1,
        carbonDescription, siliconDescription, acceptanceCriteria,
        flawlessPercent, dharmaPath, executionMode,
        history: history.length ? JSON.stringify(history) : undefined,
      },
    });
    return { content: [{ type: "text", text: `Created pashyanti mission #${mission.id}: "${name}" (🌒 level 1, assigned to anorak)${executionMode ? ` [${executionMode}]` : ""}` }] };
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// MULTIMODAL — image, voice, video generation via Oasis API
// ═══════════════════════════════════════════════════════════════════════════

const OASIS_URL = process.env.OASIS_URL || "http://localhost:4516";

// Shared media executor — POST to Oasis, resolve relative URLs
function resolveUrl(url) {
  if (!url) return undefined;
  return url.startsWith("http") ? url : `${OASIS_URL}${url}`;
}

async function mediaPost(path, body) {
  const res = await fetch(`${OASIS_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
  return { ok: true, url: resolveUrl(data.url), data };
}

server.tool("generate_image",
  "Generate an image from a text prompt. Returns a URL. Models: gemini-flash, riverflow, seedream, flux-klein.",
  { prompt: z.string(), model: z.string().optional() },
  async ({ prompt, model }) => {
    try {
      const r = await mediaPost("/api/media/image", { prompt, model });
      return { content: [{ type: "text", text: r.ok ? `Image generated: ${r.url}` : `Image gen failed: ${r.error}` }] };
    } catch (e) { return { content: [{ type: "text", text: `Image gen error: ${e}` }] }; }
  }
);

server.tool("generate_voice",
  "Generate a voice note from text (ElevenLabs TTS). Voices: rachel, adam, sam, elli.",
  { text: z.string(), voice: z.string().optional() },
  async ({ text, voice }) => {
    try {
      const r = await mediaPost("/api/media/voice", { text, voice });
      return { content: [{ type: "text", text: r.ok ? `Voice note generated: ${r.url}` : `Voice gen failed: ${r.error}` }] };
    } catch (e) { return { content: [{ type: "text", text: `Voice gen error: ${e}` }] }; }
  }
);

server.tool("generate_video",
  "Generate a video from a text prompt (fal.ai LTX 2.3). Submits job, polls until done.",
  { prompt: z.string(), duration: z.number().min(6).max(20).optional(), image_url: z.string().optional() },
  async ({ prompt, duration, image_url }) => {
    try {
      const r = await mediaPost("/api/media/video", { prompt, duration, image_url });
      if (!r.ok) return { content: [{ type: "text", text: `Video submit failed: ${r.error}` }] };
      if (r.data.status === "completed" && r.url) return { content: [{ type: "text", text: `Video generated: ${r.url}` }] };
      if (r.data.requestId) {
        const endpoint = r.data.endpoint || "";
        for (let i = 0; i < 60; i++) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          const pollRes = await fetch(`${OASIS_URL}/api/media/video?requestId=${r.data.requestId}&endpoint=${encodeURIComponent(endpoint)}`);
          const pollData = await pollRes.json();
          if (pollData.status === "completed" && pollData.url) return { content: [{ type: "text", text: `Video generated: ${resolveUrl(pollData.url)}` }] };
          if (pollData.status === "failed") return { content: [{ type: "text", text: `Video failed: ${pollData.error}` }] };
        }
        return { content: [{ type: "text", text: "Video generation timed out" }] };
      }
      return { content: [{ type: "text", text: `Unexpected: ${JSON.stringify(r.data)}` }] };
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
