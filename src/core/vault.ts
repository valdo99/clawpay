import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CardDetails, EncryptedPayload } from "../types/index.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const CLAWPAYER_DIR = join(homedir(), ".clawpayer");
const VAULT_FILE = join(CLAWPAYER_DIR, "vault.enc");
const KEY_SERVICE = "clawpayer";
const KEY_ACCOUNT = "vault-key";

/**
 * Vault — encrypted local storage for card details.
 *
 * Card data is encrypted with AES-256-GCM.
 * The encryption key is stored in the system keychain when available,
 * or in a local file as fallback.
 *
 * Nothing ever leaves the machine. No cloud, no accounts, no bullshit.
 */
export class Vault {
  private keyStorage: "keychain" | "file" | "env";

  constructor(keyStorage: "keychain" | "file" | "env" = "keychain") {
    this.keyStorage = keyStorage;
  }

  /**
   * Initialize the vault directory and generate an encryption key
   * if one doesn't already exist.
   */
  async init(): Promise<void> {
    if (!existsSync(CLAWPAYER_DIR)) {
      await mkdir(CLAWPAYER_DIR, { recursive: true, mode: 0o700 });
    }

    const existingKey = await this.getKey();
    if (!existingKey) {
      const key = randomBytes(KEY_LENGTH);
      await this.storeKey(key);
    }
  }

  /**
   * Store card details in the encrypted vault.
   */
  async storeCard(card: CardDetails): Promise<void> {
    const key = await this.getKey();
    if (!key) {
      throw new Error("Vault not initialized. Run `clawpayer init` first.");
    }

    const encrypted = this.encrypt(JSON.stringify(card), key);
    await writeFile(VAULT_FILE, JSON.stringify(encrypted), {
      encoding: "utf-8",
      mode: 0o600,
    });
  }

  /**
   * Retrieve and decrypt card details from the vault.
   */
  async getCard(): Promise<CardDetails> {
    const key = await this.getKey();
    if (!key) {
      throw new Error("Vault not initialized. Run `clawpayer init` first.");
    }

    if (!existsSync(VAULT_FILE)) {
      throw new Error("No card stored. Run `clawpayer add-card` first.");
    }

    const raw = await readFile(VAULT_FILE, "utf-8");
    const encrypted: EncryptedPayload = JSON.parse(raw);
    const decrypted = this.decrypt(encrypted, key);

    return JSON.parse(decrypted) as CardDetails;
  }

  /**
   * Check if a card is stored in the vault.
   */
  async hasCard(): Promise<boolean> {
    return existsSync(VAULT_FILE);
  }

  /**
   * Delete the stored card (overwrites file with zeros before deleting).
   */
  async deleteCard(): Promise<void> {
    if (existsSync(VAULT_FILE)) {
      // Overwrite with random data before deleting
      const garbage = randomBytes(1024);
      await writeFile(VAULT_FILE, garbage);
      const { unlink } = await import("node:fs/promises");
      await unlink(VAULT_FILE);
    }
  }

  // --- Encryption ---

  private encrypt(plaintext: string, key: Buffer): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf-8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      data: encrypted,
    };
  }

  private decrypt(payload: EncryptedPayload, key: Buffer): string {
    const iv = Buffer.from(payload.iv, "hex");
    const authTag = Buffer.from(payload.authTag, "hex");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(payload.data, "hex", "utf-8");
    decrypted += decipher.final("utf-8");

    return decrypted;
  }

  // --- Key Management ---

  private async getKey(): Promise<Buffer | null> {
    switch (this.keyStorage) {
      case "keychain":
        return this.getKeyFromKeychain();
      case "file":
        return this.getKeyFromFile();
      case "env":
        return this.getKeyFromEnv();
    }
  }

  private async storeKey(key: Buffer): Promise<void> {
    switch (this.keyStorage) {
      case "keychain":
        await this.storeKeyInKeychain(key);
        break;
      case "file":
        await this.storeKeyInFile(key);
        break;
      case "env":
        console.log(
          `\nSet this environment variable to use the vault:\n` +
            `  export CLAWPAYER_KEY=${key.toString("hex")}\n` +
            `\nStore it somewhere safe. If you lose it, your vault is gone.\n`
        );
        break;
    }
  }

  private async getKeyFromKeychain(): Promise<Buffer | null> {
    try {
      const keytar = await import("keytar");
      const hex = await keytar.default.getPassword(KEY_SERVICE, KEY_ACCOUNT);
      return hex ? Buffer.from(hex, "hex") : null;
    } catch {
      // Keychain not available, fall back to file
      console.warn(
        "System keychain not available, falling back to file-based key storage."
      );
      this.keyStorage = "file";
      return this.getKeyFromFile();
    }
  }

  private async storeKeyInKeychain(key: Buffer): Promise<void> {
    try {
      const keytar = await import("keytar");
      await keytar.default.setPassword(KEY_SERVICE, KEY_ACCOUNT, key.toString("hex"));
    } catch {
      console.warn(
        "System keychain not available, falling back to file-based key storage."
      );
      this.keyStorage = "file";
      await this.storeKeyInFile(key);
    }
  }

  private async getKeyFromFile(): Promise<Buffer | null> {
    const keyFile = join(CLAWPAYER_DIR, ".key");
    if (!existsSync(keyFile)) return null;
    const hex = await readFile(keyFile, "utf-8");
    return Buffer.from(hex.trim(), "hex");
  }

  private async storeKeyInFile(key: Buffer): Promise<void> {
    const keyFile = join(CLAWPAYER_DIR, ".key");
    await writeFile(keyFile, key.toString("hex"), {
      encoding: "utf-8",
      mode: 0o600,
    });
  }

  private getKeyFromEnv(): Promise<Buffer | null> {
    const hex = process.env.CLAWPAYER_KEY;
    return Promise.resolve(hex ? Buffer.from(hex, "hex") : null);
  }
}
