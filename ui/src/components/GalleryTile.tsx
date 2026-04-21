// Gallery tile with per-media-type rendering. The outer wrapper (grid cell,
// selection + favorite overlays, footer) is shared; the inner "preview area"
// swaps between image / video / audio.
//
// Fallbacks per type:
//  - image: `item.url` directly as an <img>; if missing, the MediaIcon tile.
//  - video: try `item.url` as a <video> element (poster frame = first frame
//    the browser decodes). On hover, autoplay muted preview. If the URL is
//    missing, render a dark tile with a centered Play icon.
//  - audio: compact Play/Pause button + the <audio> element; no waveform
//    (punted — rendering needs upstream audio decoding). A Music icon sits
//    at the top of the tile so scanning a grid still reads as "audio".

import { useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Check, Star, StarOff,
  Image as ImageIcon, Video, Music,
  Play, Pause, Trash2,
} from 'lucide-react';
import type { GalleryItem } from '../types';

interface GalleryTileProps {
  item: GalleryItem;
  isSelected: boolean;
  isFav: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}

export default function GalleryTile({
  item, isSelected, isFav,
  onOpen, onToggleSelect, onToggleFavorite, onDelete,
}: GalleryTileProps) {
  return (
    <div
      className={`card overflow-hidden group relative ${isSelected ? 'ring-2 ring-teal-500' : ''}`}
    >
      <button
        onClick={onOpen}
        className="w-full aspect-square bg-slate-100 flex items-center justify-center overflow-hidden"
      >
        <MediaPreview item={item} />
      </button>

      {/* Selection checkbox */}
      <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className={`p-1 rounded border transition-colors ${
            isSelected
              ? 'bg-teal-500 border-teal-500 text-white'
              : 'bg-white/80 border-slate-300 text-slate-500 hover:bg-white'
          }`}
          aria-label={isSelected ? 'Deselect' : 'Select'}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Favorite + delete actions */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className="p-1 bg-white/80 rounded border border-slate-300 text-slate-500 hover:text-yellow-500 transition-colors"
          aria-label={isFav ? 'Unfavorite' : 'Favorite'}
        >
          {isFav
            ? <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
            : <StarOff className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 bg-white/80 rounded border border-slate-300 text-slate-500 hover:text-red-600 transition-colors"
          aria-label="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2">
        <p className="text-xs text-slate-500 truncate">{item.filename}</p>
        {item.createdAt && (
          <p className="text-[10px] text-slate-400">
            {new Date(item.createdAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}

/** Routes by `mediaType` to the correct preview component. */
function MediaPreview({ item }: { item: GalleryItem }) {
  if (item.mediaType === 'video') return <VideoPreview item={item} />;
  if (item.mediaType === 'audio') return <AudioPreview item={item} />;
  return <ImagePreview item={item} />;
}

function ImagePreview({ item }: { item: GalleryItem }) {
  if (!item.url) return <ImageIcon className="w-10 h-10 text-slate-300" />;
  return (
    <img
      src={item.url}
      alt={item.filename}
      className="w-full h-full object-cover"
      loading="lazy"
    />
  );
}

function VideoPreview({ item }: { item: GalleryItem }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [hover, setHover] = useState(false);

  if (!item.url) {
    return (
      <div className="w-full h-full bg-slate-800 flex items-center justify-center">
        <Play className="w-8 h-8 text-white/80" fill="currentColor" />
      </div>
    );
  }

  const handleEnter = () => {
    setHover(true);
    const el = ref.current;
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => { /* autoplay may be blocked */ });
  };
  const handleLeave = () => {
    setHover(false);
    const el = ref.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  };

  return (
    <div
      className="relative w-full h-full"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <video
        ref={ref}
        src={item.url}
        className="w-full h-full object-cover"
        muted
        playsInline
        preload="metadata"
      />
      {!hover && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="bg-black/60 rounded-full p-2">
            <Play className="w-5 h-5 text-white" fill="currentColor" />
          </div>
        </div>
      )}
      <div className="absolute bottom-1 left-1 badge-pill bg-black/60 text-white border-transparent text-[10px] px-1.5 py-0.5">
        <Video className="w-3 h-3" />
        Video
      </div>
    </div>
  );
}

function AudioPreview({ item }: { item: GalleryItem }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const togglePlay = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-50 to-slate-200 px-3">
      <Music className="w-10 h-10 text-slate-400" />
      {item.url ? (
        <>
          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-teal-600 hover:bg-teal-700 text-white flex items-center justify-center shadow-sm transition-colors"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing
              ? <Pause className="w-4 h-4" fill="currentColor" />
              : <Play className="w-4 h-4" fill="currentColor" />}
          </button>
          <audio
            ref={audioRef}
            src={item.url}
            preload="none"
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />
        </>
      ) : null}
    </div>
  );
}
