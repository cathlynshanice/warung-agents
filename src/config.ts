import "dotenv/config";

export const NETWORK = "eip155:84532"; // Base Sepolia
export const PORT = Number(process.env.PORT ?? 4021);
export const WARUNG_URL = process.env.WARUNG_URL ?? `http://localhost:${PORT}`;
export const WARUNG_NAME = process.env.WARUNG_NAME ?? "Warung Bu Sri";
export const MOCK_PAYMENT = process.env.MOCK_PAYMENT === "true";
export const GREEDY_MODE = process.env.GREEDY_MODE === "true";

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`❌ ${name} is missing. Add it to .env (see README.md).`);
    process.exit(1);
  }
  return value;
}

export function formatRp(rp: number): string {
  return `Rp${rp.toLocaleString("id-ID")}`;
}

// Demo rate: Rp1.000 = 0.001 test USDC. USDC has 6 decimals, so
// 1 atomic USDC unit == Rp1 and the 402's `amount` reads directly as Rupiah.
export function rpToUsdc(rp: number): number {
  return rp / 1_000_000;
}

export function rpToUsd(rp: number): string {
  return `$${rpToUsdc(rp).toFixed(6)}`;
}
