'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import type { HeroImage } from '@/lib/api';

interface HeroCarouselProps {
  images: HeroImage[];
}

export default function HeroCarousel({ images }: HeroCarouselProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

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
    goTo((current + 1) % count);
  }, [current, count, goTo]);

  useEffect(() => {
    if (count < 2) return;
    const timer = setInterval(next, 5000);
    return () => clearInterval(timer);
  }, [next, count]);

  if (count === 0) {
    // Fallback hero with no images
    return (
      <section className="relative h-screen flex items-center justify-center"
        style={{ background: 'var(--bg-primary)' }}>
        <HeroOverlay />
      </section>
    );
  }

  const img = images[current];

  return (
    <section className="relative h-screen overflow-hidden">
      {/* Background images */}
      {images.map((image, i) => (
        <div
          key={image.id}
          className="absolute inset-0 transition-opacity duration-700"
          style={{ opacity: i === current && !transitioning ? 1 : 0 }}
        >
          <img
            src={image.url_medium || image.url_original}
            alt={image.album_title}
            className="w-full h-full object-cover"
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.55) 100%)' }} />
        </div>
      ))}

      {/* Content overlay */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-6">
        <HeroOverlay />
      </div>

      {/* Dot navigation */}
      {count > 1 && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex gap-2">
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

function HeroOverlay() {
  const { t } = useTranslation();
  return (
    <div className="text-center">
      <p className="text-xs tracking-[0.3em] uppercase mb-6 text-white/60"
        style={{ fontFamily: 'var(--font-dm-mono)' }}>
        {t('hero.eyebrow')}
      </p>
      <h1 className="text-5xl md:text-7xl lg:text-8xl mb-6 text-white"
        style={{ fontFamily: 'var(--font-playfair)' }}>
        Ospreay Photo
      </h1>
      <p className="text-sm md:text-base mb-10 text-white/70 max-w-md mx-auto">
        {t('hero.subtitle')}
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Link
          href="/events"
          className="px-8 py-3 text-sm tracking-wide transition-colors"
          style={{ background: 'white', color: 'black', fontFamily: 'var(--font-dm-mono)' }}
        >
          {t('hero.exploreEvents')}
        </Link>
        <Link
          href="/gallery"
          className="px-8 py-3 text-sm tracking-wide transition-colors border border-white/40 text-white hover:bg-white/10"
          style={{ fontFamily: 'var(--font-dm-mono)' }}
        >
          {t('hero.exploreGallery')}
        </Link>
      </div>
    </div>
  );
}
