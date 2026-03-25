'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import BlurHashImage from '@/components/ui/BlurHashImage';
import type { Photo } from '@/lib/api';

interface LightboxProps {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
}

export default function Lightbox({ photos, initialIndex, onClose }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [loaded, setLoaded] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const photo = photos[index];

  const prev = useCallback(() => {
    setLoaded(false);
    setIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);

  const next = useCallback(() => {
    setLoaded(false);
    setIndex((i) => (i + 1) % photos.length);
  }, [photos.length]);

  useEffect(() => {
    setLoaded(false);
  }, [index]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose, prev, next]);

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
          {photo.file_name && (
            <span className="ml-3 text-white/25">{photo.file_name}</span>
          )}
        </span>
        <button
          onClick={onClose}
          className="text-white/50 hover:text-white transition-colors text-2xl leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Image area */}
      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchStart === null) return;
          const diff = touchStart - e.changedTouches[0].clientX;
          if (Math.abs(diff) > 60) diff > 0 ? next() : prev();
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
            className="max-w-full max-h-full object-contain relative z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: loaded ? 1 : 0 }}
            onLoad={() => setLoaded(true)}
          />
        </AnimatePresence>

        {/* Prev button */}
        {photos.length > 1 && (
          <button
            onClick={prev}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all z-20"
            aria-label="Previous"
          >
            ‹
          </button>
        )}

        {/* Next button */}
        {photos.length > 1 && (
          <button
            onClick={next}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all z-20"
            aria-label="Next"
          >
            ›
          </button>
        )}
      </div>

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
