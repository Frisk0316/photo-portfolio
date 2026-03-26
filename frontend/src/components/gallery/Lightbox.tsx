'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import BlurHashImage from '@/components/ui/BlurHashImage';
import type { Photo } from '@/lib/api';

interface LightboxProps {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
}

function formatExifValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const v = String(value);
  if (!v) return null;
  return v;
}

const EXIF_LABELS: Record<string, string> = {
  Make: '相機品牌',
  Model: '相機型號',
  LensModel: '鏡頭',
  FocalLength: '焦距',
  FNumber: '光圈',
  ExposureTime: '快門速度',
  ISO: 'ISO',
  FocalLengthIn35mmFormat: '等效焦距',
};

export default function Lightbox({ photos, initialIndex, onClose }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [loaded, setLoaded] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  // Zoom & pan state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const imageAreaRef = useRef<HTMLDivElement>(null);

  // EXIF panel
  const [showExif, setShowExif] = useState(false);

  // Slideshow
  const [isPlaying, setIsPlaying] = useState(false);
  const slideshowRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const photo = photos[index];

  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const prev = useCallback(() => {
    setLoaded(false);
    resetZoom();
    setIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length, resetZoom]);

  const next = useCallback(() => {
    setLoaded(false);
    resetZoom();
    setIndex((i) => (i + 1) % photos.length);
  }, [photos.length, resetZoom]);

  // Slideshow auto-advance
  useEffect(() => {
    if (isPlaying) {
      slideshowRef.current = setInterval(() => {
        next();
      }, 4000);
    }
    return () => {
      if (slideshowRef.current) clearInterval(slideshowRef.current);
    };
  }, [isPlaying, next]);

  useEffect(() => {
    setLoaded(false);
  }, [index]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') { setIsPlaying(false); prev(); }
      if (e.key === 'ArrowRight') { setIsPlaying(false); next(); }
      if (e.key === 'i' || e.key === 'I') setShowExif((s) => !s);
      if (e.key === ' ') { e.preventDefault(); setIsPlaying((s) => !s); }
    };
    window.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose, prev, next]);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setScale((s) => {
      const newScale = Math.min(4, Math.max(1, s + delta));
      if (newScale === 1) setTranslate({ x: 0, y: 0 });
      return newScale;
    });
  }, []);

  // Double click to toggle zoom
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (scale > 1) {
      resetZoom();
    } else {
      setScale(2);
      // Zoom toward click point
      const rect = imageAreaRef.current?.getBoundingClientRect();
      if (rect) {
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        setTranslate({ x: -cx * 0.5, y: -cy * 0.5 });
      }
    }
  }, [scale, resetZoom]);

  // Mouse drag for panning when zoomed
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
  }, [scale, translate]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setTranslate({ x: dragStart.current.tx + dx, y: dragStart.current.ty + dy });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Determine cursor
  let cursor = 'default';
  if (scale > 1) cursor = isDragging ? 'grabbing' : 'grab';
  else cursor = 'zoom-in';

  // EXIF data
  const exifData = photo.exif_data as Record<string, unknown> | null;
  const exifEntries = exifData
    ? Object.entries(EXIF_LABELS)
        .map(([key, label]) => {
          const val = formatExifValue(key, exifData[key]);
          return val ? { label, value: val } : null;
        })
        .filter(Boolean) as { label: string; value: string }[]
    : [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="text-xs text-white/40"
          style={{ fontFamily: 'var(--font-dm-mono)' }}
        >
          {index + 1} / {photos.length}
        </span>

        <div className="flex items-center gap-3">
          {/* Slideshow toggle */}
          <button
            onClick={() => setIsPlaying((s) => !s)}
            className="text-white/40 hover:text-white transition-colors text-sm"
            title={isPlaying ? '暫停幻燈片' : '播放幻燈片'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          {/* EXIF toggle */}
          {exifEntries.length > 0 && (
            <button
              onClick={() => setShowExif((s) => !s)}
              className={`transition-colors text-sm ${showExif ? 'text-white' : 'text-white/40 hover:text-white'}`}
              title="EXIF 資訊 (i)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Image area */}
      <div
        ref={imageAreaRef}
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        style={{ cursor }}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={(e) => {
          if (scale > 1) return; // Don't swipe when zoomed
          setTouchStart(e.touches[0].clientX);
        }}
        onTouchEnd={(e) => {
          if (scale > 1) return;
          if (touchStart === null) return;
          const diff = touchStart - e.changedTouches[0].clientX;
          if (Math.abs(diff) > 60) {
            setIsPlaying(false);
            diff > 0 ? next() : prev();
          }
          setTouchStart(null);
        }}
      >
        {/* Blur placeholder */}
        {!loaded && photo.blur_hash && (
          <BlurHashImage
            hash={photo.blur_hash}
            width={32}
            height={32}
            className="absolute inset-0 w-full h-full object-contain"
            style={{ filter: 'blur(20px)', transform: 'scale(1.1)' } as React.CSSProperties}
          />
        )}

        <AnimatePresence mode="wait">
          <motion.img
            key={photo.id}
            src={photo.url_medium}
            alt={photo.caption || photo.file_name}
            className="max-w-full max-h-full object-contain relative z-10 select-none"
            draggable={false}
            style={{
              transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
              transition: isDragging ? 'none' : 'transform 0.2s ease-out',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: loaded ? 1 : 0 }}
            onLoad={() => setLoaded(true)}
          />
        </AnimatePresence>

        {/* EXIF Panel */}
        <AnimatePresence>
          {showExif && exifEntries.length > 0 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="absolute right-4 top-4 z-30 rounded-lg p-4 space-y-2 min-w-[200px]"
              style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-xs text-white/60 mb-3 font-medium">EXIF 資訊</p>
              {exifEntries.map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-4 text-xs">
                  <span className="text-white/40">{label}</span>
                  <span className="text-white/80" style={{ fontFamily: 'var(--font-dm-mono)' }}>{value}</span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Prev button */}
        {photos.length > 1 && (
          <button
            onClick={() => { setIsPlaying(false); prev(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all z-20"
            aria-label="Previous"
          >
            ‹
          </button>
        )}

        {/* Next button */}
        {photos.length > 1 && (
          <button
            onClick={() => { setIsPlaying(false); next(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all z-20"
            aria-label="Next"
          >
            ›
          </button>
        )}
      </div>

      {/* Slideshow progress bar */}
      {isPlaying && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 z-30">
          <motion.div
            key={`progress-${index}`}
            className="h-full bg-white/30"
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: 4, ease: 'linear' }}
          />
        </div>
      )}

      {/* Caption */}
      {photo.caption && (
        <div
          className="px-6 py-4 text-center text-sm text-white/50 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {photo.caption}
        </div>
      )}
    </motion.div>
  );
}
