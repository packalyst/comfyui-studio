import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { Template } from '../types';

interface Props {
  templates: Template[];
  selected: string;
  onSelect: (templateName: string) => void;
}

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function getSubtitle(template: Template): string {
  if (template.tags.length > 0) return template.tags[0];
  return template.mediaType;
}

function getInitialColor(name: string): string {
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-teal-100 text-teal-700',
    'bg-purple-100 text-purple-700',
    'bg-orange-100 text-orange-700',
    'bg-pink-100 text-pink-700',
    'bg-green-100 text-green-700',
    'bg-indigo-100 text-indigo-700',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export default function ModelDropdown({ templates, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedTemplate = useMemo(
    () => templates.find(t => t.name === selected),
    [templates, selected],
  );

  const selectedInitialColor = useMemo(
    () => (selectedTemplate ? getInitialColor(selectedTemplate.title) : ''),
    [selectedTemplate],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      t.title.toLowerCase().includes(q) || t.models.some(m => m.toLowerCase().includes(q)),
    );
  }, [templates, search]);

  const filteredColors = useMemo(
    () => filtered.map(t => getInitialColor(t.title)),
    [filtered],
  );

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-white border border-gray-300 rounded-lg hover:border-gray-400 transition-colors text-left"
      >
        {selectedTemplate ? (
          <>
            <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${selectedInitialColor}`}>
              {getInitial(selectedTemplate.title)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{selectedTemplate.title}</p>
              <p className="text-[11px] text-gray-500 truncate">{getSubtitle(selectedTemplate)}</p>
            </div>
          </>
        ) : (
          <span className="text-sm text-gray-400 flex-1">Select a model...</span>
        )}
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-40 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">No models found</p>
            ) : (
              filtered.map((t, i) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => {
                    onSelect(t.name);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${
                    t.name === selected ? 'bg-teal-50' : ''
                  }`}
                >
                  <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${filteredColors[i]}`}>
                    {getInitial(t.title)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                    <p className="text-[11px] text-gray-500 truncate">{getSubtitle(t)}</p>
                  </div>
                  {t.models.length > 0 && (
                    <span className="text-[10px] font-medium text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded flex-shrink-0">
                      {t.models[0]}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
