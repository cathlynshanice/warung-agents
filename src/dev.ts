// One command for the whole demo: the Warung Agent, the Buyer Agent and the web UI.
//   npm run dev             -> uses your TODO code in pay.ts / jev.ts
//   npm run dev:solution    -> uses the finished code in solution/
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import express, { type Response } from "express";
import { createBuyerAgent, loadPayForOrder } from "./agent-core.js";
import { getBuyerBalance, getWarungBalance } from "./balance.js";
import { MOCK_PAYMENT, WARUNG_NAME, WARUNG_URL } from "./config.js";
import { buyerEvents } from "./events.js";
import { LLM_MODEL, LLM_PROVIDER } from "./llm.js";
import { setConfirmHandler } from "./terminal.js";

const here = dirname(fileURLToPath(import.meta.url));
const useSolution = process.argv.includes("--solution");
const UI_PORT = Number(process.env.UI_PORT ?? 3000);

// --- Live event stream to the browser (Server-Sent Events) ---------------------------
type UiEvent = { id?: number; source: "buyer" | "warung"; kind: string; [key: string]: unknown };
const history: UiEvent[] = [];
const clients = new Set<Response>();
let nextId = 0;

function publish(event: UiEvent): void {
  event.id = ++nextId;
  history.push(event);
  if (history.length > 1000) history.shift();
  for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
}

// --- Warung Agent: its own process, like `npm run warung` -----------------------------
let warung: ChildProcess | undefined;
let greedy = process.env.GREEDY_MODE === "true";

function startWarung(): void {
  warung = spawn(process.execPath, ["--import", "tsx", join(here, "warung.ts")], {
    env: { ...process.env, GREEDY_MODE: String(greedy) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [warung.stdout!, warung.stderr!]) {
    createInterface({ input: stream }).on("line", (line) => {
      if (!line.trim()) return;
      process.stdout.write(`[warung] ${line}\n`);
      publish({ source: "warung", kind: "log", text: line.trim() });
    });
  }
}

async function restartWarung(): Promise<void> {
  const old = warung;
  if (old && old.exitCode === null) {
    const exited = new Promise((resolve) => old.once("exit", resolve));
    old.kill();
    await exited;
  }
  startWarung();
}

// --- Buyer Agent: runs here, its log lines become the "trace" in the UI ---------------
const originalLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const text = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  originalLog(`[agent]  ${text}`);
  publish({ source: "buyer", kind: "trace", text: text.trim() });
};
buyerEvents.on("event", (event) => publish({ source: "buyer", ...event, kind: event.type }));

// ask_human: instead of a y/n prompt in the terminal, the UI shows two buttons.
const pendingConfirms = new Map<string, (approve: boolean) => void>();
setConfirmHandler(
  (question) =>
    new Promise((resolve) => {
      const confirmId = randomUUID();
      pendingConfirms.set(confirmId, resolve);
      publish({ source: "buyer", kind: "confirm", confirmId, question });
    }),
);

const agent = createBuyerAgent(await loadPayForOrder(useSolution));
let busy = false;

// --- HTTP API + static UI -------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(join(here, "ui")));

app.get("/api/events", (req, res) => {
  res.set({ "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.flushHeaders();
  for (const event of history) res.write(`data: ${JSON.stringify(event)}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.get("/api/status", (_req, res) => {
  res.json({
    warungName: WARUNG_NAME,
    warungUrl: WARUNG_URL,
    mock: MOCK_PAYMENT,
    greedy,
    model: LLM_MODEL,
    provider: LLM_PROVIDER,
    solution: useSolution,
    busy,
  });
});

app.get("/api/balance/:who", async (req, res) => {
  try {
    res.json(req.params.who === "warung" ? await getWarungBalance() : await getBuyerBalance());
  } catch (error) {
    res.status(502).json({ error: `Could not read the blockchain: ${(error as Error).message}` });
  }
});

app.post("/api/chat", async (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) return void res.status(400).json({ error: "Type a message first." });
  if (busy) return void res.status(409).json({ error: "The agent is still working on the last message." });
  busy = true;
  publish({ source: "buyer", kind: "user", text: message });
  publish({ source: "buyer", kind: "busy", busy: true });
  try {
    const reply = await agent.chat(message);
    publish({ source: "buyer", kind: "reply", text: reply });
    res.json({ reply });
  } catch (error) {
    const text = (error as Error).message;
    publish({ source: "buyer", kind: "error", text });
    res.status(500).json({ error: text });
  } finally {
    busy = false;
    publish({ source: "buyer", kind: "busy", busy: false });
  }
});

app.post("/api/confirm", (req, res) => {
  const { confirmId, approve } = req.body ?? {};
  const resolve = pendingConfirms.get(confirmId);
  if (!resolve) return void res.status(404).json({ error: "This question was already answered." });
  pendingConfirms.delete(confirmId);
  publish({ source: "buyer", kind: "confirmed", confirmId, approve: Boolean(approve) });
  resolve(Boolean(approve));
  res.json({ ok: true });
});

app.post("/api/reset", (_req, res) => {
  if (busy) return void res.status(409).json({ error: "Wait until the agent has finished." });
  agent.reset();
  for (let i = history.length - 1; i >= 0; i--) if (history[i].source === "buyer") history.splice(i, 1);
  publish({ source: "buyer", kind: "reset" });
  res.json({ ok: true });
});

// You, asking the warung directly (the Buyer Agent uses the same endpoint via askWarung).
app.post("/api/ask-warung", async (req, res) => {
  try {
    const answer = await fetch(`${WARUNG_URL}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-asker": "human" },
      body: JSON.stringify({ question: req.body?.question }),
    });
    res.status(answer.status).json(await answer.json());
  } catch {
    res.status(502).json({ error: "The warung is not reachable. Is it still starting?" });
  }
});

app.post("/api/greedy", async (req, res) => {
  greedy = Boolean(req.body?.on);
  publish({ source: "warung", kind: "restart", greedy });
  await restartWarung();
  res.json({ greedy });
});

// --- Start everything -----------------------------------------------------------------
startWarung();
const server = app.listen(UI_PORT, () => {
  originalLog("");
  originalLog(`🍳 Warung Agent  → ${WARUNG_URL}${greedy ? " (greedy mode)" : ""}`);
  originalLog(`🛒 Buyer Agent   → ${useSolution ? "solution code" : "your TODO code"} · ${MOCK_PAYMENT ? "MOCK payment" : "x402 on Base Sepolia"} · ${LLM_MODEL}`);
  originalLog(`🖥️  Open the UI   → http://localhost:${UI_PORT}`);
  originalLog("");
});
server.on("error", (error) => {
  originalLog(`❌ UI could not start on port ${UI_PORT}: ${error.message}`);
  warung?.kill();
  process.exit(1);
});

function shutdown(): void {
  warung?.kill();
  process.exit(0);
}
process.on("exit", () => warung?.kill());
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
