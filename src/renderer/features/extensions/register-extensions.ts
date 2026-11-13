import { defineExtension } from "@dimsum/sdk";
import { startWorkspaceExtensions } from "../../extensions/workspace-extensions";
import { PuzzleIcon } from "../../ui/icons";
import { ExtensionsPanel } from "./ExtensionsPanel";
import "./extensions.css";

/** Loads the person's and each workspace's extensions, and lists them in a side panel. */
export const extensions = defineExtension({
  name: "Extensions",
  description: "Loads extensions from ~/.dimsum and each workspace's .dimsum folder.",
  activate(ctx) {
    ctx.panels.register({ id: "extensions", label: "Extensions", icon: PuzzleIcon, order: 40, component: ExtensionsPanel });
    return { dispose: startWorkspaceExtensions() };
  },
});
