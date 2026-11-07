import { useEffect } from "react";
import type { Workspace } from "../../shared/models";
import { services } from "../core/services";
import { Button } from "../ui/controls";
import { AgentIcon, GameIcon, TerminalIcon } from "../ui/icons";
import { GamePane } from "../features/game/GamePane";
import { openGameTab, setLiveView, useGameLive } from "../features/game/game-store";
import { ViewTabs } from "./ViewTabs";

/**
 * The middle: one tab strip for the selected piece of work (agents, terminals, the game and its labs, files) and the
 * tab on screen. Terminals and the game stay mounted behind other tabs; the `agent.column.footer` slot sits under it.
 */
export function CenterArea({ workspace, onShowLeft, trailing }: {
  workspace: Workspace;
  onShowLeft?: () => void;
  trailing?: React.ReactNode;
}) {
  const active = workspace.views.find((view) => view.id === workspace.activeViewId) ?? workspace.views[0];
  const definition = active ? services.views.get(active.type) : undefined;
  // One running game per piece of work: the game tab on screen owns it; the last one shown keeps it loaded, hidden.
  const live = useGameLive((state) => state.liveView[workspace.id]);
  useEffect(() => { if (active?.type === "game") setLiveView(workspace.id, active.id); }, [workspace.id, active?.id, active?.type]);
  const liveId = active?.type === "game" ? active.id : live;
  const liveView = workspace.views.find((view) => view.id === liveId && view.type === "game");
  useEffect(() => { if (live && !workspace.views.some((view) => view.id === live)) setLiveView(workspace.id, undefined); }, [live, workspace.id, workspace.views]);

  return <main className="center-column agent-column" aria-label="Work area">
    <ViewTabs workspace={workspace} showLeftToggle={Boolean(onShowLeft)} onShowLeft={onShowLeft ?? (() => {})} trailing={trailing} />
    <div className="active-view-region">
      {active && definition ? <>
          {/* Terminals stay mounted (in one stable list) behind other tabs, so a Ship command keeps running while Dad
              looks at the agent; their PTY lives as long as the component. */}
          {workspace.views.filter((view) => view.type === "terminal").map((view) => {
            const Terminal = services.views.get("terminal")?.component;
            return Terminal ? <div key={view.id} className="kept-view" hidden={view.id !== active.id}><Terminal view={view} workspace={workspace} /></div> : null;
          })}
          {liveView && <div className="kept-view" hidden={active.id !== liveView.id}>
            <GamePane key={workspace.id} workspace={workspace} view={liveView} visible={active.id === liveView.id} />
          </div>}
          {active.type !== "terminal" && active.type !== "game" && <definition.component key={active.id} view={active} workspace={workspace} />}
        </>
        : active ? <div className="missing-view"><h2>View unavailable</h2><p>No view is registered for <code>{active.type}</code>.</p></div>
        : <div className="empty-workspace">
          <h2>Nothing open</h2><p>Start an agent for {workspace.name}, or open its game.</p>
          <div className="empty-actions">
            <Button onPress={() => void services.commands.execute("view.create", { workspaceId: workspace.id, viewType: "agent" })}><AgentIcon size={16} />Agent session</Button>
            <Button onPress={() => void services.commands.execute("view.create", { workspaceId: workspace.id, viewType: "terminal" })}><TerminalIcon size={16} />Terminal</Button>
            <Button onPress={() => openGameTab(workspace.id)}><GameIcon size={16} />Game</Button>
          </div>
        </div>}
    </div>
    {services.widgets.forSlot("agent.column.footer").map((widget) => {
      const Widget = widget.component;
      return <Widget key={widget.id} workspaceId={workspace.id} />;
    })}
  </main>;
}
