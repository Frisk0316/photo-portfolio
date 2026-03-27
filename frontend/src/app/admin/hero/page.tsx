'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { heroImages, albums } from '@/lib/api';
import type { HeroImage, HeroCropData, Album, Photo } from '@/lib/api';

const API_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:4000'
  : '';

const DEFAULT_CROP: HeroCropData = { offsetX: 0, offsetY: 0, zoom: 1 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

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

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function cropToStyle(crop: HeroCropData | null): React.CSSProperties {
  const c = crop || DEFAULT_CROP;
  const posX = 50 + c.offsetX * 50;
  const posY = 50 + c.offsetY * 50;
  return {
    objectPosition: `${posX}% ${posY}%`,
    transform: `scale(${c.zoom})`,
    transformOrigin: `${posX}% ${posY}%`,
  };
}

/* ── Draggable crop viewport ── */
function CropViewport({ label, ratio, crop, onChange, src, overlayTitle }: {
  label: string;
  ratio: string;
  crop: HeroCropData;
  onChange: (c: HeroCropData) => void;
  src: string;
  overlayTitle?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragCropStart = useRef({ x: 0, y: 0 });

  const posX = 50 + crop.offsetX * 50;
  const posY = 50 + crop.offsetY * 50;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragCropStart.current = { x: crop.offsetX, y: crop.offsetY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [crop.offsetX, crop.offsetY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const sensitivity = Math.max(rect.width, rect.height) * crop.zoom * 0.5;
    const dx = -(e.clientX - dragStart.current.x) / sensitivity;
    const dy = -(e.clientY - dragStart.current.y) / sensitivity;
    onChange({
      ...crop,
      offsetX: clamp(dragCropStart.current.x + dx, -1, 1),
      offsetY: clamp(dragCropStart.current.y + dy, -1, 1),
    });
  }, [dragging, crop, onChange]);

  const handlePointerUp = useCallback(() => setDragging(false), []);

  return (
    <div>
      <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
        {label}
      </p>
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded relative select-none"
        style={{
          aspectRatio: ratio,
          background: 'var(--bg-elevated)',
          border: '2px solid var(--border)',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <img
          src={src}
          alt={label}
          className="w-full h-full object-cover"
          style={{
            objectPosition: `${posX}% ${posY}%`,
            transform: `scale(${crop.zoom})`,
            transformOrigin: `${posX}% ${posY}%`,
            transition: dragging ? 'none' : 'all 0.15s ease-out',
            pointerEvents: 'none',
          }}
          draggable={false}
        />
        {/* Gradient overlay simulation */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.55) 100%)' }} />
        {overlayTitle && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-white" style={{ fontFamily: 'var(--font-playfair)', fontSize: ratio === '9/16' ? '14px' : '24px' }}>
              {overlayTitle}
            </span>
          </div>
        )}
      </div>
      {/* Zoom slider */}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>−</span>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={crop.zoom}
          onChange={(e) => onChange({ ...crop, zoom: parseFloat(e.target.value) })}
          className="flex-1 accent-white h-1"
        />
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>+</span>
      </div>
    </div>
  );
}

/* ── Crop editor modal ── */
function CropEditorModal({ img, onClose, onSaved }: {
  img: HeroImage;
  onClose: () => void;
  onSaved: (updated: HeroImage) => void;
}) {
  const src = img.url_medium || img.url_original;
  const [desktopCrop, setDesktopCrop] = useState<HeroCropData>(img.crop_desktop || DEFAULT_CROP);
  const [mobileCrop, setMobileCrop] = useState<HeroCropData>(img.crop_mobile || DEFAULT_CROP);
  const [saving, setSaving] = useState(false);

  const hasChanges =
    JSON.stringify(desktopCrop) !== JSON.stringify(img.crop_desktop || DEFAULT_CROP) ||
    JSON.stringify(mobileCrop) !== JSON.stringify(img.crop_mobile || DEFAULT_CROP);

  async function handleSave() {
    setSaving(true);
    try {
      await heroImages.updateCrop(img.id, desktopCrop, mobileCrop);
      onSaved({ ...img, crop_desktop: desktopCrop, crop_mobile: mobileCrop });
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setDesktopCrop(DEFAULT_CROP);
    setMobileCrop(DEFAULT_CROP);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 sm:p-6" onClick={onClose}>
      <div
        className="max-w-5xl w-full space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-dm-mono)' }}>
            Crop & Position — {img.album_title}
          </p>
          <button onClick={onClose} className="text-white/50 hover:text-white text-xl leading-none">×</button>
        </div>

        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Drag to pan, use slider to zoom. Desktop and mobile can be set independently.
        </p>

        {/* Two crop viewports side by side */}
        <div className="flex gap-6 items-start">
          {/* Desktop */}
          <div className="flex-1 min-w-0">
            <CropViewport
              label="Desktop (16:9)"
              ratio="16/9"
              crop={desktopCrop}
              onChange={setDesktopCrop}
              src={src}
              overlayTitle="Ospreay Photo"
            />
          </div>
          {/* Mobile */}
          <div className="w-36 shrink-0">
            <CropViewport
              label="Mobile (9:19.5)"
              ratio="9/19.5"
              crop={mobileCrop}
              onChange={setMobileCrop}
              src={src}
              overlayTitle="Ospreay Photo"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-center gap-3 text-xs">
          <button
            type="button"
            onClick={handleReset}
            style={{ color: 'var(--text-tertiary)' }}
            className="hover:underline"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="px-5 py-1.5 rounded font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#0a0a0a' }}
          >
            {saving ? 'Saving...' : 'Save Crop'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Sortable thumbnail card ── */
function SortableHeroCard({ img, index, onRemove, onEdit }: {
  img: HeroImage;
  index: number;
  onRemove: (id: number) => void;
  onEdit: (img: HeroImage) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto' as string | number,
  };

  const hasCrop = img.crop_desktop || img.crop_mobile;

  return (
    <div ref={setNodeRef} style={style} className="relative group flex flex-col items-center">
      {/* Order badge */}
      <span
        className="absolute -top-2 -left-2 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono"
        style={{ background: 'var(--accent)', color: '#0a0a0a' }}
      >
        {index + 1}
      </span>

      {/* Crop indicator */}
      {hasCrop && (
        <span
          className="absolute -top-2 -right-2 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          title="Has custom crop"
        >
          ✂
        </span>
      )}

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
          onClick={() => onEdit(img)}
          className="text-[10px] px-2 py-0.5 rounded"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          Crop
        </button>
        <button
          onClick={() => onRemove(img.id)}
          className="text-[10px] px-2 py-0.5 rounded text-red-400/70 hover:text-red-400"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          ×
        </button>
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
  const [editingImg, setEditingImg] = useState<HeroImage | null>(null);

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

  function handleCropSaved(updated: HeroImage) {
    setHeroList(prev => prev.map(h => h.id === updated.id ? updated : h));
    setEditingImg(null);
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = heroList.findIndex(h => h.id === active.id);
    const newIndex = heroList.findIndex(h => h.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(heroList, oldIndex, newIndex);
    setHeroList(reordered);

    const items = reordered.map((h, i) => ({ id: h.id, sort_order: i }));
    try {
      await heroImages.reorder(items);
    } catch {
      const r = await heroImages.list();
      setHeroList(r.data);
    }
  }, [heroList]);

  return (
    <div className="p-6">
      <h1 className="text-xl mb-2" style={{ fontFamily: 'var(--font-playfair)' }}>Hero Carousel</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
        Drag to reorder. Click Crop to adjust position and zoom for desktop and mobile.
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
                    onEdit={setEditingImg}
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

      {/* Crop editor modal */}
      {editingImg && (
        <CropEditorModal
          img={editingImg}
          onClose={() => setEditingImg(null)}
          onSaved={handleCropSaved}
        />
      )}
    </div>
  );
}
