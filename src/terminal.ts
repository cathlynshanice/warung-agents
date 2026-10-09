import { createInterface, type Interface } from "node:readline/promises";

// One shared readline, so the chat loop and the "ask human" prompt don't fight over stdin.
// Created on first use, so the web UI (which never reads stdin) doesn't grab the terminal.
let rl: Interface | undefined;
export function terminal(): Interface {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

// The web UI replaces the y/n terminal prompt with buttons.
type ConfirmHandler = (question: string) => Promise<boolean>;
let confirmHandler: ConfirmHandler | undefined;
export function setConfirmHandler(handler: ConfirmHandler): void {
  confirmHandler = handler;
}

export async function askYesNo(question: string): Promise<boolean> {
  if (confirmHandler) return confirmHandler(question);
  const answer = await terminal().question(`  🙋 ${question} (y/n) `).catch(() => "n");
  return answer.trim().toLowerCase().startsWith("y");
}
