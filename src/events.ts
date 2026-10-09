// Structured events from the Buyer Agent, so the web UI can show more than log lines.
// The terminal version ignores them; nothing here changes how payments work.
import { EventEmitter } from "node:events";
import type { PaymentDecision } from "./payment.js";

export type BuyerEvent =
  | {
      type: "decision";
      order: string;
      menuPriceRp: number;
      requestedPriceRp: number;
      budgetRp: number;
      decision: PaymentDecision;
    }
  | { type: "order"; paid: boolean; reason?: string; tx?: string; requestedRp?: number };

export const buyerEvents = new EventEmitter();

export function emitBuyerEvent(event: BuyerEvent): void {
  buyerEvents.emit("event", event);
}
