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

/* ── Draggable crop viewport ── */
function CropViewport({ label, ratio, crop, onChange, src, overlaySize }: {
  label: string;
  ratio: string;
  crop: HeroCropData;
  onChange: (c: HeroCropData) => void;
  src: string;
  overlaySize?: string;
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

  return (
    <div>
      <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>{label}</p>
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
        onPointerUp={() => setDragging(false)}
      >
        <img src={src} alt={label} className="w-full h-full object-cover" draggable={false}
          style={{
            objectPosition: `${posX}% ${posY}%`,
            transform: `scale(${crop.zoom})`,
            transformOrigin: `${posX}% ${posY}%`,
            transition: dragging ? 'none' : 'all 0.15s ease-out',
            pointerEvents: 'none',
          }}
        />
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.55) 100%)' }} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-white" style={{ fontFamily: 'var(--font-playfair)', fontSize: overlaySize || '24px' }}>Ospreay Photo</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>−</span>
        <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={crop.zoom}
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
  const isDesktop = img.device !== 'mobile'; // default to desktop if device is missing

  // For desktop images, only show desktop crop; for mobile, only mobile crop
  const initialCrop = isDesktop ? (img.crop_desktop || DEFAULT_CROP) : (img.crop_mobile || DEFAULT_CROP);
  const [crop, setCrop] = useState<HeroCropData>(initialCrop);
  const [saving, setSaving] = useState(false);

  const origCrop = isDesktop ? (img.crop_desktop || DEFAULT_CROP) : (img.crop_mobile || DEFAULT_CROP);
  const hasChanges = JSON.stringify(crop) !== JSON.stringify(origCrop);

  async function handleSave() {
    setSaving(true);
    try {
      const cd = isDesktop ? crop : (img.crop_desktop || null);
      const cm = isDesktop ? (img.crop_mobile || null) : crop;
      await heroImages.updateCrop(img.id, cd, cm);
      onSaved({
        ...img,
        crop_desktop: isDesktop ? crop : img.crop_desktop,
        crop_mobile: isDesktop ? img.crop_mobile : crop,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-3xl w-full space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-dm-mono)' }}>
            Crop — {img.album_title} ({isDesktop ? 'Desktop' : 'Mobile'})
          </p>
          <button onClick={onClose} className="text-white/50 hover:text-white text-xl leading-none">×</button>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Drag to pan, use slider to zoom.
        </p>

        <div className={isDesktop ? 'max-w-2xl mx-auto' : 'max-w-[200px] mx-auto'}>
          <CropViewport
            label={isDesktop ? 'Desktop (16:9)' : 'Mobile (9:19.5)'}
            ratio={isDesktop ? '16/9' : '9/19.5'}
            crop={crop}
            onChange={setCrop}
            src={src}
            overlaySize={isDesktop ? '24px' : '14px'}
          />
        </div>

        <div className="flex items-center justify-center gap-3 text-xs">
          <button onClick={() => setCrop(DEFAULT_CROP)} style={{ color: 'var(--text-tertiary)' }} className="hover:underline">Reset</button>
          <button onClick={handleSave} disabled={saving || !hasChanges}
            className="px-5 py-1.5 rounded font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#0a0a0a' }}>
            {saving ? 'Saving...' : 'Save Crop'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Sortable card ── */
function SortableHeroCard({ img, index, onRemove, onEdit, selectMode, selected, onToggleSelect }: {
  img: HeroImage;
  index: number;
  onRemove: (id: number) => void;
  onEdit: (img: HeroImage) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto' as string | number,
  };
  const hasCrop = img.device !== 'mobile' ? img.crop_desktop : img.crop_mobile;

  return (
    <div ref={setNodeRef} style={style} className="relative group flex flex-col items-center">
      {/* Select checkbox */}
      {selectMode && (
        <button
          onClick={() => onToggleSelect(img.id)}
          className="absolute -top-2 -left-2 z-20 w-5 h-5 rounded flex items-center justify-center text-[10px]"
          style={{
            background: selected ? 'var(--accent)' : 'var(--bg-elevated)',
            border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
            color: selected ? '#0a0a0a' : 'transparent',
          }}
        >
          {selected ? '✓' : ''}
        </button>
      )}
      {/* Order badge (only in non-select mode) */}
      {!selectMode && (
        <span className="absolute -top-2 -left-2 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono"
          style={{ background: 'var(--accent)', color: '#0a0a0a' }}>{index + 1}</span>
      )}
      {hasCrop && !selectMode && (
        <span className="absolute -top-2 -right-2 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }} title="Has custom crop">✂</span>
      )}
      {selectMode ? (
        <div
          className="rounded overflow-hidden cursor-pointer"
          style={{ outline: selected ? '2px solid var(--accent)' : '2px solid transparent' }}
          onClick={() => onToggleSelect(img.id)}
        >
          <img src={img.url_medium || img.url_original} alt={img.album_title}
            className="w-36 h-24 object-cover" draggable={false} />
        </div>
      ) : (
        <>
          <div {...attributes} {...listeners}
            className="cursor-grab active:cursor-grabbing rounded overflow-hidden"
            style={{ outline: isDragging ? '2px solid var(--accent)' : 'none' }}>
            <img src={img.url_medium || img.url_original} alt={img.album_title}
              className="w-36 h-24 object-cover" draggable={false} />
          </div>
          <div className="flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(img)} className="text-[10px] px-2 py-0.5 rounded"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Crop</button>
            <button onClick={() => onRemove(img.id)} className="text-[10px] px-2 py-0.5 rounded text-red-400/70 hover:text-red-400"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>×</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Device carousel section ── */
function DeviceCarouselSection({ device, heroList, setHeroList, albumList, onEdit }: {
  device: 'desktop' | 'mobile';
  heroList: HeroImage[];
  setHeroList: React.Dispatch<React.SetStateAction<HeroImage[]>>;
  albumList: Album[];
  onEdit: (img: HeroImage) => void;
}) {
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<Photo[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const isDesktop = device === 'desktop';
  const label = isDesktop ? 'Desktop (16:9)' : 'Mobile (9:19.5)';
  const icon = isDesktop ? '🖥' : '📱';

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function batchDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selectedIds).map(id => heroImages.remove(id)));
      setHeroList(prev => prev.filter(h => !selectedIds.has(h.id)));
      exitSelectMode();
    } finally {
      setDeleting(false);
    }
  }

  async function loadAlbumPhotos(album: Album) {
    setSelectedAlbum(album);
    setLoadingPhotos(true);
    const photos = await getAlbumPhotos(album.slug);
    setAlbumPhotos(photos);
    setLoadingPhotos(false);
  }

  async function addToHero(photoId: number) {
    if (heroList.some(h => h.photo_id === photoId)) return;
    await heroImages.add(photoId, device);
    const r = await heroImages.list(device);
    setHeroList(r.data);
  }

  async function removeFromHero(id: number) {
    await heroImages.remove(id);
    setHeroList(prev => prev.filter(h => h.id !== id));
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = heroList.findIndex(h => h.id === active.id);
    const newIdx = heroList.findIndex(h => h.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const reordered = arrayMove(heroList, oldIdx, newIdx);
    setHeroList(reordered);
    try {
      await heroImages.reorder(reordered.map((h, i) => ({ id: h.id, sort_order: i })));
    } catch {
      const r = await heroImages.list(device);
      setHeroList(r.data);
    }
  }, [heroList, device, setHeroList]);

  return (
    <section className="mb-12 p-5 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm flex items-center gap-2" style={{ fontFamily: 'var(--font-dm-mono)' }}>
          <span>{icon}</span> {label}
        </h2>
        {heroList.length > 0 && (
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <span className="text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
                  {selectedIds.size} selected
                </span>
                <button onClick={() => { setSelectedIds(new Set(heroList.map(h => h.id))); }}
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                  Select all
                </button>
                <button onClick={batchDelete} disabled={selectedIds.size === 0 || deleting}
                  className="text-[10px] px-2 py-0.5 rounded text-red-400 disabled:opacity-40"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  {deleting ? 'Deleting...' : `Delete (${selectedIds.size})`}
                </button>
                <button onClick={exitSelectMode} className="text-[10px] px-2 py-0.5 rounded"
                  style={{ color: 'var(--text-tertiary)' }}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setSelectMode(true)} className="text-[10px] px-2 py-0.5 rounded"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Select
              </button>
            )}
          </div>
        )}
      </div>
      <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
        {heroList.length} images{!selectMode && ' — drag to reorder, hover for actions'}
      </p>

      {/* Current images */}
      {heroList.length === 0 ? (
        <p className="text-xs mb-6" style={{ color: 'var(--text-tertiary)' }}>No images yet.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={selectMode ? (() => {}) : handleDragEnd}>
          <SortableContext items={heroList.map(h => h.id)} strategy={rectSortingStrategy}>
            <div className="flex gap-4 flex-wrap mb-6">
              {heroList.map((img, i) => (
                <SortableHeroCard key={img.id} img={img} index={i} onRemove={removeFromHero} onEdit={onEdit}
                  selectMode={selectMode} selected={selectedIds.has(img.id)} onToggleSelect={toggleSelect} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Album picker */}
      <div className="pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
          Add from album
        </p>
        <div className="flex gap-2 flex-wrap mb-4">
          {albumList.map(album => (
            <button key={album.id} onClick={() => loadAlbumPhotos(album)}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                selectedAlbum?.id === album.id ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
              style={{ border: '1px solid var(--border)' }}>
              {album.title}
            </button>
          ))}
        </div>

        {selectedAlbum && (
          loadingPhotos ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
              {albumPhotos.map(photo => {
                const inHero = heroList.some(h => h.photo_id === photo.id);
                return (
                  <button key={photo.id} onClick={() => addToHero(photo.id)} disabled={inHero}
                    className="relative group aspect-square overflow-hidden rounded"
                    title={inHero ? 'Already added' : 'Add to carousel'}>
                    <img src={photo.url_thumbnail} alt={photo.file_name} className="w-full h-full object-cover" />
                    {inHero ? (
                      <div className="absolute inset-0 bg-green-500/30 flex items-center justify-center">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                        <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )
        )}
      </div>
    </section>
  );
}

/* ── Main page ── */
export default function AdminHeroPage() {
  const [desktopList, setDesktopList] = useState<HeroImage[]>([]);
  const [mobileList, setMobileList] = useState<HeroImage[]>([]);
  const [albumList, setAlbumList] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingImg, setEditingImg] = useState<HeroImage | null>(null);

  useEffect(() => {
    Promise.all([
      heroImages.list('desktop'),
      heroImages.list('mobile'),
      albums.list(true),
    ])
      .then(([d, m, a]) => {
        setDesktopList(d.data);
        setMobileList(m.data);
        setAlbumList(a.data);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleCropSaved(updated: HeroImage) {
    const setter = updated.device === 'desktop' ? setDesktopList : setMobileList;
    setter(prev => prev.map(h => h.id === updated.id ? updated : h));
    setEditingImg(null);
  }

  if (loading) return <p className="p-6 text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>;

  return (
    <div className="p-6">
      <h1 className="text-xl mb-2" style={{ fontFamily: 'var(--font-playfair)' }}>Hero Carousel</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
        Desktop and mobile carousels are managed independently. Select different photos and crops for each.
      </p>

      <DeviceCarouselSection
        device="desktop"
        heroList={desktopList}
        setHeroList={setDesktopList}
        albumList={albumList}
        onEdit={setEditingImg}
      />

      <DeviceCarouselSection
        device="mobile"
        heroList={mobileList}
        setHeroList={setMobileList}
        albumList={albumList}
        onEdit={setEditingImg}
      />

      {editingImg && (
        <CropEditorModal img={editingImg} onClose={() => setEditingImg(null)} onSaved={handleCropSaved} />
      )}
    </div>
  );
}
