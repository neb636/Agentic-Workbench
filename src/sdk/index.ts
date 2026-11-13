// @dimsum/sdk: the contract between the workbench and everything that extends it, first-party features included.
// This folder holds types and pure builder functions only. It may import `react` types and pure modules from
// `src/shared`, never the renderer or main process, so it can be lifted into its own package unchanged.
export * from "./contributions";
export * from "./events";
export * from "./extension";
export * from "./guards";
export * from "./prompt";
export { SDK_MODULE } from "../shared/app-identity";
