'use client';

import { useState } from 'react';
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';
import BlurHashImage from '@/components/ui/BlurHashImage';
import type { Photo } from '@/lib/api';

interface GalleryImageProps {
  photo: Photo;
  displayWidth: number;
  displayHeight: number;
  index: number;
  onClick: () => void;
}

export default function GalleryImage({
  photo,
  displayWidth,
  displayHeight,
  index,
  onClick,
}: GalleryImageProps) {
  const [ref, inView] = useIntersectionObserver();
  const [loaded, setLoaded] = useState(false);
  const delay = Math.min(index * 40, 600);

  return (
    <div
      ref={ref}
      className="relative overflow-hidden cursor-pointer group"
      style={{ width: displayWidth, height: displayHeight, flexShrink: 0, WebkitTouchCallout: 'none' } as React.CSSProperties}
      onContextMenu={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {/* BlurHash placeholder */}
      {photo.blur_hash && (
        <BlurHashImage
          hash={photo.blur_hash}
          width={32}
          height={32}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Actual image */}
      {inView && (
        <img
          src={photo.url_thumbnail}
          alt={photo.caption || photo.file_name}
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-400 group-hover:scale-[1.02] transition-transform"
          style={{
            opacity: loaded ? 1 : 0,
            animationDelay: `${delay}ms`,
            transitionDuration: '400ms',
          }}
          onLoad={() => setLoaded(true)}
          loading="lazy"
        />
      )}

      {/* Watermark */}
      <div className="absolute bottom-2 left-0 right-0 z-10 text-center pointer-events-none select-none">
        <span
          className="text-white/60 text-xs"
          style={{ fontFamily: 'var(--font-dancing)' }}
        >
          Ospreay Photo
        </span>
      </div>

      {/* Hover overlay */}
      {photo.caption && (
        <div className="absolute inset-0 z-20 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex items-end p-3">
          <p
            className="text-white text-xs font-mono opacity-0 group-hover:opacity-100 transition-opacity duration-300 line-clamp-2"
            style={{ fontFamily: 'var(--font-dm-mono)' }}
          >
            {photo.caption}
          </p>
        </div>
      )}
    </div>
  );
}
