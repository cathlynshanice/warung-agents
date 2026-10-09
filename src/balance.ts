// Reads the buyer's test USDC balance straight from the blockchain (public data, no key needed to read).
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { USDC_ADDRESS, usdcToRp } from "./config.js";

const chain = createPublicClient({ chain: baseSepolia, transport: http() });

export async function getBuyerBalance() {
  const key = process.env.BUYER_PRIVATE_KEY?.trim();
  if (!key) return { error: "No buyer wallet yet. Set BUYER_PRIVATE_KEY in .env (see README Step 4)." };

  const address = privateKeyToAccount(key as `0x${string}`).address;
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
