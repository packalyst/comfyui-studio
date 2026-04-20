import { useState } from 'react';
import { Loader2, X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the validated http(s) URL + optional branch. Throws are surfaced as `error`. */
  onSubmit: (url: string, branch: string) => Promise<void>;
  title?: string;
  urlLabel?: string;
  urlPlaceholder?: string;
  showBranch?: boolean;
}

/** Validate a string is an http:// or https:// URL. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Shared "install / fetch from URL" modal used by the Plugins and CivitAI
 * tabs. The parent is responsible for the actual network call; this
 * component only validates the input on the client and renders the
 * error string returned from the server when the call fails.
 */
export default function InstallUrlModal({
  open,
  onClose,
  onSubmit,
  title = 'Install from URL',
  urlLabel = 'Git URL',
  urlPlaceholder = 'https://github.com/owner/repo',
  showBranch = true,
}: Props) {
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError('URL is required');
      return;
    }
    if (!isHttpUrl(trimmed)) {
      setError('Only http:// and https:// URLs are allowed');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(trimmed, branch.trim());
      setUrl('');
      setBranch('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-backdrop animate-in fade-in-0" onClick={busy ? undefined : onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg p-5 animate-in zoom-in-95 fade-in-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="btn-icon" aria-label="Close" disabled={busy}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="field-label mb-1.5 block">{urlLabel}</label>
            <div className="field-wrap">
              <input
                type="url"
                className="field-input"
                placeholder={urlPlaceholder}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </div>
          </div>
          {showBranch && (
            <div>
              <label className="field-label mb-1.5 block">Branch (optional)</label>
              <div className="field-wrap">
                <input
                  type="text"
                  className="field-input"
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
          )}
          {error && (
            <p className="text-xs text-rose-600 rounded-md bg-rose-50 border border-rose-100 px-2 py-1.5">
              {error}
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary" disabled={busy}>
            Cancel
          </button>
          <button onClick={submit} className="btn-primary" disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
