import { Download, Send, Columns } from 'lucide-react';
import { api } from '../services/comfyui';

interface Props {
  filename: string;
  subfolder?: string;
  mediaType: string;
  inputPreview?: string | null;
  showCompare: boolean;
  onToggleCompare: () => void;
  seed?: number;
  timeTaken?: number;
}

export default function GenerationOutput({
  filename,
  subfolder,
  mediaType,
  inputPreview,
  showCompare,
  onToggleCompare,
  seed,
  timeTaken,
}: Props) {
  const url = api.getImageUrl(filename, subfolder);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  return (
    <div className="space-y-3">
      <div className={`${showCompare && inputPreview ? 'grid grid-cols-2 gap-2' : ''}`}>
        {showCompare && inputPreview && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Input</p>
            <img src={inputPreview} alt="Input" className="w-full rounded-lg border border-gray-200" />
          </div>
        )}
        <div>
          {showCompare && inputPreview && <p className="text-xs text-gray-500 mb-1">Output</p>}
          {mediaType === 'video' ? (
            <video src={url} controls className="w-full rounded-lg border border-gray-200" />
          ) : mediaType === 'audio' ? (
            <audio src={url} controls className="w-full" />
          ) : (
            <img src={url} alt="Generated" className="w-full rounded-lg border border-gray-200" />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={handleDownload} className="btn-secondary text-sm gap-1.5">
          <Download className="w-4 h-4" />
          Download
        </button>
        {inputPreview && (
          <button onClick={onToggleCompare} className="btn-secondary text-sm gap-1.5">
            <Columns className="w-4 h-4" />
            {showCompare ? 'Hide Compare' : 'Compare'}
          </button>
        )}
      </div>

      {(seed !== undefined || timeTaken !== undefined) && (
        <div className="flex gap-4 text-xs text-gray-500">
          {seed !== undefined && <span>Seed: {seed}</span>}
          {timeTaken !== undefined && <span>Time: {timeTaken.toFixed(1)}s</span>}
        </div>
      )}
    </div>
  );
}
