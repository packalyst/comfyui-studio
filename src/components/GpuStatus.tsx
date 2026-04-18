import { Cpu, Thermometer, HardDrive } from 'lucide-react';
import type { GpuInfo } from '../types';

interface Props {
  gpu: GpuInfo;
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

export default function GpuStatus({ gpu }: Props) {
  const usedPct = gpu.vram_total > 0 ? (gpu.vram_used / gpu.vram_total) * 100 : 0;

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Cpu className="w-5 h-5 text-blue-600" />
        <h3 className="font-semibold text-gray-900">GPU</h3>
      </div>
      <p className="text-sm font-medium text-gray-900 mb-3">{gpu.name}</p>
      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>VRAM Usage</span>
            <span>{formatBytes(gpu.vram_used)} / {formatBytes(gpu.vram_total)}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                usedPct > 90 ? 'bg-red-500' : usedPct > 70 ? 'bg-yellow-500' : 'bg-blue-500'
              }`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-gray-500">Total</p>
            <p className="text-sm font-medium">{formatBytes(gpu.vram_total)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Used</p>
            <p className="text-sm font-medium">{formatBytes(gpu.vram_used)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Free</p>
            <p className="text-sm font-medium">{formatBytes(gpu.vram_free)}</p>
          </div>
        </div>
        {gpu.temperature !== undefined && (
          <div className="flex items-center gap-1.5 text-sm text-gray-600">
            <Thermometer className="w-4 h-4" />
            <span>{gpu.temperature}C</span>
          </div>
        )}
      </div>
    </div>
  );
}
