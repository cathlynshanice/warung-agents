import { createInterface } from "node:readline/promises";

// One shared readline, so the chat loop and the "ask human" prompt don't fight over stdin.
export const terminal = createInterface({ input: process.stdin, output: process.stdout });

export async function askYesNo(question: string): Promise<boolean> {
  const answer = await terminal.question(`  🙋 ${question} (y/n) `).catch(() => "n");
  return answer.trim().toLowerCase().startsWith("y");
}
