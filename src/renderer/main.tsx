import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerFirstPartyContributions } from "./app/register-first-party";
import { WorkbenchShell } from "./shell/WorkbenchShell";
import "@fontsource/fredoka/400.css";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/shell.css";
import "./theme/composer.css";
import "./theme/image-generator.css";
import "./theme/panels.css";
import "./theme/code.css";

import "./theme/studio.css";

registerFirstPartyContributions();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkbenchShell />
  </StrictMode>,
);
