import { killBackgroundProcess } from "./processes";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { AgentModelChoice } from "../shared/models";
import type { AgentModelListing, AgentProviderAdapter } from "./agent-provider";
import { executablePath } from "./executables";

const REFRESH_EVERY_MS = 30 * 60_000;
const READ_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 8 * 1024 * 1024;
// What a CLI lists becomes its launch arguments, so nothing that could read as a flag or break out of a quoted value.
const MODEL_ID = /^[A-Za-z0-9][\w.:[\]-]{0,99}$/;
const EFFORT = /^[a-z]{1,20}$/;

/** Runs the listing in a neutral folder, so no project's configuration is involved. Output is kept until the CLI has answered. */
function readListing(executable: string, listing: AgentModelListing): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, listing.args, { cwd: tmpdir(), detached: true, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    const finish = (failure?: Error) => {
      clearTimeout(timer);
      killBackgroundProcess(child);
      if (failure) reject(failure); else resolve(stdout);
    };
    const timer = setTimeout(() => finish(new Error("Timed out.")), READ_TIMEOUT_MS);
    child.on("error", finish);
    child.on("close", (code) => finish(code === 0 ? undefined : new Error(`Exited with code ${code}.`)));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_CHARS) finish(new Error("Too much output."));
      else if (listing.ready?.(stdout)) finish();
    });
    // A CLI that exits before reading its input is reported through "close".
    child.stdin.on("error", () => undefined);
    if (listing.input) child.stdin.write(listing.input); else child.stdin.end();
  });
}

/** The models each CLI currently offers, read at startup and every 30 minutes. Kept in memory; until a read succeeds, the adapter's own list. */
export class AgentModelCatalogue {
  private readonly fetched = new Map<string, AgentModelChoice[]>();
  private timer?: ReturnType<typeof setInterval>;
  private refreshing?: Promise<boolean>;

  constructor(private readonly providers: AgentProviderAdapter[]) {}

  modelsFor(provider: AgentProviderAdapter): AgentModelChoice[] | undefined {
    return this.fetched.get(provider.id) ?? provider.models;
  }

  /** `onChange` runs after a refresh that changed some provider's list. */
  start(onChange: () => void): void {
    const refresh = () => void this.refresh().then((changed) => { if (changed) onChange(); });
    refresh();
    this.timer = setInterval(refresh, REFRESH_EVERY_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Resolves true when a list changed. A read still running is joined rather than started again. */
  refresh(): Promise<boolean> {
    this.refreshing ??= Promise.all(this.providers.map((provider) => this.read(provider)))
      .then((changes) => changes.some(Boolean))
      .finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async read(provider: AgentProviderAdapter): Promise<boolean> {
    const executable = executablePath(provider.executable);
    if (!provider.listModels || !executable) return false;
    try {
      const models = provider.listModels.parse(await readListing(executable, provider.listModels))
        .filter((model) => MODEL_ID.test(model.id))
        .map((model) => ({ ...model, efforts: model.efforts.filter((effort) => EFFORT.test(effort)) }));
      if (!models.length) return false;
      const changed = JSON.stringify(models) !== JSON.stringify(this.modelsFor(provider));
      this.fetched.set(provider.id, models);
      return changed;
    } catch {
      // Whatever it printed may include account details, so only the fact is logged.
      console.warn(`Could not read ${provider.label}'s model list; keeping the last one.`);
      return false;
    }
  }
}
