#!/usr/bin/env node
// Live terminal mirror for an Even Terminal session.
//
// Subscribes to a running even-terminal server's SSE stream and prints the
// live conversation — the prompts you speak into the G2 glasses and Claude's
// streaming replies — into this terminal. You can also type here to send a
// prompt to the same session (bidirectional).
//
// It reuses even-terminal's existing HTTP+SSE API (no upstream changes) and
// discovers the server's port + bridge token from the instance pidfile the
// server writes at ~/.even-terminal/instances/<pid>.json.
//
// Usage:
//   node scripts/mirror.mjs [--port N] [--token T] [--provider claude|codex]
//                           [--cwd DIR] [--no-color] [--read-only]

import http from "node:http";
import readline from "node:readline";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const INSTANCE_DIR = join(homedir(), ".even-terminal", "instances");

// ── Args ──────────────────────────────────────────────
function parseArgs(argv) {
  const out = { provider: "claude", color: true, readOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--port") out.port = parseInt(next(), 10);
    else if (a === "--token") out.token = next();
    else if (a === "--provider") out.provider = next();
    else if (a === "--cwd") out.cwd = next();
    else if (a === "--no-color") out.color = false;
    else if (a === "--read-only") out.readOnly = true;
    else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: node scripts/mirror.mjs [--port N] [--token T] " +
          "[--provider claude|codex] [--cwd DIR] [--no-color] [--read-only]"
      );
      process.exit(0);
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

// ── Colors ────────────────────────────────────────────
const useColor = args.color && process.stdout.isTTY;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  dim: paint("2"),
  bold: paint("1"),
  cyan: paint("36"),
  green: paint("32"),
  yellow: paint("33"),
  red: paint("31"),
  mag: paint("35"),
  blue: paint("34"),
};

// ── Instance discovery ────────────────────────────────
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function discoverInstance() {
  let entries = [];
  try {
    entries = readdirSync(INSTANCE_DIR);
  } catch {
    return null;
  }
  const live = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    let info;
    try {
      info = JSON.parse(readFileSync(join(INSTANCE_DIR, name), "utf8"));
    } catch {
      continue;
    }
    if (typeof info.pid !== "number" || !isPidAlive(info.pid)) continue;
    if (args.port && info.port !== args.port) continue;
    if (args.cwd && info.cwd !== args.cwd) continue;
    live.push(info);
  }
  live.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return live[0] ?? null;
}

const instance = discoverInstance();
const PORT = args.port ?? instance?.port;
const TOKEN = args.token ?? instance?.token;
const CWD = args.cwd ?? instance?.cwd;

if (!PORT || !TOKEN) {
  console.error(
    c.red("No running even-terminal server found.") +
      "\nStart the profile in the launcher first, or pass --port and --token.\n" +
      `(looked in ${INSTANCE_DIR})`
  );
  process.exit(1);
}

// ── HTTP helper ───────────────────────────────────────
function api(path, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path,
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: 10000,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data || "{}"));
          } catch (err) {
            reject(new Error(`bad JSON from ${path}: ${err.message}`));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Terminal output that coexists with the input line ─
let assistantOpen = false;

function closeAssistant() {
  if (assistantOpen) {
    process.stdout.write("\n");
    assistantOpen = false;
  }
}

// Print a discrete line, preserving whatever the user is typing.
function line(text) {
  closeAssistant();
  if (useColor && process.stdout.isTTY) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  }
  process.stdout.write(text + "\n");
  rl.prompt(true);
}

// Prompts we sent from this terminal, so we can suppress the echoed
// user_prompt the server broadcasts back (we already printed a ⌨ line).
const pendingSent = [];

// ── Render one SSE message ────────────────────────────
function render(msg) {
  switch (msg.type) {
    case "user_prompt": {
      const idx = pendingSent.indexOf(msg.text);
      if (idx !== -1) {
        pendingSent.splice(idx, 1); // our own terminal message coming back
        break;
      }
      line(c.mag("🎙  you (glasses): ") + msg.text);
      break;
    }
    case "text_delta":
      if (!assistantOpen) {
        if (useColor && process.stdout.isTTY) {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
        }
        process.stdout.write(c.green("🤖 claude: "));
        assistantOpen = true;
      }
      process.stdout.write(msg.text);
      break;
    case "status":
      if (msg.state === "text_end" || msg.state === "think_end") closeAssistant();
      else if (msg.state === "think_start") line(c.dim("💭 thinking…"));
      break;
    case "tool_start":
      line(c.dim(`⚙  ${msg.name}…`));
      break;
    case "tool_end":
      line(c.dim(`✓  ${msg.summary || msg.name}`));
      break;
    case "permission_request":
      line(
        c.yellow(`⚠  permission: ${msg.description}`) +
          (msg.detail ? c.dim(` — ${msg.detail}`) : "") +
          c.dim("  (answer from your glasses)")
      );
      break;
    case "user_question": {
      line(c.blue("❓ question from Claude:"));
      for (const q of msg.questions ?? []) {
        line("   " + c.bold(q.question || q.header));
        for (const o of q.options ?? []) {
          line(c.dim("     • ") + o.label + (o.description ? c.dim(` — ${o.description}`) : ""));
        }
      }
      line(c.dim("   (answer from your glasses)"));
      break;
    }
    case "result": {
      const cost = typeof msg.costUsd === "number" ? `$${msg.costUsd.toFixed(4)}` : "";
      const meta = [
        msg.turns != null ? `${msg.turns} turns` : "",
        msg.inputTokens != null ? `in ${msg.inputTokens}` : "",
        msg.outputTokens != null ? `out ${msg.outputTokens}` : "",
        cost,
      ]
        .filter(Boolean)
        .join(" · ");
      if (msg.success === false && msg.text) line(c.red(`✗ ${msg.text}`));
      line(c.dim(`— turn done${meta ? " · " + meta : ""} —`));
      break;
    }
    case "error":
      line(c.red(`error: ${msg.message}`));
      break;
    // running_stats, notification, task_progress, question_answer,
    // permission_result: intentionally not rendered to keep the view clean.
    default:
      break;
  }
}

// ── SSE follow ────────────────────────────────────────
let sseReq = null;
let currentSession = null;
let pinnedByInput = false;

function attach(sessionId) {
  if (sseReq) {
    sseReq.destroy();
    sseReq = null;
  }
  currentSession = sessionId;
  line(c.cyan(`▶ following session ${sessionId.slice(0, 8)}…`));
  const path = `/api/events?sessionId=${encodeURIComponent(sessionId)}&needReplay=true`;
  const req = http.get(
    {
      host: "127.0.0.1",
      port: PORT,
      path,
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "text/event-stream" },
    },
    (res) => {
      if (res.statusCode !== 200) {
        line(c.red(`SSE ${res.statusCode} for session ${sessionId.slice(0, 8)}`));
        res.resume();
        return;
      }
      res.setEncoding("utf8");
      let buf = "";
      res.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLines = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
          if (!dataLines.length) continue; // comment/heartbeat
          try {
            render(JSON.parse(dataLines.join("\n")));
          } catch {
            /* ignore malformed frame */
          }
        }
      });
      res.on("end", () => {
        if (sseReq === req) sseReq = null;
      });
    }
  );
  req.on("error", (err) => {
    if (sseReq === req) sseReq = null;
    line(c.red(`SSE error: ${err.message}`));
  });
  sseReq = req;
}

async function pollNewestSession() {
  if (pinnedByInput) return;
  try {
    const q = new URLSearchParams({ provider: args.provider, limit: "5" });
    if (CWD && args.provider !== "codex") q.set("cwd", CWD);
    const { sessions } = await api(`/api/sessions?${q.toString()}`);
    if (!Array.isArray(sessions) || sessions.length === 0) return;
    const newest = sessions
      .filter((s) => s && s.id)
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))[0];
    if (newest && newest.id !== currentSession) attach(newest.id);
  } catch {
    /* server may be mid-start; retry next tick */
  }
}

// ── Input (type-back) ─────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: useColor ? c.cyan("❯ ") : "❯ ",
});

if (!args.readOnly) {
  rl.on("line", async (raw) => {
    const text = raw.trim();
    if (!text) {
      rl.prompt();
      return;
    }
    try {
      const res = await api("/api/prompt", {
        method: "POST",
        body: {
          text,
          provider: args.provider,
          ...(currentSession ? { sessionId: currentSession } : {}),
        },
      });
      if (res.error) {
        line(c.red(`send failed: ${res.error}`));
      } else {
        pendingSent.push(text);
        line(c.mag("⌨  you (terminal): ") + text);
        if (res.sessionId && res.sessionId !== currentSession) {
          pinnedByInput = true; // follow the session we just drove
          attach(res.sessionId);
        }
      }
    } catch (err) {
      line(c.red(`send failed: ${err.message}`));
    }
    rl.prompt();
  });
}

rl.on("close", () => {
  if (sseReq) sseReq.destroy();
  process.exit(0);
});

// ── Boot ──────────────────────────────────────────────
line(
  c.bold("Even Terminal mirror") +
    c.dim(
      ` · port ${PORT} · ${args.provider}${CWD ? " · " + CWD : ""}` +
        (args.readOnly ? " · read-only" : "")
    )
);
line(
  c.dim(
    args.readOnly
      ? "Watching for the active session… speak into your glasses."
      : "Watching for the active session… speak into your glasses, or type here + Enter."
  )
);
await pollNewestSession();
setInterval(pollNewestSession, 1500);
rl.prompt();
