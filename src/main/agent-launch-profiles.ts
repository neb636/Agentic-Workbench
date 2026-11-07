import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Permissions a feature may grant the agent it launches. Profiles are defined in the main
 * process; the renderer can only name one, never supply its own rules.
 */
export interface AgentLaunchProfile {
  id: string;
  /** Sessions using the profile must run in this folder or below it. */
  root: string;
  /** Command prefixes the agent may run without asking. */
  allowCommands: string[];
  /** File writes inside the session's working folder need no approval. */
  allowWritesInCwd: boolean;
}

function isWithin(target: string, base: string): boolean {
  const relative = path.relative(base, target);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function resolveLaunchProfile(profiles: AgentLaunchProfile[], id: string, cwd: string): AgentLaunchProfile {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error("Unknown launch profile.");
  let real: string;
  try { real = realpathSync(cwd); } catch { throw new Error("The session folder does not exist."); }
  if (!isWithin(real, realpathSync(profile.root))) throw new Error("This launch profile only applies inside its own folder.");
  return profile;
}
