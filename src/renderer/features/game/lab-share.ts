import { validateLabShare } from '../../../shared/labs';
import type { Workspace } from '../../../shared/models';
import { services } from '../../core/services';
import { useWorkbenchStore } from '../../state/workbench-store';

/** Attach to the current agent without replacing its draft or sending to the CLI. */
export async function handleLabShare(workspace: Workspace, input: unknown): Promise<void> {
  const share = validateLabShare(input);
  if (share.action === 'copy') {
    await window.workbench.studio.copyText(share.text);
    return;
  }
  const store = useWorkbenchStore.getState();
  const current = store.workspaces.find(item => item.id === workspace.id);
  if (!current) throw new Error('This piece of work is closed.');
  const viewId = current.views.find(view => view.id === current.activeViewId && view.type === 'agent')?.id
    ?? current.views.find(view => view.type === 'agent')?.id
    ?? store.createView(workspace.id, 'agent', 'Lab changes', { autoTitle: false });
  await services.commands.execute('agent.composer.attach', { workspaceId: workspace.id, viewId, label: share.label, content: share.text });
  store.updateViewState(workspace.id, viewId, { composerCollapsed: false });
  store.selectView(workspace.id, viewId);
}
