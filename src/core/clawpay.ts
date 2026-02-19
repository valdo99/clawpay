import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { Vault } from "./vault.js";
import { PolicyEngine } from "./policy.js";
import { requestApproval } from "../approval/index.js";
import type {
  CardDetails,
  PaymentRequest,
  PolicyResult,
  TransactionLog,
  ClawPayConfig,
} from "../types/index.js";

const CONFIG_FILE = join(homedir(), ".clawpay", "config.yaml");

const DEFAULT_CONFIG: ClawPayConfig = {
  vault: {
    encryption: "aes-256-gcm",
    keyStorage: "keychain",
  },
  policies: {
    autoApproveUnder: 25.0,
    requireApprovalAbove: 25.0,
    blockAbove: 1000.0,
    dailyLimit: 200.0,
    monthlyLimit: 2000.0,
    blockedKeywords: [],
    currency: "USD",
  },
  approval: {
    method: "terminal",
    timeout: 300,
  },
  logging: {
    enabled: true,
    path: join(homedir(), ".clawpay", "transactions.json"),
  },
};

/**
 * ClawPay — the core engine.
 *
 * Ties together the vault (encrypted card storage),
 * the policy engine (rules evaluation), and the approval
 * system (human-in-the-loop) into a single interface.
 *
 * This is what the MCP server and OpenClaw plugin both talk to.
 */
export type ApprovalCallback = (
  payment: PaymentRequest,
  policyResult: PolicyResult,
  timeoutMs: number
) => Promise<boolean>;

export class ClawPay {
  private vault: Vault;
  private policy: PolicyEngine;
  private config: ClawPayConfig;
  public onApproval?: ApprovalCallback;

  constructor(config?: Partial<ClawPayConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config } as ClawPayConfig;
    this.vault = new Vault(this.config.vault.keyStorage);
    this.policy = new PolicyEngine(this.config.policies);
  }

  /**
   * Load ClawPay from the config file.
   */
  static async load(): Promise<ClawPay> {
    if (!existsSync(CONFIG_FILE)) {
      return new ClawPay();
    }

    const raw = await readFile(CONFIG_FILE, "utf-8");
    const config: ClawPayConfig = parseYaml(raw);
    return new ClawPay(config);
  }

  /**
   * Initialize vault (generate encryption key, create directories).
   */
  async init(): Promise<void> {
    await this.vault.init();
  }

  /**
   * Store a card in the vault.
   */
  async storeCard(card: CardDetails): Promise<void> {
    await this.vault.storeCard(card);
  }

  /**
   * The main entry point for agents.
   *
   * 1. Agent calls requestCard with payment details
   * 2. Policy engine evaluates the request
   * 3. If auto-approved → return card details
   * 4. If requires approval → ask the human, then return card details if approved
   * 5. If denied → return denial reason
   *
   * Returns card details on approval, or throws with denial reason.
   */
  async requestCard(
    request: PaymentRequest
  ): Promise<{ approved: true; card: CardDetails } | { approved: false; reason: string }> {
    // Check vault has a card
    const hasCard = await this.vault.hasCard();
    if (!hasCard) {
      return { approved: false, reason: "No card stored. Run `clawpay add-card` first." };
    }

    // Evaluate policy
    const policyResult = await this.policy.evaluate(request);

    // Denied by policy
    if (policyResult.action === "deny") {
      await this.logTransaction(request, policyResult, false, "auto");
      return { approved: false, reason: policyResult.reason };
    }

    // Auto-approved
    if (policyResult.action === "auto_approve") {
      const card = await this.vault.getCard();
      await this.logTransaction(request, policyResult, true, "auto");
      return { approved: true, card };
    }

    // Requires human approval
    const timeoutMs = (this.config.approval.timeout || 300) * 1000;
    const approved = this.onApproval
      ? await this.onApproval(request, policyResult, timeoutMs)
      : await requestApproval(request, policyResult, this.config.approval);

    if (!approved) {
      await this.logTransaction(request, policyResult, false, "human");
      return { approved: false, reason: "Payment denied by user." };
    }

    const card = await this.vault.getCard();
    await this.logTransaction(request, policyResult, true, "human");
    return { approved: true, card };
  }

  /**
   * Get the current policy (so agents can check before requesting).
   */
  getPolicy() {
    return this.policy.getPolicy();
  }

  /**
   * Check if vault has a card stored.
   */
  async hasCard(): Promise<boolean> {
    return this.vault.hasCard();
  }

  // --- Internal ---

  private async logTransaction(
    payment: PaymentRequest,
    policyResult: PolicyResult,
    approved: boolean,
    approvedBy: "auto" | "human"
  ): Promise<void> {
    if (!this.config.logging.enabled) return;

    const log: TransactionLog = {
      id: randomUUID(),
      timestamp: Date.now(),
      payment,
      policyResult,
      approved,
      approvedBy,
    };

    await this.policy.logTransaction(log);
  }
}
