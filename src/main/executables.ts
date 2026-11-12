import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { homedir } from "node:os";

/** GUI apps on macOS start with a minimal PATH, so common install locations are searched too. */
export function executablePath(command: string): string | undefined {
  const dirs = [...(process.env.PATH ?? "").split(delimiter), join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  const candidates = isAbsolute(command) ? [command] : dirs.filter(isAbsolute).map((dir) => join(dir, command));
  return candidates.find((candidate) => { try { accessSync(candidate, constants.X_OK); return statSync(candidate).isFile(); } catch { return false; } });
}
