// Keep Electron's real renderer running without raising a window during automated QA.
// QA_VISIBLE=1 restores normal window behavior for interactive inspection.
export function qaEnvironment(overrides = {}) {
  return { ...process.env, ...overrides, WORKBENCH_QA_HIDDEN: process.env.QA_VISIBLE === "1" ? "0" : "1" };
}

export async function assertQaWindowVisibility(app) {
  const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  if (visible !== (process.env.QA_VISIBLE === "1")) throw new Error(`Unexpected QA window visibility: ${visible}`);
}
