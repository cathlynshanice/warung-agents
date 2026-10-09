// ✍️ Hands-on: TODO 5, the one part you write. Stuck? See solution/jev.ts or run `npm run dev:solution`.
import { choice } from "@typesafe-ai/sdk";
import { formatPrice } from "./config.js";
import { jev, type PaymentDecision, type PaymentState } from "./payment.js";

/** Ask Jev what to do with a Payment Request: approve, reject, or ask_human. */
export async function decidePayment(state: PaymentState): Promise<PaymentDecision> {
  // ✍️ TODO 5 — Jev decides the payment
  //   5a) Call jev.systemOne({ state, questions: { decision: choice(...) } })
  //       The choice has 3 options, each with a description:
  //         approve   : requested price is not higher than the menu price and is within the budget
  //         reject    : requested price is higher than the menu price (possible scam or price trick)
  //         ask_human : requested price is not higher than the menu price, but it is over the budget
  //   5b) Read answers.decision.choice and answers.decision.confidence
  //   5c) Log it, then return the choice
  void choice; void jev; void formatPrice; // (delete this line when you write TODO 5)
  throw new Error(`TODO 5: ask Jev to decide the payment for ${state.order}`);
}
