// Reads test USDC balances straight from the blockchain (public data, no key needed to read).
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { USDC_ADDRESS, usdcToRp } from "./config.js";

const chain = createPublicClient({ chain: baseSepolia, transport: http() });

export async function getUsdcBalance(address: `0x${string}`) {
  const raw = await chain.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address] });
  const usdc = Number(formatUnits(raw, 6));
  return {
    network: "Base Sepolia (testnet, uang mainan)",
    address,
    balanceUsdc: usdc,
    rupiahAtDemoRate: usdcToRp(usdc),
    explorer: `https://sepolia.basescan.org/address/${address}`,
  };
}

export async function getBuyerBalance() {
  const key = process.env.BUYER_PRIVATE_KEY?.trim();
  if (!key) return { error: "No buyer wallet yet. Set BUYER_PRIVATE_KEY in .env (see README Step 4)." };
  return getUsdcBalance(privateKeyToAccount(key as `0x${string}`).address);
}

export async function getWarungBalance() {
  const address = process.env.WARUNG_ADDRESS?.trim();
  if (!address) return { error: "No warung wallet yet. Set WARUNG_ADDRESS in .env." };
  return getUsdcBalance(address as `0x${string}`);
}
