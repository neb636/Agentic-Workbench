import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type DefaultTheme } from "vitepress";

const REPO = "https://github.com/neb636/Agentic-Workbench";
const root = fileURLToPath(new URL("..", import.meta.url));

/** One slug rule for both the heading anchors and the sidebar links built from them, so they always match. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>|`/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** A page's source with `<!--@include: file-->` lines replaced by the file they name, as VitePress renders it. */
function source(file: string): string {
  return readFileSync(file, "utf8").replace(/^<!--@include:\s*(.+?)(?:\{(\d*),(\d*)\})?\s*-->$/gm,
    (_, included: string, from?: string, to?: string) => {
      const lines = source(resolve(dirname(file), included)).split("\n");
      return lines.slice(from ? Number(from) - 1 : 0, to ? Number(to) : undefined).join("\n");
    });
}

/** The page's `##` headings, read from its source, shown under the page in the sidebar while it is open. */
function sections(link: string): DefaultTheme.SidebarItem[] {
  const file = `${root}${link.replace(/^\//, "").replace(/(^|\/)$/, "$1index")}.md`;
  const text = source(file).replace(/```[\s\S]*?```/g, "");
  return [...text.matchAll(/^## (.+)$/gm)].map(([, text]) => {
    const label = text.replace(/`/g, "").trim();
    return { text: label, link: `${link}#${slugify(text)}` };
  });
}

function page(text: string, link: string): DefaultTheme.SidebarItem {
  const items = sections(link);
  return items.length ? { text, link, items } : { text, link };
}

const sidebar: DefaultTheme.SidebarItem[] = [
  { text: "Introduction", items: [
    page("What is DimSum", "/"),
    page("Installation", "/install"),
    page("Your first session", "/first-session"),
  ] },
  { text: "Using DimSum", items: [
    page("The workbench", "/guide/workbench"),
    page("Agent sessions", "/guide/agent-sessions"),
    page("Personas and instructions", "/guide/personas-instructions"),
    page("Files and the editor", "/guide/files"),
    page("Source control", "/guide/source-control"),
    page("AI usage and resources", "/guide/ai-usage-resources"),
    page("Workspace trust", "/guide/trust"),
  ] },
  { text: "Configure", items: [
    page("Settings", "/configure/settings"),
    page("Configuration files", "/configure/config-files"),
    page("Environment variables", "/configure/environment"),
  ] },
  { text: "Extend", items: [
    page("Extensions", "/extend/"),
    page("Your first extension", "/extend/first-extension"),
    page("SDK guide", "/extend/sdk"),
  ] },
  { text: "Reference", items: [
    page("Keyboard shortcuts", "/reference/keyboard-shortcuts"),
    page("Harnesses", "/reference/harnesses"),
    page("Data and privacy", "/reference/privacy"),
  ] },
];

export default defineConfig({
  title: "DimSum",
  titleTemplate: ":title · DimSum Docs",
  description: "A local workbench that runs coding agents in their own native CLIs.",
  lang: "en-US",
  base: "/Agentic-Workbench/",
  cleanUrls: true,
  lastUpdated: true,
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/Agentic-Workbench/favicon.svg" }]],
  markdown: {
    anchor: { slugify },
    theme: { light: "github-light", dark: "github-dark-dimmed" },
  },
  themeConfig: {
    logo: { src: "/favicon.svg", alt: "" },
    sidebar,
    aside: false,
    outline: false,
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: REPO }],
    editLink: { pattern: `${REPO}/edit/main/site/:path`, text: "Edit this page" },
    docFooter: { prev: "Previous", next: "Next" },
  },
});
