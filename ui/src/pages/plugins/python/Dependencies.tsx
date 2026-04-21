import PluginDepsPanel from '../../../components/plugins/PluginDepsPanel';

/**
 * /plugins/python/dependencies — per-plugin requirements.txt scan +
 * "Fix deps" action, delegating to the existing panel component.
 */
export default function Dependencies() {
  return (
    <div className="space-y-4">
      <PluginDepsPanel />
    </div>
  );
}
