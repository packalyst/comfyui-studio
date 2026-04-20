import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Compass, Wand2, Image, Box, Package, Settings, Wifi, WifiOff, Menu, X, Play, Loader2, ExternalLink } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/comfyui';
import ComfyUIActions from './ComfyUIActions';

function editorHref(): string {
  const { protocol, host } = window.location;
  const parts = host.split('.');
  if (parts.length <= 1) return `${protocol}//comfyuieditor`;
  return `${protocol}//comfyuieditor.${parts.slice(1).join('.')}`;
}

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/studio', label: 'Studio', icon: Wand2 },
  { to: '/gallery', label: 'Gallery', icon: Image },
  { to: '/models', label: 'Models', icon: Box },
  { to: '/plugins', label: 'Plugins', icon: Package },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Navbar() {
  const { connected, launcherStatus } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  // Clear optimistic "starting" once the real state catches up
  useEffect(() => {
    if (starting && launcherStatus?.running) setStarting(false);
  }, [starting, launcherStatus]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await api.startComfyUI();
    } catch {
      setStarting(false);
    }
  };

  const statusPill = (() => {
    if (starting) {
      return (
        <div className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
          <Loader2 className="w-3 h-3 animate-spin" />
          Starting…
        </div>
      );
    }
    if (connected) {
      return (
        <a
          href={editorHref()}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
          title="Open ComfyUI editor in new tab"
        >
          <Wifi className="w-3 h-3" />
          Connected
          <ExternalLink className="w-3 h-3 opacity-60" />
        </a>
      );
    }
    return (
      <button
        onClick={handleStart}
        className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors cursor-pointer"
        title="Start ComfyUI"
      >
        <WifiOff className="w-3 h-3 group-hover:hidden" />
        <Play className="w-3 h-3 hidden group-hover:inline" />
        Start ComfyUI
      </button>
    );
  })();

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-8">
            <NavLink to="/" className="flex items-center gap-2 font-semibold text-lg text-gray-900">
              <Wand2 className="w-5 h-5 text-blue-600" />
              <span>ComfyUI Studio</span>
            </NavLink>
            <div className="hidden md:flex items-center gap-1">
              {links.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Desktop: status pill + actions */}
            <div className="hidden md:flex items-center gap-1.5">
              {statusPill}
              <ComfyUIActions />
            </div>
            {/* Mobile: hamburger button */}
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="md:hidden btn-icon"
              aria-label="Menu"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer — overlays content, fades in */}
      <div
        className={`md:hidden absolute left-0 right-0 top-full border-t border-gray-100 bg-white shadow-lg transition-all duration-200 ${
          menuOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}
      >
        <div className="px-3 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500">Status</span>
          {statusPill}
        </div>
        <div className="px-2 py-2 space-y-1">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Backdrop when menu open */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 top-14 bg-black/20 z-[-1]"
          onClick={() => setMenuOpen(false)}
        />
      )}
    </nav>
  );
}
