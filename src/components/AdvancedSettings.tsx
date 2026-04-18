import { useState } from 'react';
import { ChevronDown, Shuffle, Minus, Plus } from 'lucide-react';
import type { AdvancedSetting } from '../types';
import { Slider } from './ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';

interface Props {
  settings: AdvancedSetting[];
  values: Record<string, { proxyIndex: number; value: unknown }>;
  onChange: (values: Record<string, { proxyIndex: number; value: unknown }>) => void;
}

export default function AdvancedSettings({ settings, values, onChange }: Props) {
  const [open, setOpen] = useState(false);

  if (settings.length === 0) return null;

  const handleChange = (setting: AdvancedSetting, newValue: unknown) => {
    onChange({
      ...values,
      [setting.id]: { proxyIndex: setting.proxyIndex, value: newValue },
    });
  };

  const getValue = (setting: AdvancedSetting): unknown => {
    const override = values[setting.id];
    if (override !== undefined) return override.value;
    return setting.value;
  };

  return (
    <div className="border-t border-gray-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left group"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
            open ? '' : '-rotate-90'
          }`}
        />
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider group-hover:text-gray-600 transition-colors">
          Advanced Settings
        </span>
        <span className="text-[10px] text-gray-300 ml-auto">
          {settings.length} {settings.length === 1 ? 'option' : 'options'}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {settings.map(setting => (
            <SettingField
              key={setting.id}
              setting={setting}
              value={getValue(setting)}
              onChange={(val) => handleChange(setting, val)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SettingField({
  setting,
  value,
  onChange,
}: {
  setting: AdvancedSetting;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  // Toggle renders inline: label left, switch right, no control row below.
  if (setting.type === 'toggle') {
    return (
      <div className="flex items-center">
        <label className="text-xs font-medium text-gray-600">{setting.label}</label>
        <span className="ml-auto">
          <Switch size="sm" checked={!!value} onCheckedChange={onChange} />
        </span>
      </div>
    );
  }

  let labelRight: React.ReactNode = null;
  if (setting.type === 'slider') {
    const step = setting.step ?? 1;
    const min = setting.min ?? 0;
    const num = (value as number) ?? min;
    const precision = Math.max(0, -Math.floor(Math.log10(step)));
    labelRight = <span className="text-xs font-medium tabular-nums text-slate-700">{num.toFixed(precision)}</span>;
  }
  return (
    <div>
      <div className="flex items-center mb-1">
        <label className="text-xs font-medium text-gray-600">{setting.label}</label>
        {labelRight && <span className="ml-auto">{labelRight}</span>}
      </div>
      <SettingControl setting={setting} value={value} onChange={onChange} />
    </div>
  );
}

function SettingControl({
  setting,
  value,
  onChange,
}: {
  setting: AdvancedSetting;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (setting.type) {
    case 'number': {
      const step = setting.step ?? 1;
      const raw = (value as number | undefined) ?? setting.min ?? 0;
      const num = typeof raw === 'number' ? raw : Number(raw) || 0;
      const clamp = (n: number) => {
        if (setting.min !== undefined) n = Math.max(setting.min, n);
        if (setting.max !== undefined) n = Math.min(setting.max, n);
        const precision = Math.max(0, -Math.floor(Math.log10(step)));
        return parseFloat(n.toFixed(precision));
      };
      const atMin = setting.min !== undefined && num <= setting.min;
      const atMax = setting.max !== undefined && num >= setting.max;
      return (
        <div className="field-wrap">
          <button type="button" onClick={() => onChange(clamp(num - step))} disabled={atMin} className="field-stepper" aria-label="Decrease">
            <Minus className="w-3.5 h-3.5" />
          </button>
          <input
            type="number"
            value={num}
            onChange={e => {
              const n = parseFloat(e.target.value);
              onChange(Number.isNaN(n) ? 0 : clamp(n));
            }}
            min={setting.min}
            max={setting.max}
            step={step}
            className="field-input text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button type="button" onClick={() => onChange(clamp(num + step))} disabled={atMax} className="field-stepper" aria-label="Increase">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }

    case 'slider': {
      const min = setting.min ?? 0;
      const max = setting.max ?? 100;
      const step = setting.step ?? 1;
      const numValue = (value as number) ?? min;
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

    case 'seed': {
      const seedValue = value as number | null | undefined;
      return (
        <div className="field-wrap">
          <input
            type="number"
            value={seedValue ?? ''}
            onChange={e => {
              const v = e.target.value;
              onChange(v === '' ? null : parseInt(v, 10));
            }}
            placeholder="Random"
            className="field-input tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => onChange(Math.floor(Math.random() * 2147483647))}
            className="field-stepper"
            title="Randomize seed"
          >
            <Shuffle className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }

    case 'select':
      return (
        <Select value={(value as string) ?? ''} onValueChange={v => onChange(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {setting.options?.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    default:
      return null;
  }
}
