import { promises as fs } from "node:fs";
import path from "node:path";
import type { Plugin } from "esbuild";
import { SDK_MODULE } from "../../shared/app-identity";
import { isInside } from "../workspace-files";

/** Modules the app provides to every extension, so they share its React and its SDK. */
const HOST_MODULES = new Set(["react", "react/jsx-runtime", "react-dom", "react-dom/client", SDK_MODULE]);
const HOST_PREFIX = /^(react|react-dom|@dimsum\/sdk)(\/.*)?$/;

function hostModules(): Plugin {
  return {
    name: "dimsum-host-modules",
    setup(build) {
      build.onResolve({ filter: HOST_PREFIX }, (args) => HOST_MODULES.has(args.path)
        ? { path: args.path, namespace: "dimsum-host" }
        : { errors: [{ text: `"${args.path}" is not provided by the app. Import from ${[...HOST_MODULES].join(", ")}.` }] });
      build.onLoad({ filter: /.*/, namespace: "dimsum-host" }, (args) => ({
        contents: `module.exports = globalThis.__dimsum.modules[${JSON.stringify(args.path)}];`, loader: "js",
      }));
    },
  };
}

/** Every file an extension pulls in must come from its own workspace (or `~/.dimsum` for a user extension), never elsewhere on disk. */
function confined(base: string): Plugin {
  return {
    name: "dimsum-confined",
    setup(build) {
      build.onLoad({ filter: /.*/ }, (args) => (args.namespace === "file" && args.path !== base && !isInside(args.path, base))
        ? { errors: [{ text: `${args.path} is outside ${base}. Extensions may only import files inside it.` }] }
        : undefined);
    },
  };
}

/**
 * In the packaged app esbuild's files are unpacked beside the archive (`asarUnpack`), but resolving its binary still
 * yields the path inside `app.asar`, which can't be run. esbuild reads `ESBUILD_BINARY_PATH` once, when it loads, so
 * the unpacked path is set only for that moment: terminals started later must not inherit it.
 */
let loading: Promise<typeof import("esbuild")> | undefined;
function loadEsbuild(): Promise<typeof import("esbuild")> {
  loading ??= (async () => {
    let unpacked: string | undefined;
    try {
      const binary = require.resolve(`@esbuild/${process.platform}-${process.arch}/${process.platform === "win32" ? "esbuild.exe" : "bin/esbuild"}`);
      unpacked = binary.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
      if (unpacked === binary || process.env.ESBUILD_BINARY_PATH) unpacked = undefined;
    } catch { /* esbuild finds its own binary, or reports why it can't. */ }
    if (unpacked) process.env.ESBUILD_BINARY_PATH = unpacked;
    try { return await import("esbuild"); }
    finally { if (unpacked) delete process.env.ESBUILD_BINARY_PATH; }
  })();
  return loading;
}

/**
 * Bundles one extension into a script that hands its default export to the window (`__dimsum.define`). esbuild is
 * loaded on first use, so starting the app costs nothing when no extension is installed.
 */
export async function bundleExtension(entry: string, allowedFolder: string, token: string): Promise<{ ok: true; code: string; inputs: string[] } | { ok: false; error: string }> {
  const { build } = await loadEsbuild();
  const base = await fs.realpath(allowedFolder);
  try {
    const result = await build({
      entryPoints: [entry], absWorkingDir: base, bundle: true, write: false, format: "iife", globalName: "__dimsumExtension",
      platform: "browser", target: "es2022", jsx: "automatic", sourcemap: "inline", logLevel: "silent",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      footer: { js: `globalThis.__dimsum.define(${JSON.stringify(token)}, __dimsumExtension);` },
      plugins: [hostModules(), confined(base)], metafile: true,
    });
    // Every file it was built from, relative to the allowed folder, so saving any of them rebuilds it. esbuild names
    // files from other namespaces (the app's own modules) with a `namespace:` prefix; those never change on disk.
    const inputs = Object.keys(result.metafile.inputs).filter((input) => !/^[a-z-]+:/.test(input));
    return { ok: true, code: result.outputFiles[0].text, inputs };
  } catch (error) {
    const failures = (error as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors;
    if (!failures?.length) return { ok: false, error: (error as Error).message };
    return { ok: false, error: failures.slice(0, 5).map((item) => item.location
      ? `${path.relative(base, path.resolve(base, item.location.file))}:${item.location.line}:${item.location.column}: ${item.text}`
      : item.text).join("\n") };
  }
}
