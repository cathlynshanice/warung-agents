// The buyer's x402 payment flow: request -> 402 -> decide -> sign -> retry.
// Ready to read, not to type: the hands-on part is Jev's decision in jev.ts.
import { MOCK_PAYMENT } from "./config.js";
import {
  applyGuardrails, confirmPayment, describePaymentFailure, httpClient, logPaymentRequired, mockPayForOrder, orderUrl, priceOrder,
  type OrderRequest, type OrderResult, type PaymentDecision, type PaymentState,
} from "./payment.js";

type DecidePayment = (state: PaymentState) => Promise<PaymentDecision>;

/** Builds payForOrder around a Jev decision function: yours (jev.ts) or the solution's. */
export function createPayForOrder(decidePayment: DecidePayment) {
  return async function payForOrder(request: OrderRequest): Promise<OrderResult> {
    // Mock mode: the same steps, but no blockchain.
    if (MOCK_PAYMENT) return mockPayForOrder(request, decidePayment);

    // What the order should cost, according to the warung's own GET /menu.
    const priced = await priceOrder(request.items);
    if (typeof priced === "string") return { paid: false, reason: priced };

    // 1) Try to order without paying -> the warung answers 402 Payment Required.
    const url = orderUrl(request.items);
    const first = await fetch(url, { method: "POST" });
    if (first.status !== 402) return { paid: false, reason: `Expected 402, got ${first.status}: ${await first.text()}` };

    // 2) Read the bill from the 402: how much, to which address, on which network.
    //    1 atomic USDC unit == Rp1 at our demo rate, so the amount reads as Rupiah.
    const body = await first.json().catch(() => undefined);
    const paymentRequired = httpClient!.getPaymentRequiredResponse((name) => first.headers.get(name), body);
    const requestedRp = Number(paymentRequired.accepts[0].amount);
    logPaymentRequired(requestedRp);

    // 3) Decide BEFORE signing anything: Jev (your hands-on code), then the guardrails, then you if needed.
    const state: PaymentState = {
      userRequest: request.userRequest,
      order: priced.order,
      budgetRp: request.budgetRp,
      menuPriceRp: priced.menuPriceRp,
      requestedPriceRp: requestedRp,
    };
    const decision = applyGuardrails(state, await decidePayment(state));
    if (!(await confirmPayment(state, decision))) {
      return {
        paid: false,
        reason: decision === "reject"
          ? "Rejected: the requested price does not match the menu"
          : "Not paid: the user declined because it is over budget",
        requestedRp,
      };
    }

    // 4) Sign a USDC payment with the buyer's key and order again with it attached.
    //    The warung hands it to the facilitator, which moves the USDC onchain.
    const payload = await httpClient!.createPaymentPayload(paymentRequired);
    const headers = httpClient!.encodePaymentSignatureHeader(payload);
    const paidRes = await fetch(url, { method: "POST", headers });
    if (!paidRes.ok) return { paid: false, reason: await describePaymentFailure(paidRes), requestedRp };
    const order = await paidRes.json();
    const tx = httpClient!.getPaymentSettleResponse((name) => paidRes.headers.get(name)).transaction;
    console.log(`  🔗 https://sepolia.basescan.org/tx/${tx}`);
    return { paid: true, requestedRp, order, tx };
  };
}
