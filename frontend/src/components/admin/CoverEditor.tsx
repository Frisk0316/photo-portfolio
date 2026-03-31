'use client';

import { useState, useRef, useCallback } from 'react';
import { COVER_ASPECT_OPTIONS, coverAspectStyle, coverMobileAspectStyle } from '@/lib/utils';
import type { Photo } from '@/lib/api';

export interface CoverCropData {
  offsetX: number; // range [-1, 1], 0 = centered
  offsetY: number; // range [-1, 1], 0 = centered
  zoom: number;    // >= 1
}

interface CoverEditorProps {
  photos: Photo[];
  coverPhotoId: number | null;
  coverCropData: CoverCropData | null;
  coverAspectRatio?: string;
  onSave: (coverPhotoId: number, cropData: CoverCropData, aspectRatio: string) => Promise<void>;
}

const DEFAULT_CROP: CoverCropData = { offsetX: 0, offsetY: 0, zoom: 1 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.01;

export default function CoverEditor({ photos, coverPhotoId, coverCropData, coverAspectRatio, onSave }: CoverEditorProps) {
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(coverPhotoId);
  const [crop, setCrop] = useState<CoverCropData>(coverCropData || DEFAULT_CROP);
  const [aspectRatio, setAspectRatio] = useState<string>(coverAspectRatio || '4:3');
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragCropStart, setDragCropStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedPhoto = photos.find((p) => p.id === selectedPhotoId);

  function handleSelectPhoto(photoId: number) {
    if (photoId === selectedPhotoId) return;
    setSelectedPhotoId(photoId);
    setCrop(photoId === coverPhotoId && coverCropData ? coverCropData : DEFAULT_CROP);
  }

  function clampOffset(ox: number, oy: number) {
    return {
      offsetX: Math.max(-1, Math.min(1, ox)),
      offsetY: Math.max(-1, Math.min(1, oy)),
    };
  }

  function handleZoomChange(newZoom: number) {
    if (!selectedPhoto) return;
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    const clamped = clampOffset(crop.offsetX, crop.offsetY);
    setCrop({ ...clamped, zoom: z });
  }

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragCropStart({ x: crop.offsetX, y: crop.offsetY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [crop.offsetX, crop.offsetY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !selectedPhoto || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    const sensitivity = Math.max(rect.width, rect.height) * crop.zoom * 0.5;

    const dx = -(e.clientX - dragStart.x) / sensitivity;
    const dy = -(e.clientY - dragStart.y) / sensitivity;

    const clamped = clampOffset(dragCropStart.x + dx, dragCropStart.y + dy);
    setCrop((prev) => ({ ...prev, ...clamped }));
  }, [dragging, dragStart, dragCropStart, crop.zoom, selectedPhoto]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  function handleReset() {
    setCrop(DEFAULT_CROP);
  }

  async function handleSave() {
    if (!selectedPhotoId) return;
    setSaving(true);
    try {
      await onSave(selectedPhotoId, crop, aspectRatio);
    } finally {
      setSaving(false);
    }
  }

  const hasChanges = selectedPhotoId !== coverPhotoId ||
    crop.offsetX !== (coverCropData?.offsetX ?? 0) ||
    crop.offsetY !== (coverCropData?.offsetY ?? 0) ||
    crop.zoom !== (coverCropData?.zoom ?? 1) ||
    aspectRatio !== (coverAspectRatio || '4:3');

  // Convert offset to CSS object-position & transform
  const posX = 50 + crop.offsetX * 50;
  const posY = 50 + crop.offsetY * 50;

  const imageStyle: React.CSSProperties = {
    objectPosition: `${posX}% ${posY}%`,
    transform: `scale(${crop.zoom})`,
    transformOrigin: `${posX}% ${posY}%`,
    transition: dragging ? 'none' : 'all 0.15s ease-out',
    pointerEvents: 'none' as const,
  };

  return (
    <div className="space-y-4">
      {/* Aspect ratio selector */}
      <div>
        <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
          Cover aspect ratio
        </p>
        <div className="flex gap-2 flex-wrap">
          {COVER_ASPECT_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setAspectRatio(opt)}
              className="px-3 py-1 rounded text-xs transition-all"
              style={{
                background: aspectRatio === opt ? 'var(--accent)' : 'var(--bg-elevated)',
                color: aspectRatio === opt ? '#0a0a0a' : 'var(--text-secondary)',
                border: `1px solid ${aspectRatio === opt ? 'var(--accent)' : 'var(--border)'}`,
                fontFamily: 'var(--font-dm-mono)',
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop & Mobile preview */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-4 w-full max-w-2xl">
          {/* Desktop preview */}
          <div className="flex-1 min-w-0">
            <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
              Desktop
            </p>
            <div
              ref={containerRef}
              className="w-full overflow-hidden rounded relative select-none"
              style={{
                aspectRatio: coverAspectStyle(aspectRatio),
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                cursor: selectedPhoto ? (dragging ? 'grabbing' : 'grab') : 'default',
              }}
              onPointerDown={selectedPhoto ? handlePointerDown : undefined}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {selectedPhoto ? (
                <img
                  src={selectedPhoto.url_medium || selectedPhoto.url_thumbnail}
                  alt="Cover preview"
                  className="w-full h-full object-cover"
                  style={imageStyle}
                  draggable={false}
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (img.src !== selectedPhoto.url_thumbnail) {
                      img.src = selectedPhoto.url_thumbnail;
                    }
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm"
                  style={{ color: 'var(--text-tertiary)' }}>
                  Select a photo as cover
                </div>
              )}
            </div>
          </div>

          {/* Mobile preview */}
          <div className="w-24 shrink-0">
            <p className="text-xs mb-1.5" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
              Mobile
            </p>
            <div
              className="w-full overflow-hidden rounded relative"
              style={{
                aspectRatio: coverMobileAspectStyle(aspectRatio),
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
              }}
            >
              {selectedPhoto ? (
                <img
                  src={selectedPhoto.url_small || selectedPhoto.url_thumbnail}
                  alt="Mobile preview"
                  className="w-full h-full object-cover"
                  style={{
                    objectPosition: `${posX}% ${posY}%`,
                    transform: `scale(${crop.zoom})`,
                    transformOrigin: `${posX}% ${posY}%`,
                    pointerEvents: 'none' as const,
                  }}
                  draggable={false}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px]"
                  style={{ color: 'var(--text-tertiary)' }}>
                  —
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Zoom controls */}
        {selectedPhoto && (
          <div className="flex items-center gap-3 w-full max-w-2xl">
            <button
              type="button"
              onClick={() => handleZoomChange(crop.zoom - 0.1)}
              className="p-1 rounded text-lg leading-none"
              style={{ color: 'var(--text-secondary)' }}
              title="Zoom out"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={crop.zoom}
              onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
              className="flex-1 accent-white h-1"
            />
            <button
              type="button"
              onClick={() => handleZoomChange(crop.zoom + 0.1)}
              className="p-1 rounded text-lg leading-none"
              style={{ color: 'var(--text-secondary)' }}
              title="Zoom in"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
          </div>
        )}

        {/* Action buttons */}
        {selectedPhoto && (
          <div className="flex items-center gap-3 text-xs">
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
              className="px-4 py-1.5 rounded font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#0a0a0a' }}
            >
              {saving ? 'Saving...' : 'Save Cover'}
            </button>
          </div>
        )}
      </div>

      {/* Photo selector grid */}
      <div>
        <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
          Select cover photo
        </p>
        <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-1.5 max-h-48 overflow-y-auto p-1 rounded"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => handleSelectPhoto(photo.id)}
              className="aspect-square overflow-hidden rounded transition-all"
              style={{
                outline: photo.id === selectedPhotoId ? '2px solid var(--accent)' : '2px solid transparent',
                outlineOffset: '-2px',
                opacity: photo.id === selectedPhotoId ? 1 : 0.6,
              }}
            >
              <img
                src={photo.url_thumbnail}
                alt={photo.file_name}
                className="w-full h-full object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
