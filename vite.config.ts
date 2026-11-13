import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), { name: "production-security-policy", apply: "build", transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: "default-src 'self'; script-src 'self' workbench://ext; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" }, injectTo: "head" }] }],
  base: "./",
  resolve: { alias: { "@dimsum/sdk": fileURLToPath(new URL("./src/sdk/index.ts", import.meta.url)) } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
