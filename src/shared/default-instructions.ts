import { choice, isChoice, select, textInput, toggle, type PromptOptionDefinition } from "./prompt-options";

/**
 * Instructions every new install starts with. They are seeded once into the person's global instructions,
 * where they can be edited or deleted like any other; "Restore default instructions" brings back deleted ones.
 */
export const defaultInstructions: PromptOptionDefinition[] = [
  toggle("create-issue", { label: "Create issue", category: "Project management",
    text: "When the work is done, draft an issue that describes the change, why it was needed, and any follow-up work." }),
  toggle("open-pr", { label: "Open PR", category: "Delivery",
    text: "When the change is ready, open a draft pull request that summarizes the change and how it was verified." }),
  toggle("write-report", { label: "Write report", category: "Delivery",
    text: "Finish with a short report: what changed, why, how it was verified, and any risks or follow-ups." }),
  select("unit-tests", { label: "Unit tests", category: "Verification", display: "segmented", default: "repo-defaults", choices: [
    choice("repo-defaults", "Repo defaults"),
    choice("write-new", "Write new", "Add or update unit tests that cover this change, and run them before finishing."),
    choice("skip", "Skip", "Do not add or run unit tests for this change."),
  ] }),
  toggle("app-extension-guide", { label: "Extension guide", category: "Workbench",
    text: "This app can be extended from this workspace. Before adding or changing the app's own views, panels, menus or send checks, read .dimsum/AGENTS.md (or the file named in $DIMSUM_GUIDE) and build the change as an extension in .dimsum/extensions/." }),
  textInput("test-focus", { label: "Test focus", category: "Verification", when: isChoice("unit-tests", "write-new"),
    placeholder: "e.g. error handling", template: "Focus the new tests on {{value}}." }),
];
