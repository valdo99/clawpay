import { createInterface } from "node:readline";
import type { PaymentRequest, PolicyResult } from "../types/index.js";

/**
 * Terminal-based approval handler.
 *
 * Prints the payment request to stdout and waits for
 * the user to type "yes" or "no". Simple, no dependencies.
 */
export async function terminalApproval(
  payment: PaymentRequest,
  policyResult: PolicyResult,
  timeoutMs: number = 300_000
): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║       🦞 CLAWPAYER APPROVAL REQUEST       ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Amount:   $${payment.amount.toFixed(2).padEnd(29)}║`);
  console.log(`║  Merchant: ${payment.merchant.slice(0, 29).padEnd(29)}║`);
  console.log(`║  Reason:   ${payment.description.slice(0, 29).padEnd(29)}║`);
  console.log(`║  Currency: ${(payment.currency || "USD").padEnd(29)}║`);
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Policy:   ${policyResult.reason.slice(0, 29).padEnd(29)}║`);
  console.log("╚══════════════════════════════════════════╝");

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      console.log("\n⏰ Approval timed out. Payment denied.");
      rl.close();
      resolve(false);
    }, timeoutMs);

    rl.question("\nApprove this payment? (yes/no): ", (answer) => {
      clearTimeout(timer);
      rl.close();
      const approved = answer.trim().toLowerCase() === "yes";
      console.log(approved ? "✅ Payment approved." : "❌ Payment denied.");
      resolve(approved);
    });
  });
}
