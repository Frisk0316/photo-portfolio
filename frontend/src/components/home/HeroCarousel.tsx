'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { heroImages } from '@/lib/api';
import type { HeroImage, HeroCropData } from '@/lib/api';

// Detect mobile device by the shorter screen dimension (portrait width),
// so landscape phones still count as mobile.
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const shortSide = Math.min(screen.width, screen.height);
  // Also check touch support as a safeguard
  const hasTouch = navigator.maxTouchPoints > 0;
  return shortSide < 768 && hasTouch;
}

// Track whether the device is currently in landscape orientation
function useOrientation(): 'portrait' | 'landscape' {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  useEffect(() => {
    const check = () => setOrientation(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return orientation;
}

function cropStyle(crop: HeroCropData | null): React.CSSProperties {
  if (!crop || (crop.offsetX === 0 && crop.offsetY === 0 && crop.zoom === 1)) return {};
  const posX = 50 + crop.offsetX * 50;
  const posY = 50 + crop.offsetY * 50;
  return {
    objectPosition: `${posX}% ${posY}%`,
    transform: `scale(${crop.zoom})`,
    transformOrigin: `${posX}% ${posY}%`,
  };
}

export default function HeroCarousel() {
  const { t } = useTranslation();
  const [images, setImages] = useState<HeroImage[]>([]);
  const [current, setCurrent] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const orientation = useOrientation();

  // Detect device type once on mount and fetch the correct image set
  useEffect(() => {
    const mobile = isMobileDevice();
    setIsMobile(mobile);
    const device = mobile ? 'mobile' : 'desktop';
    heroImages.list(device).then(r => {
      if (r.data.length > 0) {
        setImages(r.data);
      } else {
        heroImages.list().then(all => setImages(all.data));
      }
    }).catch(() => {});
  }, []);

  const count = images.length;

  const goTo = useCallback((index: number) => {
    if (transitioning || index === current) return;
    setTransitioning(true);
    setTimeout(() => {
      setCurrent(index);
      setTransitioning(false);
    }, 400);
  }, [current, transitioning]);

  const next = useCallback(() => {
    if (count < 2) return;
    goTo((current + 1) % count);
  }, [current, count, goTo]);

  useEffect(() => {
    if (count < 2) return;
    const timer = setInterval(next, 5000);
    return () => clearInterval(timer);
  }, [next, count]);

  // Mobile landscape detection for layout adjustments
  const isMobileLandscape = isMobile && orientation === 'landscape';

  if (count === 0) {
    return (
      <section className="relative h-screen flex items-center justify-center"
        style={{ background: 'var(--bg-primary)' }}>
        <HeroOverlay compact={isMobileLandscape} />
      </section>
    );
  }

  return (
    <section className="relative h-screen overflow-hidden">
      {/* Background images */}
      {images.map((image, i) => {
        // Mobile landscape → use desktop crop (viewport shape is landscape like desktop)
        // Mobile portrait → use mobile crop
        // Desktop → use desktop crop
        let activeCrop: HeroCropData | null = null;
        if (isMobile && orientation === 'portrait') {
          activeCrop = image.crop_mobile || null;
        } else {
          activeCrop = image.crop_desktop || null;
        }

        return (
          <div
            key={image.id}
            className="absolute inset-0 transition-opacity duration-700"
            style={{ opacity: i === current && !transitioning ? 1 : 0 }}
          >
            <img
              src={image.url_medium || image.url_original}
              alt={image.album_title}
              className="w-full h-full object-cover"
              style={cropStyle(activeCrop)}
            />
            <div className="absolute inset-0"
              style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.55) 100%)' }} />
          </div>
        );
      })}

      {/* Content overlay */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-6">
        <HeroOverlay compact={isMobileLandscape} />
      </div>

      {/* Dot navigation */}
      {count > 1 && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-20 flex gap-2 ${isMobileLandscape ? 'bottom-3' : 'bottom-8'}`}>
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === current ? 'bg-white w-6' : 'bg-white/40 hover:bg-white/60'
              }`}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* Prev/Next arrows */}
      {count > 1 && (
        <>
          <button
            onClick={() => goTo((current - 1 + count) % count)}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-all"
          >
            ‹
          </button>
          <button
            onClick={() => goTo((current + 1) % count)}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-all"
          >
            ›
          </button>
        </>
      )}
    </section>
  );
}

function HeroOverlay({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="text-center">
      {!compact && (
        <p className="text-xs tracking-[0.3em] uppercase mb-6 text-white/60"
          style={{ fontFamily: 'var(--font-dm-mono)' }}>
          {t('hero.eyebrow')}
        </p>
      )}
      <h1 className={`text-white ${compact ? 'text-3xl mb-3' : 'text-5xl md:text-7xl lg:text-8xl mb-6'}`}
        style={{ fontFamily: 'var(--font-playfair)' }}>
        Ospreay Photo
      </h1>
      {!compact && (
        <p className="text-sm md:text-base mb-10 text-white/70 max-w-md mx-auto">
          {t('hero.subtitle')}
        </p>
      )}
      <div className={`flex gap-4 justify-center ${compact ? 'flex-row mt-2' : 'flex-col sm:flex-row'}`}>
        <Link
          href="/events"
          className={`tracking-wide transition-colors ${compact ? 'px-5 py-2 text-xs' : 'px-8 py-3 text-sm'}`}
          style={{ background: 'white', color: 'black', fontFamily: 'var(--font-dm-mono)' }}
        >
          {t('hero.exploreEvents')}
        </Link>
        <Link
          href="/gallery"
          className={`tracking-wide transition-colors border border-white/40 text-white hover:bg-white/10 ${compact ? 'px-5 py-2 text-xs' : 'px-8 py-3 text-sm'}`}
          style={{ fontFamily: 'var(--font-dm-mono)' }}
        >
          {t('hero.exploreGallery')}
        </Link>
      </div>
    </div>
  );
}
