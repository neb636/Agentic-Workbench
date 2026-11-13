// Keep Electron's real renderer running without raising a window during automated QA.
// QA_VISIBLE=1 restores normal window behavior for interactive inspection.
// The person's own ~/.dimsum is never touched: without an override, `.dimsum` lives in the QA profile folder.
export function qaEnvironment(overrides = {}) {
  const home = overrides.DIMSUM_HOME ?? (overrides.WORKBENCH_USER_DATA_DIR ? `${overrides.WORKBENCH_USER_DATA_DIR}/dimsum-home` : undefined);
  if (!home) throw new Error("QA needs WORKBENCH_USER_DATA_DIR or DIMSUM_HOME so it never writes to ~/.dimsum.");
  return { ...process.env, ...overrides, DIMSUM_HOME: home, WORKBENCH_QA_HIDDEN: process.env.QA_VISIBLE === "1" ? "0" : "1" };
}

export async function assertQaWindowVisibility(app) {
  const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  if (visible !== (process.env.QA_VISIBLE === "1")) throw new Error(`Unexpected QA window visibility: ${visible}`);
}
