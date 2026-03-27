'use client';

import { useState, useEffect } from 'react';
import { heroImages, albums } from '@/lib/api';
import type { HeroImage, Album, Photo } from '@/lib/api';

const API_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:4000'
  : '';

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_token');
}

async function getAlbumPhotos(slug: string): Promise<Photo[]> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/albums/${slug}`, { headers });
  if (!res.ok) return [];
  const json = await res.json();
  return json.data?.photos || [];
}

export default function AdminHeroPage() {
  const [heroList, setHeroList] = useState<HeroImage[]>([]);
  const [albumList, setAlbumList] = useState<Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<Photo[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      heroImages.list(),
      albums.list(true),
    ])
      .then(([h, a]) => {
        setHeroList(h.data);
        setAlbumList(a.data);
      })
      .finally(() => setLoading(false));
  }, []);

  async function loadAlbumPhotos(album: Album) {
    setSelectedAlbum(album);
    setLoadingPhotos(true);
    const photos = await getAlbumPhotos(album.slug);
    setAlbumPhotos(photos);
    setLoadingPhotos(false);
  }

  async function addToHero(photoId: number) {
    const already = heroList.some(h => h.photo_id === photoId);
    if (already) return;
    const res = await heroImages.add(photoId);
    await heroImages.list().then(r => setHeroList(r.data));
  }

  async function removeFromHero(id: number) {
    await heroImages.remove(id);
    setHeroList(prev => prev.filter(h => h.id !== id));
  }

  return (
    <div className="p-6">
      <h1 className="text-xl mb-2" style={{ fontFamily: 'var(--font-playfair)' }}>Hero Carousel</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
        Select photos to display in the homepage carousel. Pick from any album.
      </p>

      {/* Current hero images */}
      <section className="mb-10">
        <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
          Current carousel ({heroList.length} images)
        </h2>
        {heroList.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No images yet. Add some below.</p>
        ) : (
          <div className="flex gap-3 flex-wrap">
            {heroList.map((img) => (
              <div key={img.id} className="relative group">
                <img
                  src={img.url_medium || img.url_original}
                  alt={img.album_title}
                  className="w-36 h-24 object-cover rounded"
                />
                <button
                  onClick={() => removeFromHero(img.id)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Album picker */}
      <section>
        <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
          Add from album
        </h2>

        {/* Album list */}
        <div className="flex gap-2 flex-wrap mb-6">
          {albumList.map(album => (
            <button
              key={album.id}
              onClick={() => loadAlbumPhotos(album)}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                selectedAlbum?.id === album.id
                  ? 'bg-white/15 text-white'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
              style={{ border: '1px solid var(--border)' }}
            >
              {album.title}
            </button>
          ))}
        </div>

        {/* Photos grid */}
        {selectedAlbum && (
          <div>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              {selectedAlbum.title} — click a photo to add to carousel
            </p>
            {loadingPhotos ? (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading photos...</p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                {albumPhotos.map(photo => {
                  const inHero = heroList.some(h => h.photo_id === photo.id);
                  return (
                    <button
                      key={photo.id}
                      onClick={() => addToHero(photo.id)}
                      disabled={inHero}
                      className="relative group aspect-square overflow-hidden rounded"
                      title={inHero ? 'Already in carousel' : 'Add to carousel'}
                    >
                      <img
                        src={photo.url_thumbnail}
                        alt={photo.file_name}
                        className="w-full h-full object-cover"
                      />
                      {inHero ? (
                        <div className="absolute inset-0 bg-green-500/30 flex items-center justify-center">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      ) : (
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                          <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="16" />
                            <line x1="8" y1="12" x2="16" y2="12" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
