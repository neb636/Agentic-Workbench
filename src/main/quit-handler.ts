/** Electron's before-quit event is synchronous; keep it alive until cleanup finishes. */
export function createQuitHandler(cleanup: () => Promise<void>, quit: () => void, onError: (error: unknown) => void) {
  let stopping = false;
  let stopped = false;
  return (event: { preventDefault(): void }) => {
    if (stopped) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    void Promise.resolve().then(cleanup).catch(onError).finally(() => {
      stopped = true;
      quit();
    });
  };
}
