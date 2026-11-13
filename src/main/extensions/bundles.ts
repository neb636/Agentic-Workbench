import { randomUUID } from "node:crypto";

/** Built extension scripts, served from memory at `workbench://ext/<token>.js`. Nothing on disk is ever served. */
const bundles = new Map<string, string>();
/** The token each extension was last served under, so a reload frees the old script. */
const latest = new Map<string, string>();

export function newBundleToken(): string {
  return randomUUID();
}

export function storeBundle(key: string, token: string, code: string): string {
  const previous = latest.get(key);
  if (previous) bundles.delete(previous);
  latest.set(key, token);
  bundles.set(token, code);
  return `workbench://ext/${token}.js`;
}

/** The script for a `workbench://ext/...` request, or undefined for anything the host did not build. */
export function bundleFor(url: URL): string | undefined {
  const match = /^\/([0-9a-f-]{36})\.js$/.exec(url.pathname);
  return match ? bundles.get(match[1]) : undefined;
}
