# 🦞 ClawPay

**A payment gateway for AI agents. Self-hosted. Open source. No SaaS. No bullshit.**

ClawPay is an encrypted card vault with a policy engine that lets AI agents make payments on your behalf — with rules you control.

Your agent browses a store, picks items, gets to checkout, and calls ClawPay. ClawPay checks your rules, asks for your approval if needed, and hands over the card details. The agent fills in the form. Done.

Works as a **standalone MCP server** (Claude, Cursor, any MCP client) and as an **OpenClaw plugin** (Moltbot and other OpenClaw agents).

---

## Before you @ us about security

Yeah, we know. We're going to get replies like:

> "You're storing credit card numbers locally?? That's insane!"
>
> "This will never be PCI compliant!"
>
> "Giving an LLM access to payment info is reckless!"

Cool. Let's talk about what's actually reckless.

**You gave an AI agent full access to your computer.** It can read your files, execute code, browse the web, and click buttons on your behalf. It has access to your email, your documents, your terminal, your browser sessions. You let it run shell commands. You let it navigate authenticated web pages. You gave it your whole digital life and said "yeah go ahead."

But a credit card number encrypted with AES-256 on your own machine? *That's* where we draw the line? That's the security concern?

**"But what about UCP and AP2?"** Yeah, we know about them. Google launched the [Universal Commerce Protocol](https://ucp.dev) with Shopify, Visa, Mastercard, Stripe, and 20+ partners. It's an open standard for agentic commerce — merchants expose a `/.well-known/ucp` endpoint, agents talk to it, and [AP2](https://github.com/google-agentic-commerce/AP2) handles the payment trust layer with cryptographic mandates so prices can't change mid-flow and everything is verifiable. It's genuinely good protocol design.

**And it requires every single merchant to adopt it.**

Target, Walmart, Shopify stores — sure, they'll get there. But the vintage camera shop in Tokyo? The niche supplement store in Portugal? The indie artisan on a self-hosted WooCommerce? The random e-commerce site your agent just found through a Google search? They're running a checkout form with card fields. That's it. No `/.well-known/ucp`. No AP2 mandates. No agentic commerce endpoint. Just HTML inputs waiting for 16 digits.

UCP/AP2 is the right long-term answer for structured agentic commerce. **ClawPay is the answer for the other 99% of the internet that's still just a checkout form.** When UCP achieves universal adoption, ClawPay becomes unnecessary. We genuinely look forward to that day. But we're not going to sit here and wait for it while agents can do everything *except* pay for things.

**We chose to ship.** Is it perfect? No. Is it more dangerous than the 47 other things your agent already has access to? Absolutely not. Your agent can already `rm -rf` your home directory, send emails as you, and post on your social media. But sure, let's pretend the credit card is the dangerous part.

The current state of agentic technology demands that we move fast and adapt existing tools to work with agents. Every day we wait for the "perfect secure solution" is a day agents remain crippled at the most critical step of any transaction. We'd rather give people a tool with guardrails than have them paste card numbers into chat windows — which, let's be honest, is what's already happening.

**ClawPay is a pragmatic bridge.** It's not the final answer. It's the answer for right now. Use UCP/AP2 when the merchant supports it. Use ClawPay when they don't. When better infrastructure exists everywhere, we'll happily deprecate ourselves. Until then, this is the best you've got — and it's a hell of a lot better than the alternatives.

---

## How it works

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐
│   AI Agent   │────▶│   ClawPay    │────▶│  Checkout  │
│ (Moltbot,    │     │              │     │  (Shopify, │
│  Claude,     │  1. request_card() │     │   Amazon,  │
│  Cursor)     │◀────│  2. policy   │     │   any site)│
│              │     │  3. approve? │     │            │
│              │card │  4. decrypt  │     │            │
│              │info │  5. return   │     │            │
│              │────▶│              │────▶│            │
└─────────────┘     └──────────────┘     └───────────┘
```

1. Agent is at a checkout page and needs to pay
2. Agent calls `request_card(amount, merchant, description)`
3. ClawPay's policy engine evaluates the request:
   - **Under $25?** Auto-approved. Card details returned instantly.
   - **Over $25?** Human approval required. You get a prompt.
   - **Over $1000?** Blocked. No card for you.
   - **Daily limit hit?** Blocked.
   - **Blocked merchant?** Blocked.
4. If approved, ClawPay decrypts the card from the local vault
5. Agent receives card details and fills in the checkout form

**The agent never gets card info without passing through the policy gate.**

---

## Quick start

### Install

```bash
npx clawpay init
```

This creates `~/.clawpay/` with an encryption key (stored in your system keychain) and a default config.

### Add your card

```bash
npx clawpay add-card
```

Card details are encrypted with AES-256-GCM and stored locally. They never leave your machine.

### Configure policies

Edit `~/.clawpay/config.yaml`:

```yaml
policies:
  autoApproveUnder: 25.00
  requireApprovalAbove: 25.00
  blockAbove: 1000.00
  dailyLimit: 200.00
  monthlyLimit: 2000.00
  blockedKeywords:
    - gambling
    - crypto
  blockedMerchants:
    - sketchy-site.com
  currency: USD

approval:
  method: terminal    # terminal | webhook | slack
  timeout: 300        # seconds before auto-deny
```

### Use with any MCP client

Add to your Claude Desktop / Cursor / etc MCP config:

```json
{
  "mcpServers": {
    "clawpay": {
      "command": "npx",
      "args": ["clawpay", "serve"]
    }
  }
}
```

### Use with OpenClaw

ClawPay ships as a native [OpenClaw](https://github.com/openclaw/openclaw) plugin. It registers `request_card` and `get_payment_policy` as **optional agent tools** — meaning your agent (Moltbot, etc.) won't use them unless you explicitly enable them.

**Option A — Install via npm (recommended)**

```bash
openclaw plugins install clawpay
```

**Option B — Manual install (from source)**

Clone this repo into your OpenClaw `extensions/` directory:

```bash
cd /path/to/openclaw/extensions
git clone https://github.com/valdo99/clawpay.git
cd clawpay
npm install && npm run build
```

The directory structure OpenClaw expects:

```
openclaw/
  extensions/
    clawpay/
      openclaw.plugin.json   ← plugin manifest (required)
      dist/
        integrations/
          openclaw-plugin.js  ← entry point
        core/
          ...                 ← vault, policy, approval
      package.json
```

**Configure the plugin**

In your OpenClaw config, add ClawPay settings:

```yaml
plugins:
  clawpay:
    auto_approve_under: 25
    require_approval_above: 25
    block_above: 1000
    daily_limit: 200
    monthly_limit: 2000
    currency: USD
    blocked_keywords:
      - gambling
    approval_method: terminal   # terminal | webhook
    approval_timeout: 300
```

**Enable the tools for your agent**

ClawPay tools are registered as `optional: true` for safety — an agent can't use them until you explicitly allow it. In your OpenClaw agent config:

```yaml
agents:
  list:
    - id: main
      tools:
        allow:
          - request_card
          - get_payment_policy
          # or allow all clawpay tools at once:
          # - clawpay
```

**Initialize the vault**

Before your agent can request card details, you need to set up the encrypted vault:

```bash
npx clawpay init        # generates encryption key, stores in keychain
npx clawpay add-card    # encrypts and stores your card locally
```

That's it. Your OpenClaw agent can now call `request_card` at checkout. The policy engine evaluates every request, and the approval handler kicks in for anything above your auto-approve threshold.

---

## MCP Tools

### `request_card`

The main tool. Agent calls this before filling in a payment form.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| amount | number | yes | Total payment amount |
| merchant | string | yes | Merchant name or domain |
| description | string | yes | What's being purchased |
| currency | string | no | Currency code (default: USD) |

**Returns** (if approved):
```json
{
  "approved": true,
  "cardholderName": "John Doe",
  "number": "4242424242424242",
  "expMonth": "12",
  "expYear": "2027",
  "cvv": "123",
  "billingAddress": { ... }
}
```

**Returns** (if denied):
```json
{
  "approved": false,
  "reason": "Amount $500 requires human approval — user denied."
}
```

### `get_payment_policy`

Lets the agent check your rules before attempting a purchase. No card info is returned.

### `check_card_status`

Check if a card is stored. No card info is returned.

---

## Architecture

```
clawpay/
  src/
    core/
      vault.ts         # AES-256-GCM encrypted card storage
      policy.ts        # Rule evaluation engine
      clawpay.ts       # Main engine (vault + policy + approval)
    integrations/
      mcp-server.ts    # Standalone MCP server (stdio)
      openclaw-plugin.ts # OpenClaw extension
    approval/
      terminal.ts      # CLI-based approval prompts
      webhook.ts       # Webhook/Slack approval
      index.ts         # Approval router
    types/
      index.ts         # TypeScript types
    bin/
      cli.ts           # CLI tool (init, add-card, status)
  openclaw.plugin.json # OpenClaw plugin manifest
```

**Vault:** Your card is encrypted with AES-256-GCM. The encryption key is stored in your system keychain (macOS Keychain, Linux secret-service, Windows Credential Manager). Fallback to file-based key storage if keychain is unavailable. The encrypted vault lives at `~/.clawpay/vault.enc`.

**Policy engine:** YAML-driven rules. Amount thresholds, daily/monthly limits, merchant allow/block lists, keyword filters. All evaluated locally.

**Approval:** Pluggable. Terminal prompts for local use, webhooks for anything else (Slack bots, Telegram bots, mobile apps, your own dashboard). Easy to add new approval channels.

**Transaction log:** Every request (approved or denied) is logged to `~/.clawpay/transactions.json` for your records.

---

## Extending ClawPay

### Add a new approval channel

Create a function matching this signature:

```typescript
async function myApproval(
  payment: PaymentRequest,
  policyResult: PolicyResult,
  timeoutMs: number
): Promise<boolean>
```

Add it to `src/approval/` and wire it into the router in `src/approval/index.ts`.

### Use as a library

```typescript
import { ClawPay } from "clawpay";

const cp = await ClawPay.load();
const result = await cp.requestCard({
  amount: 29.99,
  merchant: "cool-store.com",
  description: "A very cool hat",
});

if (result.approved) {
  // result.card has the details
}
```

---

## Roadmap

- [ ] UCP/AP2 adapter — detect `/.well-known/ucp` and use the proper protocol when available, fall back to raw card entry when not
- [ ] Multi-card support (personal vs business)
- [ ] Per-merchant spending limits
- [ ] Receipt / order confirmation parsing
- [ ] Browser extension for approval notifications
- [ ] Transaction dashboard (local web UI)
- [ ] Plugin system for custom policy rules
- [ ] E2E tests

---

## FAQ

**Is this PCI compliant?**
No, and it's not trying to be. PCI-DSS applies to businesses that store/process/transmit cardholder data as a service. This is a self-hosted tool storing your own card on your own machine, like a password manager. If you're running this for yourself, PCI doesn't apply to you the same way it applies to Stripe.

**What if my machine is compromised?**
Then the attacker has access to everything else on your machine too — your browser sessions, saved passwords, cookies, email, SSH keys. The encrypted card vault is frankly the least of your problems. But yes, the card data is encrypted at rest with AES-256-GCM and the key lives in your system keychain, which is also encrypted.

**Can agents just ask for the card without a real purchase?**
They can ask. The policy engine decides. If an agent requests card details for "amount: $0.01, merchant: definitely-not-a-scam.com" it still has to pass your rules. And every request is logged.

**Why not just use UCP / AP2?**
You should — when the merchant supports it. UCP is the right protocol for structured agentic commerce, and AP2's cryptographic mandates are a better trust model than what ClawPay offers. But UCP requires merchant adoption. Today that means a handful of big retailers. ClawPay works with any checkout form on any website, right now, with zero merchant integration. Use UCP when you can, ClawPay when you can't.

**Why not just use Stripe / virtual cards / Apple Pay?**
Because none of those work at an arbitrary web checkout initiated by an agent today. Stripe requires merchant integration. Virtual cards require a platform. Apple Pay requires the specific browser and device flow. ClawPay works with any checkout, any merchant, right now.

---

## Contributing

PRs welcome. Especially for:

- New approval channels (Discord, Telegram, email, mobile push)
- Better policy rules
- Security improvements
- Tests
- Documentation

---

## License

MIT

---

*Built because the world is going agentic whether the payment infrastructure is ready or not.*
