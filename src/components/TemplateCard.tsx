import { useNavigate } from 'react-router-dom';
import { Image, Video, Music, Box, HardDrive, Cpu, BarChart3 } from 'lucide-react';
import type { Template } from '../types';
import ModelBadge from './ModelBadge';

interface Props {
  template: Template;
}

const mediaIcons: Record<string, React.ElementType> = {
  image: Image,
  video: Video,
  audio: Music,
  '3d': Box,
};

const gradientMap: Record<string, string> = {
  image: 'from-blue-400 to-blue-600',
  video: 'from-purple-400 to-purple-600',
  audio: 'from-orange-400 to-orange-600',
  '3d': 'from-green-400 to-green-600',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatUsage(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M uses`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k uses`;
  return `${count} uses`;
}

export default function TemplateCard({ template }: Props) {
  const navigate = useNavigate();
  const Icon = mediaIcons[template.mediaType] || Image;
  const gradient = gradientMap[template.mediaType] || 'from-gray-400 to-gray-600';

  return (
    <button
      onClick={() => {
        const cat = template.studioCategory || template.mediaType || 'image';
        navigate(`/studio/${encodeURIComponent(template.name)}?category=${cat}`);
      }}
      className="card text-left group cursor-pointer overflow-hidden flex flex-col h-full"
    >
      <div className="aspect-video shrink-0 relative flex items-center justify-center overflow-hidden">
        {template.name ? (
          <img
            src={`/api/template-asset/${template.name}-1.webp`}
            alt={template.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              // Fall back to gradient on load error
              const target = e.currentTarget;
              target.style.display = 'none';
              target.parentElement?.classList.add('bg-gradient-to-br', ...gradient.split(' '));
            }}
          />
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
            <Icon className="w-10 h-10 text-white/60 group-hover:text-white/80 transition-colors" />
          </div>
        )}
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {template.openSource !== undefined && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              template.openSource
                ? 'bg-green-500/90 text-white'
                : 'bg-gray-500/80 text-white'
            }`}>
              {template.openSource ? 'Open Source' : 'API'}
            </span>
          )}
          <span className={`badge ${
            template.mediaType === 'image' ? 'badge-blue' :
            template.mediaType === 'video' ? 'badge-purple' :
            template.mediaType === 'audio' ? 'badge-orange' :
            'badge-gray'
          }`}>
            {template.mediaType}
          </span>
        </div>
      </div>
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-sm text-gray-900 mb-1 group-hover:text-teal-600 transition-colors line-clamp-1">
          {template.title}
        </h3>
        <div className="relative mb-3 h-[100px]">
          <p className="text-xs text-gray-500 overflow-y-auto h-full pr-1">
            {template.description}
          </p>
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent" />
        </div>
        <div className="mt-auto">
          {/* Stats row */}
          <div className="flex items-center gap-3 mb-3 text-[11px] text-gray-400">
            {template.size !== undefined && (
              <span className="flex items-center gap-1">
                <HardDrive className="w-3 h-3" />
                {template.size === 0 ? 'Cloud API' : formatBytes(template.size)}
              </span>
            )}
            {template.vram !== undefined && template.vram > 0 && (
              <span className="flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                {formatBytes(template.vram)}
              </span>
            )}
            {template.usage !== undefined && template.usage > 0 && (
              <span className="flex items-center gap-1">
                <BarChart3 className="w-3 h-3" />
                {formatUsage(template.usage)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {Array.from(new Set(template.models)).slice(0, 3).map(model => (
              <ModelBadge key={model} name={model} />
            ))}
          </div>
          {template.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {Array.from(new Set(template.tags)).slice(0, 3).map(tag => (
                <span key={tag} className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
