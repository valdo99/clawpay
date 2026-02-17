import type { PaymentRequest, PolicyResult, ClawPayConfig } from "../types/index.js";
import { terminalApproval } from "./terminal.js";
import { webhookApproval } from "./webhook.js";

/**
 * Route approval requests to the configured handler.
 */
export async function requestApproval(
  payment: PaymentRequest,
  policyResult: PolicyResult,
  config: ClawPayConfig["approval"]
): Promise<boolean> {
  const timeoutMs = (config.timeout || 300) * 1000;

  switch (config.method) {
    case "terminal":
      return terminalApproval(payment, policyResult, timeoutMs);

    case "webhook":
      if (!config.webhookUrl) {
        throw new Error("Webhook URL not configured for approval.");
      }
      return webhookApproval(payment, policyResult, config.webhookUrl, timeoutMs);

    case "slack":
      if (!config.slackWebhookUrl) {
        throw new Error("Slack webhook URL not configured for approval.");
      }
      // Slack incoming webhooks use the same pattern
      return webhookApproval(payment, policyResult, config.slackWebhookUrl, timeoutMs);

    case "callback":
      // For programmatic use — the caller provides their own approval logic
      throw new Error(
        "Callback approval must be handled by the integration layer."
      );

    default:
      console.error(`Unknown approval method: ${config.method}. Denying.`);
      return false;
  }
}
