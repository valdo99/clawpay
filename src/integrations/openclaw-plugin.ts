import { ClawPay } from "../core/clawpay.js";
import type { CardDetails, PaymentRequest } from "../types/index.js";
import { telegramApproval } from "../approval/telegram.js";
import { whatsappApproval } from "../approval/whatsapp.js";
import type { SendMessageFn, WaitForReplyFn } from "../approval/whatsapp.js";

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
  registerCommand?(command: {
    name: string;
    description: string;
    execute: (params: Record<string, unknown>) => Promise<void>;
  }): void;
  sendMessage?(chatId: string, text: string): Promise<void>;
  waitForReply?(chatId: string, timeoutMs: number): Promise<string | null>;
  getConfig(): Record<string, unknown>;
}

export default function register(api: OpenClawPluginApi) {
  let clawpay: ClawPay | null = null;
  const pendingApprovals = new Map<string, (approved: boolean) => void>();

  async function getClawPay(): Promise<ClawPay> {
    if (!clawpay) {
      const config = api.getConfig();
      const approvalMethod = (config.approval_method as string) ?? "terminal";

      // Telegram works natively through the router.
      // WhatsApp requires OpenClaw's messaging layer — use callback method
      // and handle it in the request_card execute override.
      const effectiveMethod =
        approvalMethod === "whatsapp" ? "callback" : approvalMethod;

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
          method: effectiveMethod as any,
          timeout: (config.approval_timeout as number) ?? 300,
          webhookUrl: config.approval_webhook_url as string | undefined,
          telegramBotToken: config.telegram_bot_token as string | undefined,
          telegramChatId: config.telegram_chat_id as string | undefined,
        },
      } as any);
      await clawpay.init();

      // Wire up WhatsApp approval via OpenClaw's messaging layer
      if (approvalMethod === "whatsapp") {
        if (!api.sendMessage || !api.waitForReply) {
          throw new Error(
            "WhatsApp approval requires OpenClaw's messaging API (sendMessage/waitForReply)."
          );
        }
        const whatsappChatId = config.whatsapp_chat_id as string;
        if (!whatsappChatId) {
          throw new Error("whatsapp_chat_id is required for WhatsApp approval.");
        }
        clawpay.onApproval = async (payment, policyResult, timeoutMs) => {
          const sendFn: SendMessageFn = (text) => api.sendMessage!(whatsappChatId, text);
          const waitFn: WaitForReplyFn = (ms) => api.waitForReply!(whatsappChatId, ms);
          return whatsappApproval(payment, policyResult, sendFn, waitFn, timeoutMs);
        };
      }
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
        const config = api.getConfig();
        const approvalMethod = (config.approval_method as string) ?? "terminal";

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

  // --- Slash commands for manual approval (telegram/whatsapp) ---

  if (api.registerCommand) {
    api.registerCommand({
      name: "/clawpay_approve",
      description: "Manually approve a pending ClawPay payment",
      async execute(params: Record<string, unknown>) {
        const id = params.id as string;
        const resolver = pendingApprovals.get(id);
        if (resolver) {
          resolver(true);
          pendingApprovals.delete(id);
        }
      },
    });

    api.registerCommand({
      name: "/clawpay_deny",
      description: "Manually deny a pending ClawPay payment",
      async execute(params: Record<string, unknown>) {
        const id = params.id as string;
        const resolver = pendingApprovals.get(id);
        if (resolver) {
          resolver(false);
          pendingApprovals.delete(id);
        }
      },
    });
  }
}
