'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { albums, categories } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import type { Album, Category } from '@/lib/api';

export default function GalleryPage() {
  const { t } = useTranslation();
  const [albumList, setAlbumList] = useState<Album[]>([]);
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<'date_desc' | 'date_asc'>('date_desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      albums.list(false, sortOrder, 'other'),
      categories.list('other'),
    ])
      .then(([a, c]) => {
        setAlbumList(a.data);
        setCategoryList(c.data);
      })
      .finally(() => setLoading(false));
  }, [sortOrder]);

  const filtered = activeCategory
    ? albumList.filter((a) => a.category_id === activeCategory)
    : albumList;

  return (
    <>
      <Header
        categories={categoryList}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        sortOrder={sortOrder}
        onSortChange={setSortOrder}
      />

      <main className="px-6 pb-8">
        {/* Hero */}
        <section className="py-16 md:py-24">
          <p className="text-xs tracking-[0.2em] uppercase mb-4"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            Photography
          </p>
          <h1 className="text-4xl md:text-6xl mb-4" style={{ fontFamily: 'var(--font-playfair)' }}>
            {t('gallery.title')}
          </h1>
          <p className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
            {t('gallery.subtitle')}
          </p>
        </section>

        {/* Album grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <LoadingSpinner />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-20 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {t('common.noAlbums')}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}

function AlbumCard({ album }: { album: Album }) {
  const { t } = useTranslation();
  return (
    <Link
      href={`/gallery/${album.slug}`}
      className="group block rounded overflow-hidden"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="aspect-[4/3] overflow-hidden bg-[var(--bg-elevated)] relative">
        {album.cover_url ? (
          <CoverImage url={album.cover_url} alt={album.title} cropData={album.cover_crop_data} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm"
            style={{ color: 'var(--text-tertiary)' }}>
            No cover
          </div>
        )}
      </div>
      <div className="p-4">
        {album.category_name && (
          <p className="text-xs mb-1 uppercase tracking-widest"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            {album.category_name}
          </p>
        )}
        {album.shot_date && (
          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            {formatDate(album.shot_date)}
          </p>
        )}
        <h2 className="text-base mb-1 group-hover:text-white transition-colors" style={{ fontFamily: 'var(--font-playfair)' }}>
          {album.title}
        </h2>
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
      <img src={url} alt={alt}
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
    );
  }
  const posX = 50 + cropData.offsetX * 50;
  const posY = 50 + cropData.offsetY * 50;
  return (
    <div className="w-full h-full overflow-hidden transition-transform duration-500 group-hover:scale-105">
      <img src={url} alt={alt} className="w-full h-full object-cover"
        style={{
          objectPosition: `${posX}% ${posY}%`,
          transform: `scale(${cropData.zoom})`,
          transformOrigin: `${posX}% ${posY}%`,
        }}
      />
    </div>
  );
}
