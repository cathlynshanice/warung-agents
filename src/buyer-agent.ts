// The Buyer Agent: an LLM agent that acts for you. It has 3 tools:
//   getMenu    -> GET  /menu   (free)
//   askWarung  -> POST /ask    (free, answered by the Warung Agent's LLM)
//   placeOrder -> POST /order  (one cart, one payment with x402; Jev and the guardrails decide first)
import type OpenAI from "openai";
import { MOCK_PAYMENT, WARUNG_URL } from "./config.js";
import { LLM_MODEL, LLM_PROVIDER, llm } from "./llm.js";
import type { OrderRequest, OrderResult } from "./payment.js";
import { terminal } from "./terminal.js";

const useSolution = process.argv.includes("--solution");
const { payForOrder } = (useSolution ? await import("./solution/pay.js") : await import("./pay.js")) as {
  payForOrder: (request: OrderRequest) => Promise<OrderResult>;
};

const SYSTEM_PROMPT = `Kamu adalah Buyer Agent yang memesan makanan untuk user dari Warung Agent.
Aturan:
- Selalu panggil getMenu dulu sebelum memilih item.
- Kalau user minta makanan atau makan siang, pilih item dengan category "makanan", jangan minuman.
- Kalau user menyebut syarat yang tidak terlihat di menu (pedas, alergi, vegetarian, bahan), tanya dulu lewat askWarung.
- Masukkan SEMUA item yang user minta ke SATU panggilan placeOrder (pakai quantity untuk porsi lebih dari satu).
- budgetRp harus persis seperti yang user sebut. Jangan pernah mengubahnya. Kalau user tidak menyebut budget, tanya dulu.
- JANGAN menilai sendiri apakah harga melebihi budget, dan jangan menolak pesanan karena budget. Tetap panggil placeOrder: placeOrder yang memeriksa budget dan menanyakan user kalau perlu.
- Kalau placeOrder gagal atau ditolak, jangan coba pesanan lain. Laporkan ke user dan tanya mau apa.
- placeOrder sudah mengurus pembayaran dan persetujuan. Jangan pernah bilang sudah dibayar kalau hasilnya paid=false.
- Balas user dengan singkat dan santai dalam bahasa Indonesia.`;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "getMenu",
      description: "Get the warung's menu: item ids, names, categories and prices in Rupiah.",
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
          budgetRp: { type: "number", description: "The user's budget for the whole order in Rupiah, e.g. 35000" },
        },
        required: ["items", "budgetRp"],
      },
    },
  },
];

async function runTool(name: string, args: Record<string, unknown>, userRequest: string): Promise<unknown> {
  switch (name) {
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
    case "placeOrder":
      return payForOrder({
        // Models sometimes say itemId instead of id; accept both.
        items: ((args.items ?? []) as { id?: string; itemId?: string; quantity?: number }[]).map((line) => ({
          itemId: String(line.id ?? line.itemId),
          quantity: Number(line.quantity ?? 1),
        })),
        budgetRp: Number(args.budgetRp),
        userRequest,
      });
    default:
      return { error: `Unknown tool ${name}` };
  }
}

async function handleTurn(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], userRequest: string) {
  // Enforced in code, not just the prompt: after a rejected payment the LLM tends to
  // retry other items, sometimes with a budget it made up. A call that never got a
  // Payment Request (e.g. a typo in an item id) doesn't count, so the LLM can fix it.
  let orderPlaced = false;
  for (let step = 0; step < 8; step++) {
    const completion = await llm.chat.completions.create({ model: LLM_MODEL, messages, tools });
    const message = completion.choices[0].message;
    messages.push(message);

    if (!message.tool_calls?.length) {
      console.log(`Buyer Agent: ${message.content?.trim() ?? ""}`);
      return;
    }
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;
      const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      console.log(`  🔧 Tool: ${call.function.name} ${JSON.stringify(args)}`);
      let result: unknown;
      try {
        if (call.function.name === "placeOrder" && orderPlaced) {
          result = { error: "Only one order per user message. Tell the user the previous result and ask what to do." };
        } else {
          result = await runTool(call.function.name, args, userRequest);
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
  console.log("Buyer Agent: (stopped after too many steps)");
}

const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM_PROMPT }];
console.log(`🛒 Buyer Agent${useSolution ? " (solution)" : ""} → ${WARUNG_URL}${MOCK_PAYMENT ? " · MOCK payment" : " · x402 on Base Sepolia"} · ${LLM_MODEL} (${LLM_PROVIDER})`);
console.log(`   Try: pesenin nasi goreng buat makan siang, budget 35 ribu   ('exit' to stop)`);

let closed = false;
terminal.on("close", () => (closed = true));

while (!closed) {
  const input = (await terminal.question("\nYou: ").catch(() => "exit")).trim();
  if (!input) continue;
  if (["exit", "quit"].includes(input.toLowerCase())) break;
  messages.push({ role: "user", content: input });
  try {
    await handleTurn(messages, input);
  } catch (error) {
    console.log(`❌ ${(error as Error).message}`);
  }
}
terminal.close();
