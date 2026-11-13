import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import * as ReactDomClient from "react-dom/client";
import * as sdk from "@dimsum/sdk";
import type { ExtensionDefinition } from "@dimsum/sdk";

/**
 * What a bundled extension script finds on the window: the modules it imports (shared with the app, so there is one
 * React) and `define`, which its last line calls with its exports.
 */
interface DimsumRuntime {
  modules: Record<string, unknown>;
  define: (token: string, exports: unknown) => void;
}

const waiting = new Map<string, (exports: unknown) => void>();

declare global {
  var __dimsum: DimsumRuntime | undefined;
}

globalThis.__dimsum ??= {
  modules: { react: React, "react/jsx-runtime": ReactJsxRuntime, "react-dom": ReactDom, "react-dom/client": ReactDomClient, [sdk.SDK_MODULE]: sdk },
  define: (token, exports) => waiting.get(token)?.(exports),
};

/** Runs a script the main process built and returns the extension it defines. */
export function loadExtensionScript(url: string): Promise<ExtensionDefinition> {
  const token = /\/([0-9a-f-]{36})\.js$/.exec(url)?.[1];
  if (!token) return Promise.reject(new Error("Not an extension script."));
  return new Promise<ExtensionDefinition>((resolve, reject) => {
    const script = document.createElement("script");
    const done = () => { waiting.delete(token); script.remove(); };
    waiting.set(token, (exports) => {
      done();
      const definition = ((exports as { default?: unknown } | undefined)?.default ?? exports) as ExtensionDefinition | undefined;
      if (typeof definition?.activate !== "function") reject(new Error("The extension's default export has no activate function. Use `export default defineExtension({ ... })`."));
      else resolve(definition);
    });
    // A script that throws while loading never calls define: report it rather than wait forever.
    script.onload = () => { if (waiting.has(token)) { done(); reject(new Error("The extension threw while loading. See the developer console.")); } };
    script.onerror = () => { done(); reject(new Error("The extension's script could not be loaded.")); };
    script.src = url;
    document.head.append(script);
  });
}
