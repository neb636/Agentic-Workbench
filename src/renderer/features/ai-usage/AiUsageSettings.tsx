import { Checkbox } from "react-aria-components";
import { CheckIcon } from "../../ui/icons";
import { useAiUsageSettings, useInstalledAgents } from "./usage-store";

/** Settings ▸ General: whether plan usage is read at all, and for which agents. */
export function AiUsageSettings() {
  const [settings, update] = useAiUsageSettings();
  const agents = useInstalledAgents();
  const setShown = (id: string, shown: boolean) => update({ hiddenProviders: shown ? settings.hiddenProviders.filter((item) => item !== id) : [...settings.hiddenProviders, id] });
  return <div className="ai-usage-settings" role="group" aria-labelledby="ai-usage-settings-label">
    <span id="ai-usage-settings-label" className="ai-usage-settings-label">AI usage</span>
    <Checkbox className="wb-checkbox" isSelected={settings.enabled} onChange={(enabled) => update({ enabled })}>
      <span className="checkbox-box"><CheckIcon size={11} /></span><span>Show plan usage in the status bar</span>
    </Checkbox>
    {settings.enabled && agents.length > 0 && <div className="ai-usage-settings-agents">
      {agents.map((agent) => <Checkbox key={agent.id} className="wb-checkbox" isSelected={!settings.hiddenProviders.includes(agent.id)} onChange={(shown) => setShown(agent.id, shown)}>
        <span className="checkbox-box"><CheckIcon size={11} /></span><span>{agent.label}</span>
      </Checkbox>)}
    </div>}
    <p className="settings-help">
      Reads the sign-in each CLI already saved on this computer and asks its provider how much of your plan is used. It never changes your logins. Off, nothing is read.
    </p>
  </div>;
}
