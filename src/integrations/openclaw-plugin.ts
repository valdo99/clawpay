import { ClawPay } from "../core/clawpay.js";
import type { CardDetails, PaymentRequest } from "../types/index.js";

/**
 * ClawPay OpenClaw Plugin
 *
 * Registers ClawPay tools within the OpenClaw agent framework.
 * When installed as an OpenClaw extension, Moltbot and other
 * OpenClaw agents can request card details through the policy gate.
 *
 * Install: copy this extension to your OpenClaw extensions/ directory
 * Configure: via openclaw.plugin.json configSchema
 */

interface OpenClawPluginApi {
  registerTool(
    tool: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      execute: (
        callId: string,
        params: Record<string, unknown>
      ) => Promise<{ content: Array<{ type: string; text: string }> }>;
    },
    options?: { optional?: boolean }
  ): void;
  getConfig(): Record<string, unknown>;
}

export default function register(api: OpenClawPluginApi) {
  let clawpay: ClawPay | null = null;

  async function getClawPay(): Promise<ClawPay> {
    if (!clawpay) {
      const config = api.getConfig();
      clawpay = new ClawPay({
        policies: {
          autoApproveUnder: (config.auto_approve_under as number) ?? 25,
          requireApprovalAbove: (config.require_approval_above as number) ?? 25,
          blockAbove: (config.block_above as number) ?? 1000,
          dailyLimit: (config.daily_limit as number) ?? 200,
          monthlyLimit: (config.monthly_limit as number) ?? 2000,
          blockedKeywords: (config.blocked_keywords as string[]) ?? [],
          currency: (config.currency as string) ?? "USD",
        },
        approval: {
          method: (config.approval_method as "terminal" | "webhook") ?? "terminal",
          timeout: (config.approval_timeout as number) ?? 300,
          webhookUrl: config.approval_webhook_url as string | undefined,
        },
      } as any);
      await clawpay.init();
    }
    return clawpay;
  }

  // --- request_card tool ---

  api.registerTool(
    {
      name: "request_card",
      description: `Request stored credit card details to complete a payment.
The card will ONLY be returned if the payment passes the user's policy rules.
Call this BEFORE filling in any payment form on a website.`,
      parameters: {
        type: "object",
        properties: {
          amount: {
            type: "number",
            description: "The total payment amount",
          },
          merchant: {
            type: "string",
            description: "The merchant name or website domain",
          },
          description: {
            type: "string",
            description: "Brief description of the purchase",
          },
          currency: {
            type: "string",
            description: "Currency code (default: USD)",
          },
        },
        required: ["amount", "merchant", "description"],
      },
      async execute(_callId: string, params: Record<string, unknown>) {
        const cp = await getClawPay();
        const result = await cp.requestCard({
          amount: params.amount as number,
          merchant: params.merchant as string,
          description: params.description as string,
          currency: params.currency as string | undefined,
        });

        if (result.approved) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  approved: true,
                  cardholderName: result.card.cardholderName,
                  number: result.card.number,
                  expMonth: result.card.expMonth,
                  expYear: result.card.expYear,
                  cvv: result.card.cvv,
                  billingAddress: result.card.billingAddress,
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ approved: false, reason: result.reason }),
            },
          ],
        };
      },
    },
    { optional: true } // User must explicitly enable this tool
  );

  // --- get_payment_policy tool ---

  api.registerTool(
    {
      name: "get_payment_policy",
      description:
        "Get the user's spending rules. Call this before attempting a purchase to know limits.",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute(_callId: string, _params: Record<string, unknown>) {
        const cp = await getClawPay();
        const policy = cp.getPolicy();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(policy),
            },
          ],
        };
      },
    },
    { optional: true }
  );
}
