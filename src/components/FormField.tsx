import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { Info, Upload, X, Minus, Plus } from 'lucide-react';
import type { FormInput } from '../types';
import Tooltip from './Tooltip';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface Props {
  input: FormInput;
  value: unknown;
  onChange: (value: unknown) => void;
}

export default function FormField({ input, value, onChange }: Props) {
  // Toggle fields render inline: label on the left, switch on the right, no body control below.
  if (input.type === 'toggle') {
    return (
      <FieldLabel
        input={input}
        inline
        right={<Switch size="sm" checked={!!value} onCheckedChange={onChange} />}
      />
    );
  }

  const labelRight = input.type === 'slider' ? (
    <span className="text-xs font-medium tabular-nums text-slate-700">{formatSliderValue(input, value)}</span>
  ) : undefined;
  return (
    <div>
      <FieldLabel input={input} right={labelRight} />
      <FieldControl input={input} value={value} onChange={onChange} />
    </div>
  );
}

function formatSliderValue(input: FormInput, value: unknown): string {
  const step = input.step ?? 1;
  const num = (value as number) ?? (input.default as number) ?? input.min ?? 0;
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  return num.toFixed(precision);
}

function FieldLabel({ input, right, inline }: { input: FormInput; right?: React.ReactNode; inline?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${inline ? '' : 'mb-1.5'}`}>
      <label className="text-sm font-medium text-gray-700">{input.label}</label>
      {input.description && (
        <Tooltip content={input.description}>
          <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
        </Tooltip>
      )}
      {input.required && (
        <span className="text-[10px] font-medium text-red-500">* required</span>
      )}
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

function FieldControl({ input, value, onChange }: Props) {
  switch (input.type) {
    case 'textarea':
      return <TextareaField input={input} value={value} onChange={onChange} />;

    case 'text':
      return (
        <div className="field-wrap">
          <input
            type="text"
            value={(value as string) || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={input.placeholder}
            className="field-input"
          />
        </div>
      );

    case 'number':
      return <NumberField input={input} value={value} onChange={onChange} />;

    case 'slider':
      return <SliderField input={input} value={value} onChange={onChange} />;

    case 'select':
      return (
        <Select
          value={(value as string) ?? (input.default as string) ?? ''}
          onValueChange={onChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {input.options?.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'image':
      return <ImageField input={input} value={value} onChange={onChange} />;

    case 'audio':
      return <FileUploadField input={input} value={value} onChange={onChange} accept="audio/*" label="MP3, WAV, FLAC" />;

    case 'video':
      return <FileUploadField input={input} value={value} onChange={onChange} accept="video/*" label="MP4, WebM, MOV" />;

    default:
      return (
        <div className="field-wrap">
          <input
            type="text"
            value={(value as string) || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={input.placeholder}
            className="field-input"
          />
        </div>
      );
  }
}

function TextareaField({ input, value, onChange }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = (value as string) || '';

  // Auto-grow: measure scrollHeight after each content change, cap at ~12 lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [text]);

  return (
    <textarea
      ref={ref}
      value={text}
      onChange={e => onChange(e.target.value)}
      placeholder={input.placeholder}
      rows={3}
      className="field-textarea"
    />
  );
}

function NumberField({ input, value, onChange }: Props) {
  const step = input.step ?? 1;
  const raw = (value as number | undefined) ?? (input.default as number | undefined) ?? input.min ?? 0;
  const num = typeof raw === 'number' ? raw : Number(raw) || 0;

  const clamp = (n: number) => {
    if (input.min !== undefined) n = Math.max(input.min, n);
    if (input.max !== undefined) n = Math.min(input.max, n);
    // Round to step grid for float safety (e.g. 0.1 increments)
    const precision = Math.max(0, -Math.floor(Math.log10(step)));
    return parseFloat(n.toFixed(precision));
  };

  const adjust = (delta: number) => onChange(clamp(num + delta));

  const atMin = input.min !== undefined && num <= input.min;
  const atMax = input.max !== undefined && num >= input.max;

  return (
    <div className="field-wrap">
      <button type="button" onClick={() => adjust(-step)} disabled={atMin} className="field-stepper" aria-label="Decrease">
        <Minus className="w-3.5 h-3.5" />
      </button>
      <input
        type="number"
        value={num}
        onChange={e => {
          const n = parseFloat(e.target.value);
          onChange(Number.isNaN(n) ? 0 : clamp(n));
        }}
        min={input.min}
        max={input.max}
        step={step}
        className="field-input text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" onClick={() => adjust(step)} disabled={atMax} className="field-stepper" aria-label="Increase">
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function SliderField({ input, value, onChange }: Props) {
  const min = input.min ?? 0;
  const max = input.max ?? 100;
  const step = input.step ?? 1;
  const numValue = (value as number) ?? (input.default as number) ?? min;

  return (
    <Slider
      value={[numValue]}
      onValueChange={([v]) => onChange(v)}
      min={min}
      max={max}
      step={step}
    />
  );
}

function ImageField({ input, value, onChange }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageValue = value as { file?: File; preview?: string; url?: string } | null;

  const handleFile = useCallback((file: File) => {
    const preview = URL.createObjectURL(file);
    onChange({ file, preview });
  }, [onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleClear = useCallback(() => {
    if (imageValue?.preview) {
      URL.revokeObjectURL(imageValue.preview);
    }
    onChange(null);
  }, [imageValue, onChange]);

  if (imageValue?.preview) {
    return (
      <div className="relative rounded-lg overflow-hidden border border-gray-200">
        <img src={imageValue.preview} alt="Upload preview" className="w-full h-36 object-cover" />
        <button
          onClick={handleClear}
          className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
          dragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
        }`}
      >
        <Upload className="w-6 h-6 text-gray-400 mb-1.5" />
        <p className="text-xs text-gray-500">Drop image here or click to browse</p>
        <p className="text-[10px] text-gray-400 mt-0.5">PNG, JPG, WebP</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
    </div>
  );
}

function FileUploadField({ input, value, onChange, accept, label }: Props & { accept: string; label: string }) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileValue = value as { file?: File; name?: string } | null;

  const handleFile = useCallback((file: File) => {
    onChange({ file, name: file.name });
  }, [onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  if (fileValue?.name) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-lg bg-gray-50">
        <span className="text-sm text-gray-700 truncate flex-1">{fileValue.name}</span>
        <button
          onClick={() => onChange(null)}
          className="p-0.5 text-gray-400 hover:text-gray-600"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => fileInputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center h-24 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
        dragOver
          ? 'border-blue-400 bg-blue-50'
          : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
      }`}
    >
      <Upload className="w-5 h-5 text-gray-400 mb-1" />
      <p className="text-xs text-gray-500">Drop file or click to browse</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}
