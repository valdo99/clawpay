import type { PaymentRequest, PolicyResult } from "../types/index.js";

/**
 * Webhook-based approval handler.
 *
 * Sends the payment request to a user-defined webhook URL
 * and polls for a response. The webhook should return:
 *   { "approved": true|false }
 *
 * This allows integration with any custom approval system —
 * Slack bots, Telegram bots, mobile apps, whatever.
 */
export async function webhookApproval(
  payment: PaymentRequest,
  policyResult: PolicyResult,
  webhookUrl: string,
  timeoutMs: number = 300_000
): Promise<boolean> {
  const payload = {
    type: "clawpayer_approval_request",
    payment: {
      amount: payment.amount,
      merchant: payment.merchant,
      description: payment.description,
      currency: payment.currency || "USD",
    },
    policy: {
      action: policyResult.action,
      reason: policyResult.reason,
    },
    timestamp: Date.now(),
    expiresAt: Date.now() + timeoutMs,
  };

  try {
    // Send the approval request
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        `Webhook returned ${response.status}. Denying payment.`
      );
      return false;
    }

    const result = await response.json();

    // If the webhook responds immediately with a decision
    if (typeof result.approved === "boolean") {
      return result.approved;
    }

    // If the webhook returns a poll URL, poll for decision
    if (result.pollUrl) {
      return pollForApproval(result.pollUrl, timeoutMs);
    }

    console.error("Webhook response missing 'approved' field. Denying.");
    return false;
  } catch (err) {
    console.error(`Webhook error: ${err}. Denying payment.`);
    return false;
  }
}

async function pollForApproval(
  pollUrl: string,
  timeoutMs: number,
  intervalMs: number = 3000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(pollUrl);
      if (response.ok) {
        const result = await response.json();
        if (typeof result.approved === "boolean") {
          return result.approved;
        }
        // Still pending, keep polling
      }
    } catch {
      // Network error, keep trying
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  console.error("Approval poll timed out. Denying payment.");
  return false;
}
