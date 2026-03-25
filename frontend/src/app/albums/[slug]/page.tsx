import type { Metadata } from 'next';
import Link from 'next/link';
import JustifiedGallery from '@/components/gallery/JustifiedGallery';
import Footer from '@/components/layout/Footer';
import { formatDate } from '@/lib/utils';

const API_URL = process.env.BACKEND_URL
  || 'https://determined-enthusiasm-production-22d1.up.railway.app';

async function getAlbum(slug: string) {
  try {
    const res = await fetch(`${API_URL}/api/albums/${slug}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const album = await getAlbum(params.slug);
  if (!album) return { title: 'Album not found' };
  return {
    title: `${album.title} — Portfolio`,
    description: album.description || `${album.photo_count} photos`,
    openGraph: {
      title: album.title,
      description: album.description || '',
      images: album.cover_url ? [album.cover_url] : [],
    },
  };
}

export default async function AlbumPage({ params }: { params: { slug: string } }) {
  const album = await getAlbum(params.slug);

  if (!album) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Album not found.</p>
      </div>
    );
  }

  return (
    <>
      <header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <Link
          href="/"
          className="text-xs hover:text-white transition-colors inline-flex items-center gap-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          ← Back
        </Link>
      </header>

      <main className="px-6 py-10">
        {/* Album header */}
        <div className="max-w-2xl mb-10">
          {album.shot_date && (
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
              {formatDate(album.shot_date)}
            </p>
          )}
          <h1 className="text-3xl md:text-5xl mb-4" style={{ fontFamily: 'var(--font-playfair)' }}>
            {album.title}
          </h1>
          {album.description && (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {album.description}
            </p>
          )}
          <p className="text-xs mt-4" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            {album.photo_count} photos
          </p>
        </div>

        {/* JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ImageGallery',
              name: album.title,
              description: album.description,
              numberOfItems: album.photo_count,
            }),
          }}
        />

        <JustifiedGallery photos={album.photos || []} />
      </main>

      <Footer />
    </>
  );
}
