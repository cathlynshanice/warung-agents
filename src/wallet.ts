// Makes a fresh TESTNET wallet. Run it twice: once for the buyer, once for the warung.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("🔑 New Base Sepolia test wallet (never use it for real money)");
console.log(`   Address    : ${account.address}`);
console.log(`   Private key: ${privateKey}`);
console.log("");
console.log("Buyer wallet  -> BUYER_PRIVATE_KEY=<private key>  (fund the address at faucet.circle.com)");
console.log("Warung wallet -> WARUNG_ADDRESS=<address>         (the private key is not needed)");
