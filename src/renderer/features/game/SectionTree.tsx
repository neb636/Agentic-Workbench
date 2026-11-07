import { useEffect, useMemo, useState } from "react";
import type { Workspace } from "../../../shared/models";
import { IconButton } from "../../ui/controls";
import { CloseIcon, RefreshIcon } from "../../ui/icons";
import { crumbFor, hashOf, labOf, loadSections, openInGame, useGameLive, withLab } from "./game-store";

/**
 * Every country ▸ activity ▸ section of the selected piece of work (from its own sections.ts files), so a click opens
 * that moment in the game. The section on screen is highlighted; a lab that is on stays on.
 */
export function SectionTree({ workspace, onClose }: { workspace?: Workspace; onClose?: () => void }) {
  const root = workspace?.path;
  const sections = useGameLive((state) => (root ? state.sections[root] : undefined));
  const href = useGameLive((state) => (workspace ? state.href[workspace.id] : undefined));
  const [filter, setFilter] = useState("");
  useEffect(() => { if (root) void loadSections(root); }, [root]);
  const current = hashOf(href || workspace?.game?.link || "#/world");
  const crumb = crumbFor(current, sections?.index);
  const query = filter.trim().toLowerCase();

  const places = useMemo(() => (sections?.index?.places ?? []).map((place) => ({
    ...place,
    activities: place.activities.map((activity) => ({
      ...activity,
      sections: activity.sections.filter((section) => !query || `${place.name} ${activity.name} ${section.name} ${section.id}`.toLowerCase().includes(query)),
    })).filter((activity) => activity.sections.length),
  })).filter((place) => place.activities.length), [sections?.index, query]);

  if (!workspace) return null;
  const open = (link: string) => {
    const lab = labOf(current);
    openInGame(workspace.id, lab === "camera" || lab === "feel" ? withLab(link, lab) : link);
    onClose?.();
  };

  return <div className="section-tree" aria-label="Sections">
    <div className="sidebar-section-header">
      <span>Sections</span>
      <span className="header-actions">
        <IconButton label="Read the sections again" isDisabled={sections?.loading} onPress={() => void loadSections(workspace.path, true)}><RefreshIcon size={14} /></IconButton>
        {onClose && <IconButton label="Close sections" onPress={onClose}><CloseIcon size={13} /></IconButton>}
      </span>
    </div>
    <input className="section-filter" autoFocus={Boolean(onClose)} aria-label="Find a section" placeholder="Find a section…" value={filter} onChange={(event) => setFilter(event.target.value)} />
    <div className="section-scroll">
      {sections?.loading && !sections.index && <p className="sidebar-empty">Reading sections…</p>}
      {sections?.error && <p className="sidebar-empty work-bad" role="alert">{sections.error}</p>}
      {sections?.index?.missing && <p className="sidebar-empty">{sections.index.missing}</p>}
      {places.map((place) => <details key={place.id} open={Boolean(query) || crumb.placeId === place.id}>
        <summary className="section-place">{place.emoji} {place.name}</summary>
        {place.activities.map((activity) => <details key={activity.id} className="section-activity" open={Boolean(query) || (crumb.placeId === place.id && crumb.activityId === activity.id)}>
          <summary>{activity.icon} {activity.name}{activity.kind === "works" && <small> · in the works</small>}</summary>
          <ul>
            {activity.sections.map((section) => {
              const here = crumb.placeId === place.id && crumb.activityId === activity.id && crumb.entry?.id === section.id;
              return <li key={section.id}>
                <button className={`section-link ${here ? "is-current" : ""}`} aria-current={here ? "location" : undefined} title={section.link} onClick={() => open(section.link)}>
                  {section.group && <small>{section.group} · </small>}{section.name}
                </button>
                {section.links.length > 0 && <span className="section-variants">
                  {section.links.map((variant) => <button key={variant.link} className="section-variant" title={variant.link} onClick={() => open(variant.link)}>{variant.label}</button>)}
                </span>}
              </li>;
            })}
          </ul>
        </details>)}
      </details>)}
    </div>
  </div>;
}
