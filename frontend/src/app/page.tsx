'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import HeroCarousel from '@/components/home/HeroCarousel';
import { albums } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import type { Album } from '@/lib/api';

export default function HomePage() {
  const { t } = useTranslation();
  const [eventAlbums, setEventAlbums] = useState<Album[]>([]);
  const [otherAlbums, setOtherAlbums] = useState<Album[]>([]);

  useEffect(() => {
    albums.list(false, 'date_desc', 'events').then(r => setEventAlbums(r.data.slice(0, 3))).catch(() => {});
    albums.list(false, 'date_desc', 'other').then(r => setOtherAlbums(r.data.slice(0, 3))).catch(() => {});
  }, []);

  return (
    <>
      <Header />

      {/* Hero carousel — self-fetching, device-aware */}
      <HeroCarousel />

      {/* Section previews */}
      <main className="px-6 pb-16">
        {/* Events section preview */}
        <SectionPreview
          eyebrow="Event Photography"
          title={t('events.title')}
          subtitle={t('events.subtitle')}
          href="/events"
          albums={eventAlbums}
          ctaLabel={t('hero.exploreEvents')}
        />

        {/* Divider */}
        <div className="my-16" style={{ borderTop: '1px solid var(--border)' }} />

        {/* Gallery section preview */}
        <SectionPreview
          eyebrow="Gallery"
          title={t('gallery.title')}
          subtitle={t('gallery.subtitle')}
          href="/gallery"
          albums={otherAlbums}
          ctaLabel={t('hero.exploreGallery')}
        />
      </main>

      <Footer />
    </>
  );
}

function SectionPreview({
  eyebrow,
  title,
  subtitle,
  href,
  albums: albumList,
  ctaLabel,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  href: string;
  albums: Album[];
  ctaLabel: string;
}) {
  const { t } = useTranslation();

  return (
    <section className="py-16">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-3"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            {eyebrow}
          </p>
          <h2 className="text-3xl md:text-4xl mb-2" style={{ fontFamily: 'var(--font-playfair)' }}>
            {title}
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>
        </div>
        <Link
          href={href}
          className="text-xs tracking-wide shrink-0 hover:text-white transition-colors"
          style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}
        >
          {ctaLabel} →
        </Link>
      </div>

      {albumList.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {albumList.map((album) => (
            <AlbumCard key={album.id} album={album} basePath={href} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-[4/3] rounded overflow-hidden"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
          ))}
        </div>
      )}
    </section>
  );
}

function AlbumCard({ album, basePath }: { album: Album; basePath: string }) {
  const { t, locale } = useTranslation();
  const slug = album.slug;
  const href = `${basePath}/${slug}`;
  const displayTitle = locale === 'en' && album.title_en ? album.title_en : album.title;

  return (
    <Link
      href={href}
      className="group block rounded overflow-hidden"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="cover-container overflow-hidden bg-[var(--bg-elevated)] relative">
        {album.cover_url ? (
          <CoverImage url={album.cover_url} alt={displayTitle} cropData={album.cover_crop_data} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm"
            style={{ color: 'var(--text-tertiary)' }}>
            No cover
          </div>
        )}
      </div>
      <div className="p-4">
        {album.shot_date && (
          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            {formatDate(album.shot_date, locale)}
          </p>
        )}
        <h3 className="text-base mb-1 group-hover:text-white transition-colors" style={{ fontFamily: 'var(--font-playfair)' }}>
          {displayTitle}
        </h3>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
          {album.photo_count} {t('common.photos')}
        </p>
      </div>
    </Link>
  );
}

function CoverImage({ url, alt, cropData }: {
  url: string;
  alt: string;
  cropData: { offsetX: number; offsetY: number; zoom: number } | null;
}) {
  if (!cropData || (cropData.zoom === 1 && cropData.offsetX === 0 && cropData.offsetY === 0)) {
    return (
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
    );
  }
  const posX = 50 + cropData.offsetX * 50;
  const posY = 50 + cropData.offsetY * 50;
  return (
    <div className="w-full h-full overflow-hidden transition-transform duration-500 group-hover:scale-105">
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className="w-full h-full object-cover"
        style={{
          objectPosition: `${posX}% ${posY}%`,
          transform: `scale(${cropData.zoom})`,
          transformOrigin: `${posX}% ${posY}%`,
        }}
      />
    </div>
  );
}
