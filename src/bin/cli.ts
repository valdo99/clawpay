#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { stringify as toYaml } from "yaml";
import { Vault } from "../core/vault.js";
import type { ClawPayConfig } from "../types/index.js";

const CLAWPAY_DIR = join(homedir(), ".clawpay");
const CONFIG_FILE = join(CLAWPAY_DIR, "config.yaml");

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function init() {
  console.log("\n🦞 ClawPay Setup\n");
  console.log("This will create your encrypted card vault and payment policies.\n");

  const vault = new Vault("keychain");
  await vault.init();
  console.log("✅ Vault initialized (encryption key generated)\n");

  if (!existsSync(CONFIG_FILE)) {
    const defaultConfig: ClawPayConfig = {
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
        path: join(CLAWPAY_DIR, "transactions.json"),
      },
    };

    await writeFile(CONFIG_FILE, toYaml(defaultConfig), {
      encoding: "utf-8",
      mode: 0o600,
    });
    console.log(`✅ Config created at ${CONFIG_FILE}`);
    console.log("   Edit this file to customize your payment policies.\n");
  } else {
    console.log(`ℹ️  Config already exists at ${CONFIG_FILE}\n`);
  }
}

async function addCard() {
  console.log("\n🦞 ClawPay — Add Card\n");
  console.log("Your card details will be encrypted and stored locally.");
  console.log("They never leave this machine.\n");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const cardholderName = await ask(rl, "Cardholder name: ");
    const number = await ask(rl, "Card number: ");
    const expMonth = await ask(rl, "Expiry month (MM): ");
    const expYear = await ask(rl, "Expiry year (YY or YYYY): ");
    const cvv = await ask(rl, "CVV: ");

    console.log("\nBilling address (leave blank to skip):");
    const line1 = await ask(rl, "  Address line 1: ");

    const billingAddress = line1
      ? {
          line1,
          line2: await ask(rl, "  Address line 2: "),
          city: await ask(rl, "  City: "),
          state: await ask(rl, "  State: "),
          postalCode: await ask(rl, "  Postal code: "),
          country: await ask(rl, "  Country (e.g., US): "),
        }
      : undefined;

    const vault = new Vault("keychain");
    await vault.storeCard({
      cardholderName,
      number: number.replace(/\s/g, ""),
      expMonth,
      expYear,
      cvv,
      billingAddress: billingAddress?.line1 ? billingAddress : undefined,
    });

    console.log("\n✅ Card encrypted and stored.");
    console.log("   Your agents can now request it through ClawPay.\n");
  } finally {
    rl.close();
  }
}

async function status() {
  console.log("\n🦞 ClawPay Status\n");

  const vault = new Vault("keychain");
  const hasCard = await vault.hasCard();

  console.log(`Vault:  ${hasCard ? "✅ Card stored" : "❌ No card stored"}`);
  console.log(`Config: ${existsSync(CONFIG_FILE) ? "✅ Found" : "❌ Not found"}`);
  console.log(`Dir:    ${CLAWPAY_DIR}\n`);
}

// --- CLI Router ---

const command = process.argv[2];

switch (command) {
  case "init":
    init().catch(console.error);
    break;
  case "add-card":
    addCard().catch(console.error);
    break;
  case "status":
    status().catch(console.error);
    break;
  default:
    console.log(`
🦞 ClawPay — Payment gateway for AI agents

Usage:
  clawpay init        Initialize vault and create default config
  clawpay add-card    Store a credit card in the encrypted vault
  clawpay status      Check vault and config status

MCP Server:
  clawpay serve       Start the MCP server (stdio transport)

Config: ~/.clawpay/config.yaml
    `);
}
