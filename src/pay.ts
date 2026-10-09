// ✍️ Hands-on: TODO 4 and TODO 6. Stuck? See solution/pay.ts or run `npm run agent:solution`.
import type { PaymentRequired } from "@x402/core/types";
import { MOCK_PAYMENT } from "./config.js";
import { decidePayment } from "./jev.js";
import {
  applyGuardrails, confirmPayment, describePaymentFailure, httpClient, logPaymentRequired, mockPayForOrder, orderUrl, priceOrder,
  type OrderRequest, type OrderResult, type PaymentState,
} from "./payment.js";

/** request -> 402 -> decide -> sign -> retry */
export async function payForOrder(request: OrderRequest): Promise<OrderResult> {
  // Mock mode is already handled here (it only needs TODO 5).
  if (MOCK_PAYMENT) return mockPayForOrder(request, decidePayment);

  const priced = await priceOrder(request.items);
  if (typeof priced === "string") return { paid: false, reason: priced };

  // 1) Try to order without paying -> the warung answers 402   (ready)
  const url = orderUrl(request.items);
  const first = await fetch(url, { method: "POST" });
  if (first.status !== 402) return { paid: false, reason: `Expected 402, got ${first.status}: ${await first.text()}` };

  // 2) ✍️ TODO 4 — Read the price from the 402
  //   4a) body = await first.json() (it may be empty, so add .catch(() => undefined))
  //   4b) paymentRequired = httpClient!.getPaymentRequiredResponse((name) => first.headers.get(name), body)
  //   4c) requestedRp = Number(paymentRequired.accepts[0].amount)   (1 atomic USDC unit == Rp1)
  // ⬇️ placeholders: delete these 2 lines when you write TODO 4
  const paymentRequired = undefined as unknown as PaymentRequired;
  const requestedRp: number = NaN;
  logPaymentRequired(requestedRp);

  // 3) Decide BEFORE signing anything   (Jev = TODO 5 in jev.ts)
  const state: PaymentState = {
    userRequest: request.userRequest,
    order: priced.order,
    budgetRp: request.budgetRp,
    menuPriceRp: priced.menuPriceRp,
    requestedPriceRp: requestedRp,
  };
  const decision = applyGuardrails(state, await decidePayment(state));
  if (!(await confirmPayment(state, decision))) {
    return { paid: false, reason: decision === "reject" ? "Rejected: the requested price does not match the menu" : "Not paid: the user declined because it is over budget", requestedRp };
  }

  // 4) ✍️ TODO 6 — Sign the USDC payment and retry
  //   6a) payload = await httpClient!.createPaymentPayload(paymentRequired)
  //   6b) headers = httpClient!.encodePaymentSignatureHeader(payload)
  //   6c) paidRes = await fetch(url, { method: "POST", headers })
  //       (if !paidRes.ok, return { paid: false, reason: await describePaymentFailure(paidRes), requestedRp })
  //   6d) order = await paidRes.json()
  //       tx = httpClient!.getPaymentSettleResponse((name) => paidRes.headers.get(name)).transaction
  //       log `🔗 https://sepolia.basescan.org/tx/${tx}` and return { paid: true, requestedRp, order, tx }
  void paymentRequired; void describePaymentFailure; // (delete this line when you write TODO 6)
  throw new Error("TODO 6: sign the USDC payment and retry the order");
}
