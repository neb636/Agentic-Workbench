import type { CommandHandler } from "@dimsum/sdk";
import { Registry } from "./registry";

export type { CommandHandler } from "@dimsum/sdk";

/**
 * Commands by id. A workspace extension's commands belong to its workspace: `execute` finds them when its arguments
 * name that workspace (`{ workspaceId }`), which every workbench command does.
 */
export class CommandRegistry {
  private readonly handlers = new Registry<{ id: string; handler: CommandHandler }>();

  register<TArgs = unknown, TResult = unknown>(id: string, handler: CommandHandler<TArgs, TResult>, scope?: string): () => void {
    try { return this.handlers.register({ id, handler: handler as CommandHandler }, scope); }
    catch { throw new Error(`Command already exists: ${id}`); }
  }

  async execute<TResult = unknown>(id: string, args?: unknown): Promise<TResult> {
    const handler = this.handlers.get(id, scopeOf(args))?.handler;
    if (!handler) throw new Error(`Unknown command: ${id}`);
    return handler(args) as TResult;
  }

  has(id: string, scope?: string): boolean {
    return Boolean(this.handlers.get(id, scope));
  }
}

function scopeOf(args: unknown): string | undefined {
  const workspaceId = (args as { workspaceId?: unknown } | null | undefined)?.workspaceId;
  return typeof workspaceId === "string" ? workspaceId : undefined;
}
