import { useEffect, useState } from "react";
import type { BaseBranches } from "../../../shared/models";
import { errorMessage } from "../../core/errors";

/** The workspace's branches right away; `refresh` updates them from the remote once, when the picker first opens. */
export function useBaseBranches(root: string, enabled: boolean) {
  const [loaded, setLoaded] = useState<{ root: string; data: BaseBranches }>();
  const [failure, setFailure] = useState<{ root: string; message: string }>();
  const [refresh, setRefresh] = useState<{ root: string; done: boolean }>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    window.workbench.sourceControl.baseBranches(root)
      .then((data) => { if (active) setLoaded({ root, data }); })
      .catch((error: unknown) => { if (active) setFailure({ root, message: errorMessage(error) }); });
    return () => { active = false; };
  }, [root, enabled]);
  return {
    data: loaded?.root === root ? loaded.data : undefined,
    error: failure?.root === root ? failure.message : "",
    refreshing: refresh?.root === root && !refresh.done,
    refresh: () => {
      if (refresh?.root === root) return;
      setRefresh({ root, done: false });
      void window.workbench.sourceControl.baseBranches(root, true)
        .then((data) => setLoaded({ root, data }))
        .catch(() => undefined) // The list already showing stays usable.
        .finally(() => setRefresh({ root, done: true }));
    },
  };
}
