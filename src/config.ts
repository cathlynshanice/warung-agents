import "dotenv/config";

export const NETWORK = "eip155:84532"; // Base Sepolia
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // test USDC on Base Sepolia
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

/** e.g. "0.03 USDC (Rp30.000)" */
export function formatPrice(rp: number): string {
  return `${rpToUsdc(rp)} USDC (${formatRp(rp)})`;
}

// Demo rate: Rp1.000 = 0.001 test USDC. USDC has 6 decimals, so
// 1 atomic USDC unit == Rp1 and the 402's `amount` reads directly as Rupiah.
export function rpToUsdc(rp: number): number {
  return rp / 1_000_000;
}

export function usdcToRp(usdc: number): number {
  return Math.round(usdc * 1_000_000);
}

export function rpToUsd(rp: number): string {
  return `$${rpToUsdc(rp).toFixed(6)}`;
}
