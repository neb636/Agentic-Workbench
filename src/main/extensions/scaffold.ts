import { promises as fs } from "node:fs";
import path from "node:path";
import { AGENT_GUIDE_FILE, APP_DIR, EXTENSIONS_DIR, SDK_MODULE } from "../../shared/app-identity";
import { sdkFolder } from "../dimsum-home";
import { assertInsideRoot, ignoreLocalFiles } from "../config-layers";

const starter = (name: string) => `import { useState } from "react";
import { defineExtension, type ViewComponentProps } from "${SDK_MODULE}";

// A workspace extension. Read ../../${AGENT_GUIDE_FILE} for everything an extension can contribute.
// Saving this file reloads it in the app.

function ${pascal(name)}View({ workspace }: ViewComponentProps) {
  const [count, setCount] = useState(0);
  return (
    <div style={{ padding: 24, display: "grid", gap: 12, color: "var(--wb-text-primary)" }}>
      <h2 style={{ margin: 0 }}>${title(name)}</h2>
      <p style={{ margin: 0, color: "var(--wb-text-secondary)" }}>A custom view for {workspace.name}.</p>
      <button type="button" onClick={() => setCount(count + 1)}>Clicked {count} times</button>
    </div>
  );
}

const Icon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
  </svg>
);

export default defineExtension({
  name: "${title(name)}",
  description: "A starter workspace extension.",
  activate(ctx) {
    ctx.views.register({
      id: "${name}.view",
      label: "${title(name)}",
      description: "A custom view from this workspace's ${APP_DIR}/${EXTENSIONS_DIR}.",
      icon: Icon,
      component: ${pascal(name)}View,
    });
  },
});
`;

function title(name: string): string {
  return name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function pascal(name: string): string {
  return title(name).replaceAll(" ", "");
}

async function writeIfMissing(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(file, text, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

/**
 * Creates `<workspace>/.dimsum/extensions/<name>/index.tsx`, plus what lets an editor and an agent work on it: the
 * guide (`.dimsum/AGENTS.md`), the SDK's types (`.dimsum/.sdk/`, refreshed every time) and a tsconfig that maps
 * `@dimsum/sdk` to them. Existing files other than the types are left as they are.
 */
export async function scaffoldExtension(root: string, name: string): Promise<{ entry: string }> {
  const base = path.join(root, APP_DIR);
  const folder = path.join(base, EXTENSIONS_DIR, name);
  // Everything below is written into the workspace's own .dimsum, never through a link to somewhere else.
  await assertInsideRoot(root, path.join(folder, "index.tsx"));
  if (await fs.stat(folder).then(() => true, () => false)) throw new Error(`${APP_DIR}/${EXTENSIONS_DIR}/${name} already exists.`);
  const sdk = sdkFolder();
  const guide = await fs.readFile(path.join(sdk, "GUIDE.md"), "utf8").catch(() => undefined);
  if (guide) await fs.writeFile(path.join(await ensure(base), AGENT_GUIDE_FILE), guide);
  const types = path.join(sdk, "types");
  if (await fs.stat(types).then(() => true, () => false)) {
    await fs.rm(path.join(base, ".sdk"), { recursive: true, force: true });
    await copyTree(types, path.join(base, ".sdk"));
  }
  await writeIfMissing(path.join(base, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", strict: true, noEmit: true, skipLibCheck: true,
      paths: { [SDK_MODULE]: ["./.sdk/sdk/index.d.ts"] },
    },
    include: [`${EXTENSIONS_DIR}/**/*`],
  }, null, 2)}\n`);
  await writeIfMissing(path.join(base, "package.json"), `${JSON.stringify({
    private: true,
    description: `Type checking for this workspace's ${APP_DIR} extensions. The app bundles them itself; installing is optional.`,
    scripts: { typecheck: "tsc -p ." },
    devDependencies: { typescript: "^5.9.2", "@types/react": "^19.1.12" },
  }, null, 2)}\n`);
  await ignoreLocalFiles(base, root);
  const entry = path.join(folder, "index.tsx");
  await writeIfMissing(entry, starter(name));
  return { entry: path.relative(root, entry).split(path.sep).join("/") };
}

/** Copies with plain reads and writes, which also work from inside the packaged app's archive. */
async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyTree(path.join(from, entry.name), path.join(to, entry.name));
    else if (entry.isFile()) await fs.writeFile(path.join(to, entry.name), await fs.readFile(path.join(from, entry.name)));
  }
}

async function ensure(folder: string): Promise<string> {
  await fs.mkdir(folder, { recursive: true });
  return folder;
}
