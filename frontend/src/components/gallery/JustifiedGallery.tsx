'use client';

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { computeJustifiedLayout } from '@/lib/justified-layout';
import GalleryImage from './GalleryImage';
import Lightbox from './Lightbox';
import type { Photo } from '@/lib/api';

interface JustifiedGalleryProps {
  photos: Photo[];
  spacing?: number;
}

function getTargetRowHeight(width: number): number {
  if (width < 640) return 180;
  if (width < 1024) return 240;
  return 300;
}

export default function JustifiedGallery({ photos, spacing = 6 }: JustifiedGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setContainerWidth(el.offsetWidth);
    return () => observer.disconnect();
  }, []);

  if (!photos.length) {
    return (
      <div className="py-20 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
        No photos in this album yet.
      </div>
    );
  }

  const photosWithAspect = photos.map((p) => ({
    ...p,
    id: String(p.id),
    aspectRatio: p.aspect_ratio || (p.width && p.height ? p.width / p.height : 1.5),
  }));

  const targetRowHeight = getTargetRowHeight(containerWidth);
  const rows = containerWidth > 0
    ? computeJustifiedLayout(photosWithAspect, containerWidth, targetRowHeight, spacing)
    : [];

  let photoIndex = 0;

  return (
    <div ref={containerRef} className="w-full">
      {rows.map((row, rowIdx) => (
        <div
          key={rowIdx}
          className="flex"
          style={{ gap: spacing, marginBottom: spacing }}
        >
          {row.map((item) => {
            const idx = photoIndex++;
            const photo = photos.find((p) => String(p.id) === item.id);
            if (!photo) return null;
            return (
              <GalleryImage
                key={photo.id}
                photo={photo}
                displayWidth={item.displayWidth}
                displayHeight={item.displayHeight}
                index={idx}
                onClick={() => setLightboxIndex(idx)}
              />
            );
          })}
        </div>
      ))}

      <AnimatePresence>
        {lightboxIndex !== null && (
          <Lightbox
            photos={photos}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
