import { Bot } from "grammy";
import type { PaymentRequest, PolicyResult } from "../types/index.js";

/**
 * Telegram Bot API approval handler.
 *
 * Sends an inline-keyboard message to the configured chat and
 * long-polls for the callback query response.
 */
export async function telegramApproval(
  payment: PaymentRequest,
  policyResult: PolicyResult,
  botToken: string,
  chatId: string,
  timeoutMs: number = 300_000
): Promise<boolean> {
  const bot = new Bot(botToken);
  const approvalId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const currency = payment.currency || "USD";

  const text = [
    "🔔 *ClawPay Approval Request*",
    "",
    `*Amount:* ${currency} ${payment.amount.toFixed(2)}`,
    `*Merchant:* ${payment.merchant}`,
    `*Description:* ${payment.description}`,
    `*Reason:* ${policyResult.reason}`,
    "",
    "Approve or deny this payment:",
  ].join("\n");

  const sentMessage = await bot.api.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `approve_${approvalId}` },
          { text: "❌ Deny", callback_data: `deny_${approvalId}` },
        ],
      ],
    },
  });

  try {
    return await pollCallbackQuery(bot, approvalId, chatId, sentMessage.message_id, timeoutMs);
  } finally {
    // Ensure we don't leave dangling connections
    await bot.api.deleteWebhook().catch(() => {});
  }
}

async function pollCallbackQuery(
  bot: Bot,
  approvalId: string,
  chatId: string,
  messageId: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let offset = 0;

  while (Date.now() < deadline) {
    const remaining = Math.min(30, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining <= 0) break;

    const updates = await bot.api.getUpdates({
      offset,
      timeout: remaining,
      allowed_updates: ["callback_query"],
    });

    for (const update of updates) {
      offset = update.update_id + 1;

      const cb = update.callback_query;
      if (!cb?.data) continue;

      if (
        cb.data === `approve_${approvalId}` ||
        cb.data === `deny_${approvalId}`
      ) {
        const approved = cb.data.startsWith("approve_");
        const resultText = approved ? "✅ Payment approved" : "❌ Payment denied";

        await bot.api.answerCallbackQuery(cb.id, { text: resultText });
        await bot.api.editMessageText(chatId, messageId, resultText);

        return approved;
      }
    }
  }

  await bot.api.editMessageText(chatId, messageId, "⏰ Approval timed out — payment denied.");
  return false;
}
