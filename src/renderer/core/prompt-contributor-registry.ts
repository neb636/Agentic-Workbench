import type { PromptContribution } from "../../shared/models";
import type { PromptContributor } from "@dimsum/sdk";
import { Registry } from "./registry";

export type { PromptContributor } from "@dimsum/sdk";

export class PromptContributorRegistry extends Registry<PromptContributor> {
  collect(context: { workspaceId: string; viewId: string }): PromptContribution[] {
    return this.list(context.workspaceId).flatMap((contributor) => contributor.contributions(context));
  }
}
