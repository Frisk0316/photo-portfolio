'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

/* ── Sortable thumbnail card ── */
function SortableHeroCard({ img, index, onRemove, onPreview }: {
  img: HeroImage;
  index: number;
  onRemove: (id: number) => void;
  onPreview: (img: HeroImage) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto' as string | number,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group flex flex-col items-center">
      {/* Order badge */}
      <span
        className="absolute -top-2 -left-2 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono"
        style={{ background: 'var(--accent)', color: '#0a0a0a' }}
      >
        {index + 1}
      </span>

      {/* Drag handle + image */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing rounded overflow-hidden"
        style={{ border: '2px solid transparent', outline: isDragging ? '2px solid var(--accent)' : 'none' }}
      >
        <img
          src={img.url_medium || img.url_original}
          alt={img.album_title}
          className="w-36 h-24 object-cover"
          draggable={false}
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onPreview(img)}
          className="text-[10px] px-2 py-0.5 rounded"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          title="Preview"
        >
          Preview
        </button>
        <button
          onClick={() => onRemove(img.id)}
          className="text-[10px] px-2 py-0.5 rounded text-red-400/70 hover:text-red-400"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          title="Remove"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/* ── Preview modal with desktop + mobile frames ── */
function PreviewModal({ img, onClose }: { img: HeroImage; onClose: () => void }) {
  const src = img.url_medium || img.url_original;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="max-w-5xl w-full space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-dm-mono)' }}>
            Preview — {img.album_title}
          </p>
          <button onClick={onClose} className="text-white/50 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="flex gap-6 items-start justify-center">
          {/* Desktop preview */}
          <div className="flex-1 min-w-0">
            <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
              Desktop (16:9)
            </p>
            <div
              className="w-full rounded overflow-hidden relative"
              style={{ aspectRatio: '16/9', background: 'var(--bg-elevated)', border: '2px solid var(--border)' }}
            >
              <img src={src} alt="Desktop preview" className="w-full h-full object-cover" />
              {/* Simulate gradient overlay like real carousel */}
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.55) 100%)' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-white text-2xl" style={{ fontFamily: 'var(--font-playfair)' }}>Ospreay Photo</span>
              </div>
            </div>
          </div>

          {/* Mobile preview */}
          <div className="w-32 shrink-0">
            <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
              Mobile (9:16)
            </p>
            <div
              className="w-full rounded-lg overflow-hidden relative"
              style={{ aspectRatio: '9/16', background: 'var(--bg-elevated)', border: '2px solid var(--border)' }}
            >
              <img src={src} alt="Mobile preview" className="w-full h-full object-cover" />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.55) 100%)' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-white text-sm" style={{ fontFamily: 'var(--font-playfair)' }}>Ospreay Photo</span>
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
          Images use <code className="text-white/50">object-cover</code> — the visible area depends on the photo's aspect ratio and the screen size.
        </p>
      </div>
    </div>
  );
}

/* ── Main page ── */
export default function AdminHeroPage() {
  const [heroList, setHeroList] = useState<HeroImage[]>([]);
  const [albumList, setAlbumList] = useState<Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<Photo[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewImg, setPreviewImg] = useState<HeroImage | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

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
    await heroImages.add(photoId);
    await heroImages.list().then(r => setHeroList(r.data));
  }

  async function removeFromHero(id: number) {
    await heroImages.remove(id);
    setHeroList(prev => prev.filter(h => h.id !== id));
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = heroList.findIndex(h => h.id === active.id);
    const newIndex = heroList.findIndex(h => h.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(heroList, oldIndex, newIndex);
    setHeroList(reordered);

    // Persist new order
    const items = reordered.map((h, i) => ({ id: h.id, sort_order: i }));
    try {
      await heroImages.reorder(items);
    } catch {
      // Rollback on error
      const r = await heroImages.list();
      setHeroList(r.data);
    }
  }, [heroList]);

  return (
    <div className="p-6">
      <h1 className="text-xl mb-2" style={{ fontFamily: 'var(--font-playfair)' }}>Hero Carousel</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
        Select photos to display in the homepage carousel. Drag to reorder, click Preview to check viewport fit.
      </p>

      {/* Current hero images — sortable */}
      <section className="mb-10">
        <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
          Current carousel ({heroList.length} images)
        </h2>
        {heroList.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No images yet. Add some below.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={heroList.map(h => h.id)} strategy={rectSortingStrategy}>
              <div className="flex gap-4 flex-wrap">
                {heroList.map((img, i) => (
                  <SortableHeroCard
                    key={img.id}
                    img={img}
                    index={i}
                    onRemove={removeFromHero}
                    onPreview={setPreviewImg}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {/* Album picker */}
      <section>
        <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
          Add from album
        </h2>

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

      {/* Preview modal */}
      {previewImg && (
        <PreviewModal img={previewImg} onClose={() => setPreviewImg(null)} />
      )}
    </div>
  );
}
