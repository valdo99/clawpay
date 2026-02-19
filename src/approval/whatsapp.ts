import type { PaymentRequest, PolicyResult } from "../types/index.js";

/**
 * WhatsApp approval handler (OpenClaw-native).
 *
 * This is a thin adapter — the actual message send/receive is handled
 * by OpenClaw's outbound messaging layer via injected callbacks.
 */

export type SendMessageFn = (text: string) => Promise<void>;
export type WaitForReplyFn = (timeoutMs: number) => Promise<string | null>;

export async function whatsappApproval(
  payment: PaymentRequest,
  policyResult: PolicyResult,
  sendMessage: SendMessageFn,
  waitForReply: WaitForReplyFn,
  timeoutMs: number = 300_000
): Promise<boolean> {
  const currency = payment.currency || "USD";

  const text = [
    "🔔 *ClawPayer Approval Request*",
    "",
    `*Amount:* ${currency} ${payment.amount.toFixed(2)}`,
    `*Merchant:* ${payment.merchant}`,
    `*Description:* ${payment.description}`,
    `*Reason:* ${policyResult.reason}`,
    "",
    'Reply *yes* to approve or *no* to deny.',
  ].join("\n");

  await sendMessage(text);

  const reply = await waitForReply(timeoutMs);

  if (!reply) {
    await sendMessage("⏰ Approval timed out — payment denied.");
    return false;
  }

  const normalized = reply.trim().toLowerCase();
  const approved = ["yes", "approve", "y", "approved"].includes(normalized);
  const denied = ["no", "deny", "n", "denied", "reject"].includes(normalized);

  if (approved) {
    await sendMessage("✅ Payment approved.");
    return true;
  }

  if (denied) {
    await sendMessage("❌ Payment denied.");
    return false;
  }

  // Unrecognized reply — treat as denial for safety
  await sendMessage(`Unrecognized reply "${reply}". Payment denied for safety.`);
  return false;
}
