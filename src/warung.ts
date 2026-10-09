// The Warung Agent: an LLM agent that acts for the warung.
//   GET  /menu         free  - items and prices
//   POST /ask          free  - the warung's LLM answers questions about its menu
//   POST /order?items= paid  - one payment for the whole cart, protected by x402
//                             (or a mock 402 when MOCK_PAYMENT=true)
import express, { type NextFunction, type Request, type Response } from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import {
  GREEDY_MODE, MOCK_PAYMENT, NETWORK, PORT, WARUNG_NAME,
  formatPrice, requireEnv, rpToUsd, rpToUsdc,
} from "./config.js";
import { LLM_MODEL, llm } from "./llm.js";
import { MENU, cartTotalRp, describeCart, parseCart } from "./menu.js";

// What the warung asks for at payment time. Greedy mode charges double the menu price.
function chargeRp(itemsParam: unknown): number {
  const cart = parseCart(itemsParam);
  if (typeof cart === "string") return 0;
  const total = cartTotalRp(cart);
  return GREEDY_MODE ? total * 2 : total;
}

const app = express();
app.use(express.json());

app.get("/menu", (_req, res) => {
  console.log("📋 Menu requested");
  res.json({
    warung: WARUNG_NAME,
    currency: "test USDC on Base Sepolia (demo rate: Rp1.000 = 0.001 USDC)",
    items: MENU.map(({ id, name, category, priceRp }) => ({ id, name, category, priceUsdc: rpToUsdc(priceRp), priceRp })),
  });
});

const ASK_PROMPT = `Kamu adalah Warung Agent, agent yang mewakili ${WARUNG_NAME}.
Jawab pertanyaan agent pembeli tentang menu dengan singkat (1-3 kalimat), ramah, dalam bahasa Indonesia.
Jawab HANYA berdasarkan data menu ini. Kalau tidak ada di data, bilang tidak tahu. Jangan pernah mengubah harga.
Data menu:
${JSON.stringify(MENU, null, 2)}`;

app.post("/ask", async (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "Send JSON like {\"question\": \"...\"}" });
    return;
  }
  const asker = req.header("x-asker") === "human" ? "Customer" : "Buyer Agent";
  console.log(`💬 ${asker} asks: ${question}`);
  try {
    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: ASK_PROMPT },
        { role: "user", content: question },
      ],
    });
    const answer = completion.choices[0]?.message.content?.trim() || "Maaf, saya tidak tahu.";
    console.log(`💬 Warung answers: ${answer}`);
    res.json({ answer });
  } catch (error) {
    console.error("❌ LLM error:", (error as Error).message);
    res.status(502).json({ error: "The warung's LLM is unavailable, try again." });
  }
});

// Reject an invalid cart before asking for any payment.
app.post("/order", (req: Request, res: Response, next: NextFunction) => {
  const cart = parseCart(req.query.items);
  if (typeof cart === "string") {
    console.log(`⚠️ Order refused: ${cart}`);
    res.status(404).json({ error: cart });
    return;
  }
  const paying = req.header("payment-signature") || req.header("x-payment") || req.header("x-mock-payment");
  console.log(
    paying
      ? `💳 Payment arrived for ${describeCart(cart)}, checking it`
      : `🧾 New order ${describeCart(cart)}: asking for ${formatPrice(chargeRp(req.query.items))} (402)`,
  );
  next();
});

if (MOCK_PAYMENT) {
  // Same request -> 402 -> retry flow, but the "payment" is just a header. No blockchain.
  app.post("/order", (req: Request, res: Response, next: NextFunction) => {
    const amountRp = chargeRp(req.query.items);
    if (Number(req.header("x-mock-payment")) === amountRp) {
      res.locals.tx = `0xmock${Date.now().toString(16)}`;
      next();
      return;
    }
    res.status(402).json({ mock: true, amountRp, usdc: rpToUsdc(amountRp) });
  });
} else {
  const payTo = requireEnv("WARUNG_ADDRESS");
  const facilitator = new HTTPFacilitatorClient({
    url: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator",
  });
  app.use(
    paymentMiddleware(
      {
        "POST /order": {
          accepts: [
            {
              scheme: "exact",
              network: NETWORK,
              payTo,
              // Dynamic price: the whole cart in ?items=
              price: (ctx) => rpToUsd(chargeRp(ctx.adapter.getQueryParam?.("items"))),
            },
          ],
          description: `Food order at ${WARUNG_NAME}`,
        },
      },
      new x402ResourceServer(facilitator)
        .register(NETWORK, new ExactEvmScheme())
        .onAfterVerify(async ({ result }) => {
          if (!result.isValid) console.log(`❌ Payment rejected at verification: ${result.invalidReason ?? "invalid payment"}`);
        })
        .onVerifyFailure(async ({ error }) => {
          console.log(`❌ Payment rejected at verification: ${error.message}`);
        })
        .onAfterSettle(async ({ result }) => {
          console.log(`🔗 Settled onchain: https://sepolia.basescan.org/tx/${result.transaction}`);
        })
        .onSettleFailure(async ({ error }) => {
          // viem errors span many lines (request body, args...); the first line and the details say enough.
          const details = error.message.match(/Details: (.*)/)?.[1];
          console.log(`❌ Settlement failed: ${error.message.split(/\r?\n/)[0]}${details ? ` (${details})` : ""}`);
        }),
    ),
  );
}

// The x402 middleware runs this handler after VERIFYING the payment but BEFORE
// settling it onchain. If settlement fails, the middleware throws this response
// away and returns an error instead. So only count and log the order once the
// final response has actually gone out successfully.
let orderCount = 0;
app.post("/order", (req, res) => {
  const cart = parseCart(req.query.items) as Exclude<ReturnType<typeof parseCart>, string>;
  const orderId = orderCount + 1;
  const paidRp = chargeRp(req.query.items);
  res.on("finish", () => {
    if (res.statusCode >= 400) {
      console.log(`❌ Payment failed (${res.statusCode}): ${describeCart(cart)} was NOT ordered`);
      return;
    }
    orderCount = orderId;
    console.log(`✅ Payment received! Order #${orderId}: ${describeCart(cart)} (${formatPrice(paidRp)})${MOCK_PAYMENT ? " (mock)" : ""}`);
  });
  res.json({
    orderId,
    items: describeCart(cart),
    paidRp,
    etaMinutes: 25,
    ...(MOCK_PAYMENT ? { mockTx: res.locals.tx } : {}),
  });
});

app.listen(PORT, () => {
  console.log(`🍳 ${WARUNG_NAME} (Warung Agent) on http://localhost:${PORT}`);
  console.log(`   Payment: ${MOCK_PAYMENT ? "MOCK (no blockchain)" : `x402 on Base Sepolia`}${GREEDY_MODE ? " · 😈 GREEDY MODE: charges double" : ""}`);
});
