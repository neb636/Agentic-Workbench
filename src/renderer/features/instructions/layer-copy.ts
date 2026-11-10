import type { InstructionLayer } from "../../../shared/instruction-layers";
import type { PromptOptionTag } from "../../core/prompt-menu-registry";
import { GlobeIcon, LockIcon, UsersIcon } from "../../ui/icons";

/** The same names, icons, and explanations everywhere an instruction's layer is shown. */
export const layerCopy: Record<InstructionLayer, { title: (repo: string) => string; hint: string; icon: PromptOptionTag["icon"] }> = {
  global: { title: () => "Everywhere", hint: "Yours, in every repo.", icon: GlobeIcon },
  shared: { title: (repo) => `Shared in ${repo}`, hint: "Checked into the repo. Everyone who works here gets these.", icon: UsersIcon },
  personal: { title: (repo) => `Only me in ${repo}`, hint: "Private to you. Never committed.", icon: LockIcon },
};

