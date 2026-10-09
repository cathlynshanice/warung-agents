// The Buyer Agent's brain: an LLM agent that acts for you. It has 4 tools:
//   getBalance -> reads your wallet's test USDC balance from the blockchain
//   getMenu    -> GET  /menu   (free)
//   askWarung  -> POST /ask    (free, answered by the Warung Agent's LLM)
//   placeOrder -> POST /order  (one cart, one payment with x402; Jev and the guardrails decide first)
import type OpenAI from "openai";
import { getBuyerBalance } from "./balance.js";
import { WARUNG_URL, usdcToRp } from "./config.js";
import { LLM_MODEL, llm } from "./llm.js";
import type { OrderRequest, OrderResult } from "./payment.js";
import { emitBuyerEvent } from "./events.js";
import { createPayForOrder } from "./pay.js";

type PayForOrder = (request: OrderRequest) => Promise<OrderResult>;

/** The payment flow with your Jev decision (TODO 5 in jev.ts), or the solution's with --solution. */
export async function loadPayForOrder(useSolution: boolean): Promise<PayForOrder> {
  if (!useSolution) return createPayForOrder((await import("./jev.js")).decidePayment);
  // solution/ is instructor-only: it is git-ignored, so it exists only on the instructor's laptop.
  const solutionPath = "./solution/jev.js";
  try {
    return createPayForOrder((await import(solutionPath)).decidePayment);
  } catch {
    console.error("❌ The solution is not in this copy of the repo. Fill in TODO 5 in src/jev.ts and run `npm run dev` instead.");
    process.exit(1);
  }
}

const SYSTEM_PROMPT = `Kamu adalah Buyer Agent yang memesan makanan untuk user dari Warung Agent.
Mata uang: pembayaran memakai test USDC di Base Sepolia (testnet). Kurs demo: Rp1.000 = 0.001 USDC.
Istilah:
- Saldo = isi wallet user (test USDC). Kalau user tanya saldo, panggil getBalance. Saldo BUKAN budget.
- Budget = batas belanja untuk satu pesanan, yang disebut user.
Aturan:
- Saat menyebut harga, tampilkan dalam USDC dulu, lalu Rupiah dalam kurung. Contoh: 0.03 USDC (Rp30.000).
- Selalu panggil getMenu dulu sebelum memilih item.
- Kalau user minta makanan atau makan siang, pilih item dengan category "makanan", jangan minuman.
- Kalau user menyebut syarat yang tidak terlihat di menu (pedas, alergi, vegetarian, bahan), tanya dulu lewat askWarung.
- Masukkan SEMUA item yang user minta ke SATU panggilan placeOrder (pakai quantity untuk porsi lebih dari satu).
- Budget harus persis seperti yang user sebut, jangan pernah diubah. Kalau user menyebut budget dalam USDC, isi budgetUsdc; kalau dalam Rupiah, isi budgetRp. Kalau user tidak menyebut budget, tanya dulu.
- JANGAN menilai sendiri apakah harga melebihi budget, dan jangan menolak pesanan karena budget. Tetap panggil placeOrder: placeOrder yang memeriksa budget dan menanyakan user kalau perlu.
- Kalau placeOrder gagal atau ditolak, jangan coba pesanan lain. Laporkan ke user dan tanya mau apa.
- placeOrder sudah mengurus pembayaran dan persetujuan. Jangan pernah bilang sudah dibayar kalau hasilnya paid=false.
- Balas user dengan singkat dan santai dalam bahasa Indonesia.`;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "getBalance",
      description: "Get the user's wallet balance in test USDC on Base Sepolia, read from the blockchain.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "getMenu",
      description: "Get the warung's menu: item ids, names, categories and prices in test USDC (priceUsdc) and Rupiah (priceRp).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "askWarung",
      description: "Ask the Warung Agent a question about its food, e.g. ingredients, spiciness or allergens.",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "placeOrder",
      description:
        "Order everything the user asked for in one cart and pay once. Works even when the total is over budget: " +
        "the payment is checked against the menu prices and the budget, and the user is asked when needed.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Item id from getMenu, e.g. nasi-goreng" },
                quantity: { type: "integer", minimum: 1, maximum: 10 },
              },
              required: ["id", "quantity"],
            },
          },
          budgetRp: { type: "number", description: "Budget for the whole order in Rupiah, e.g. 35000" },
          budgetUsdc: { type: "number", description: "Budget for the whole order in test USDC, e.g. 0.05" },
        },
        required: ["items"],
      },
    },
  },
];

async function runTool(
  payForOrder: PayForOrder,
  name: string,
  args: Record<string, unknown>,
  userRequest: string,
): Promise<unknown> {
  switch (name) {
    case "getBalance":
      return getBuyerBalance();
    case "getMenu":
      return (await fetch(`${WARUNG_URL}/menu`)).json();
    case "askWarung": {
      const res = await fetch(`${WARUNG_URL}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: args.question }),
      });
      return res.json();
    }
    case "placeOrder": {
      // The budget may come in USDC or Rupiah; payment checks work in Rupiah.
      // Models sometimes fill both, with null or 0 in the unused one: take whichever is positive.
      const budgetUsdc = Number(args.budgetUsdc);
      const budgetRp = budgetUsdc > 0 ? usdcToRp(budgetUsdc) : Number(args.budgetRp);
      if (!Number.isFinite(budgetRp) || budgetRp <= 0) return { error: "Ask the user for a budget first." };
      const result = await payForOrder({
        // Models sometimes say itemId instead of id; accept both.
        items: ((args.items ?? []) as { id?: string; itemId?: string; quantity?: number }[]).map((line) => ({
          itemId: String(line.id ?? line.itemId),
          quantity: Number(line.quantity ?? 1),
        })),
        budgetRp,
        userRequest,
      });
      emitBuyerEvent({ type: "order", ...result });
      return result;
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/** Run one user message through the LLM and its tools. Returns the agent's reply. */
async function handleTurn(
  payForOrder: PayForOrder,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  userRequest: string,
): Promise<string> {
  // Enforced in code, not just the prompt: after a rejected payment the LLM tends to
  // retry other items, sometimes with a budget it made up. A call that never got a
  // Payment Request (e.g. a typo in an item id) doesn't count, so the LLM can fix it.
  let orderPlaced = false;
  for (let step = 0; step < 8; step++) {
    const completion = await llm.chat.completions.create({ model: LLM_MODEL, messages, tools });
    const message = completion.choices[0].message;
    messages.push(message);

    if (!message.tool_calls?.length) return message.content?.trim() ?? "";
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;
      const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      console.log(`  🔧 Tool: ${call.function.name} ${JSON.stringify(args)}`);
      let result: unknown;
      try {
        if (call.function.name === "placeOrder" && orderPlaced) {
          result = { error: "Only one order per user message. Tell the user the previous result and ask what to do." };
        } else {
          result = await runTool(payForOrder, call.function.name, args, userRequest);
          if (call.function.name === "placeOrder" && (result as OrderResult).requestedRp !== undefined) {
            orderPlaced = true;
          }
        }
      } catch (error) {
        result = { error: (error as Error).message };
        console.log(`  ❌ ${(error as Error).message}`);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return "(stopped after too many steps)";
}

/** A Buyer Agent with its own conversation. Used by the terminal and the web UI. */
export function createBuyerAgent(payForOrder: PayForOrder) {
  let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  const reset = () => {
    messages = [{ role: "system", content: SYSTEM_PROMPT }];
  };
  reset();
  return {
    reset,
    async chat(userMessage: string): Promise<string> {
      messages.push({ role: "user", content: userMessage });
      return handleTurn(payForOrder, messages, userMessage);
    },
  };
}

