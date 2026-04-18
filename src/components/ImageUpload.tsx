import { useState, useRef, useCallback } from 'react';
import { Upload, X } from 'lucide-react';

interface Props {
  label: string;
  onUpload: (file: File) => void;
  onClear?: () => void;
  preview?: string | null;
  accept?: string;
}

export default function ImageUpload({ label, onUpload, onClear, preview, accept = 'image/*' }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }, [onUpload]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  }, [onUpload]);

  if (preview) {
    return (
      <div className="relative">
        <p className="text-xs font-medium text-gray-600 mb-1.5">{label}</p>
        <div className="relative rounded-lg overflow-hidden border border-gray-200">
          <img src={preview} alt="Upload preview" className="w-full h-48 object-cover" />
          {onClear && (
            <button
              onClick={onClear}
              className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-medium text-gray-600 mb-1.5">{label}</p>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
          dragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
        }`}
      >
        <Upload className="w-8 h-8 text-gray-400 mb-2" />
        <p className="text-sm text-gray-500">Drop file here or click to browse</p>
        <p className="text-xs text-gray-400 mt-1">PNG, JPG, WebP</p>
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleChange} />
      </div>
    </div>
  );
}
