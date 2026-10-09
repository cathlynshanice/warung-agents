// Ready-made pieces of the buyer's payment flow. The hands-on parts are in pay.ts and jev.ts.
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { MOCK_PAYMENT, WARUNG_URL, formatPrice, requireEnv } from "./config.js";
import { askYesNo } from "./terminal.js";

export type PaymentDecision = "approve" | "reject" | "ask_human";

/** Everything Jev sees when deciding a Payment Request. */
export type PaymentState = {
  userRequest: string;
  /** e.g. "2x Nasi Goreng Spesial, 1x Es Teh Manis" */
  order: string;
  budgetRp: number;
  /** Sum of the menu prices of everything in the order. */
  menuPriceRp: number;
  requestedPriceRp: number;
};

export type OrderLine = { itemId: string; quantity: number };
export type OrderRequest = { items: OrderLine[]; budgetRp: number; userRequest: string };

export type OrderResult =
  | { paid: false; reason: string; requestedRp?: number }
  | { paid: true; requestedRp: number; order: unknown; tx?: string };

// Jev 1.13 Free on OpenCode Zen speaks the same System One API as TypeSafe.
export const jev = new TypeSafeClient({
  apiKey: requireEnv("OPENCODE_API_KEY"),
  baseURL: process.env.JEV_BASE_URL ?? "https://opencode.ai/zen",
  defaultModel: process.env.JEV_MODEL ?? "jev-1.13-free",
});

// The x402 client signs USDC payments with the buyer's key. Not needed in mock mode.
export const httpClient = MOCK_PAYMENT ? undefined : createHttpClient();

function createHttpClient(): x402HTTPClient {
  const account = privateKeyToAccount(requireEnv("BUYER_PRIVATE_KEY") as `0x${string}`);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  return new x402HTTPClient(client);
}

export function orderUrl(items: OrderLine[]): string {
  const cart = items.map((line) => `${line.itemId}:${line.quantity}`).join(",");
  return `${WARUNG_URL}/order?items=${encodeURIComponent(cart)}`;
}

/** What the order should cost according to the warung's own GET /menu, or an error message. */
export async function priceOrder(items: OrderLine[]): Promise<{ order: string; menuPriceRp: number } | string> {
  const res = await fetch(`${WARUNG_URL}/menu`);
  const menu = (await res.json()) as { items: { id: string; name: string; priceRp: number }[] };
  const lines = [];
  for (const { itemId, quantity } of items) {
    const item = menu.items.find((entry) => entry.id === itemId);
    if (!item) return `Item not found: ${itemId}`;
    lines.push({ name: item.name, priceRp: item.priceRp, quantity });
  }
  return {
    order: lines.map((line) => `${line.quantity}x ${line.name}`).join(", "),
    menuPriceRp: lines.reduce((sum, line) => sum + line.priceRp * line.quantity, 0),
  };
}

/** Why a paid retry failed. A rejected payment comes back as another 402 with the reason inside. */
export async function describePaymentFailure(res: globalThis.Response): Promise<string> {
  const body = await res.json().catch(() => undefined);
  if (res.status === 402 && httpClient) {
    const reason = httpClient.getPaymentRequiredResponse((name) => res.headers.get(name), body).error;
    const hint = /insufficient|balance|funds/i.test(reason ?? "") ? " (fund the buyer at faucet.circle.com)" : "";
    return `Payment failed: ${reason ?? "rejected by the facilitator"}${hint}`;
  }
  return `Payment failed (${res.status}): ${JSON.stringify(body)}`;
}

export function logPaymentRequired(requestedRp: number): void {
  console.log(`  💸 402 Payment Required: ${formatPrice(requestedRp)}`);
}

/**
 * Hard rules in plain code, applied after Jev, in case Jev gets it wrong.
 * Money rules never depend on the model alone.
 */
export function applyGuardrails(state: PaymentState, decision: PaymentDecision): PaymentDecision {
  if (decision !== "reject" && state.requestedPriceRp > state.menuPriceRp) {
    console.log("  🛡️  Guardrail: requested price is higher than the menu. Forcing REJECT.");
    return "reject";
  }
  if (decision === "approve" && state.requestedPriceRp > state.budgetRp) {
    console.log("  🛡️  Guardrail: requested price is over budget. Asking the human instead.");
    return "ask_human";
  }
  return decision;
}

/** Turn a Payment Decision into yes/no, asking the human when needed. */
export async function confirmPayment(state: PaymentState, decision: PaymentDecision): Promise<boolean> {
  if (decision === "approve") return true;
  if (decision === "reject") return false;
  return askYesNo(
    `${state.order} costs ${formatPrice(state.requestedPriceRp)}, over your budget of ${formatPrice(state.budgetRp)}. Proceed?`,
  );
}

/** Mock mode: same request -> 402 -> decide -> retry flow, without a blockchain. */
export async function mockPayForOrder(
  request: OrderRequest,
  decide: (state: PaymentState) => Promise<PaymentDecision>,
): Promise<OrderResult> {
  const priced = await priceOrder(request.items);
  if (typeof priced === "string") return { paid: false, reason: priced };

  const url = orderUrl(request.items);
  const first = await fetch(url, { method: "POST" });
  if (first.status !== 402) return { paid: false, reason: `Expected 402, got ${first.status}: ${await first.text()}` };

  const requestedRp = Number(((await first.json()) as { amountRp: number }).amountRp);
  logPaymentRequired(requestedRp);

  const state: PaymentState = {
    userRequest: request.userRequest,
    order: priced.order,
    budgetRp: request.budgetRp,
    menuPriceRp: priced.menuPriceRp,
    requestedPriceRp: requestedRp,
  };
  const decision = applyGuardrails(state, await decide(state));
  if (!(await confirmPayment(state, decision))) {
    return { paid: false, reason: decision === "reject" ? "Rejected: the requested price does not match the menu" : "Not paid: the user declined because it is over budget", requestedRp };
  }

  const paidRes = await fetch(url, { method: "POST", headers: { "x-mock-payment": String(requestedRp) } });
  const order = (await paidRes.json()) as { mockTx?: string };
  console.log(`  🔗 (mock) tx ${order.mockTx}`);
  return { paid: true, requestedRp, order, tx: order.mockTx };
}
