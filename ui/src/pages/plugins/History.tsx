import PluginHistoryPanel from '../../components/plugins/PluginHistoryPanel';

/**
 * /plugins/history — full-width view of the plugin operations history log.
 * Renders the existing `PluginHistoryPanel` component unchanged.
 */
export default function History() {
  return (
    <div className="space-y-4">
      <PluginHistoryPanel />
    </div>
  );
}
