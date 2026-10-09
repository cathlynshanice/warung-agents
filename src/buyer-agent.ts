// The Buyer Agent in the terminal. For the web UI, run `npm run dev`.
import { MOCK_PAYMENT, WARUNG_URL } from "./config.js";
import { createBuyerAgent, loadPayForOrder } from "./agent-core.js";
import { LLM_MODEL, LLM_PROVIDER } from "./llm.js";
import { terminal } from "./terminal.js";

const useSolution = process.argv.includes("--solution");
const agent = createBuyerAgent(await loadPayForOrder(useSolution));

console.log(`🛒 Buyer Agent${useSolution ? " (solution)" : ""} → ${WARUNG_URL}${MOCK_PAYMENT ? " · MOCK payment" : " · x402 on Base Sepolia"} · ${LLM_MODEL} (${LLM_PROVIDER})`);
console.log(`   Try: pesenin nasi goreng buat makan siang, budget 35 ribu   ('exit' to stop)`);

let closed = false;
terminal().on("close", () => (closed = true));

while (!closed) {
  const input = (await terminal().question("\nYou: ").catch(() => "exit")).trim();
  if (!input) continue;
  if (["exit", "quit"].includes(input.toLowerCase())) break;
  try {
    console.log(`Buyer Agent: ${await agent.chat(input)}`);
  } catch (error) {
    console.log(`❌ ${(error as Error).message}`);
  }
}
terminal().close();
