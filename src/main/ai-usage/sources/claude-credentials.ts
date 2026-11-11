import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

/** Claude Code's configuration folder: CLAUDE_CONFIG_DIR, else ~/.claude. */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/** Claude Code names its Keychain item after the config folder when one is chosen. */
function keychainService(): string {
  const custom = process.env.CLAUDE_CONFIG_DIR;
  if (!custom) return "Claude Code-credentials";
  return `Claude Code-credentials-${createHash("sha256").update(custom.normalize("NFC")).digest("hex").slice(0, 8)}`;
}

function keychainAccount(): string {
  const name = (() => { try { return userInfo().username; } catch { return process.env.USER ?? ""; } })();
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : "claude-code-user";
}

function securityPassword(args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("/usr/bin/security", ["find-generic-password", ...args, "-w"], { timeout: 5000 }, (error, stdout) => resolve(error ? undefined : stdout.trim()));
  });
}

interface StoredLogin { accessToken?: string; refreshToken?: string }

function parseLogin(text: string | undefined): StoredLogin | undefined {
  if (!text) return undefined;
  try {
    const login = (JSON.parse(text) as { claudeAiOauth?: StoredLogin }).claudeAiOauth;
    return typeof login?.accessToken === "string" ? login : undefined;
  } catch { return undefined; }
}

/**
 * The OAuth login Claude Code saved for itself: the macOS Keychain, else `<config>/.credentials.json`. Only read, never
 * renewed or written: renewing belongs to the CLI. The token stays in the main process and is never logged.
 */
export async function readClaudeLogin(): Promise<StoredLogin | undefined> {
  if (process.platform === "darwin") {
    const service = keychainService();
    const login = parseLogin(await securityPassword(["-s", service, "-a", keychainAccount()])) ?? parseLogin(await securityPassword(["-s", service]));
    if (login) return login;
  }
  return parseLogin(await readFile(join(claudeConfigDir(), ".credentials.json"), "utf8").catch(() => undefined));
}
