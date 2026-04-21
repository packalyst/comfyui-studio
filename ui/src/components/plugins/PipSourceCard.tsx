import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Terminal, ExternalLink } from 'lucide-react';
import { api } from '../../services/comfyui';

/**
 * Small panel showing the currently configured pip index-url with a
 * shortcut to Settings for editing it.
 */
export default function PipSourceCard() {
  const navigate = useNavigate();
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getPipSource()
      .then((s) => {
        if (!cancelled) setSource(s.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setSource(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="panel">
      <div className="panel-header flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 text-slate-400" />
        <div>
          <h2 className="panel-header-title leading-tight">pip source</h2>
          <p className="panel-header-desc">The index-url used by pip install.</p>
        </div>
      </div>
      <div className="panel-body flex flex-col md:flex-row md:items-center gap-3">
        <code className="flex-1 text-xs font-mono text-slate-700 bg-slate-50 ring-1 ring-inset ring-slate-200 rounded-md px-2.5 py-1.5 truncate">
          {loading ? 'Loading…' : source || 'https://pypi.org/simple'}
        </code>
        <button
          onClick={() => navigate('/settings')}
          className="btn-secondary shrink-0"
          title="Change the pip index-url in Settings"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Edit in Settings
        </button>
      </div>
    </section>
  );
}
