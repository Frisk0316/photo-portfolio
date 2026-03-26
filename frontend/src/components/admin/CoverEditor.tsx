'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Photo } from '@/lib/api';

interface CoverCropData {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

interface CoverEditorProps {
  photos: Photo[];
  coverPhotoId: number | null;
  coverCropData: CoverCropData | null;
  onSave: (coverPhotoId: number, cropData: CoverCropData) => Promise<void>;
}

const DEFAULT_CROP: CoverCropData = { offsetX: 0, offsetY: 0, zoom: 1 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.01;

export default function CoverEditor({ photos, coverPhotoId, coverCropData, onSave }: CoverEditorProps) {
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(coverPhotoId);
  const [crop, setCrop] = useState<CoverCropData>(coverCropData || DEFAULT_CROP);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const previewRef = useRef<HTMLDivElement>(null);

  const selectedPhoto = photos.find((p) => p.id === selectedPhotoId);

  // Reset crop when selecting a different photo
  function handleSelectPhoto(photoId: number) {
    if (photoId === selectedPhotoId) return;
    setSelectedPhotoId(photoId);
    setCrop(photoId === coverPhotoId && coverCropData ? coverCropData : DEFAULT_CROP);
  }

  // Clamp offset so image never reveals empty space
  const clampOffset = useCallback((ox: number, oy: number, zoom: number, photo: Photo) => {
    // Preview is 4:3 aspect, image is photo.width x photo.height
    // At zoom=1 the image fills the preview (object-cover behavior)
    // We need to figure out the effective scale
    const previewAspect = 4 / 3;
    const photoAspect = photo.width / photo.height;

    let maxOffsetX = 0;
    let maxOffsetY = 0;

    if (photoAspect > previewAspect) {
      // Image is wider than preview — horizontal overflow
      // At zoom=1, image height matches preview height, so:
      // visibleWidthRatio = previewAspect / photoAspect
      const visibleWidthRatio = previewAspect / photoAspect;
      maxOffsetX = ((1 - visibleWidthRatio / zoom) / 2) * 100;
      maxOffsetY = ((1 - 1 / zoom) / 2) * 100;
    } else {
      // Image is taller than preview — vertical overflow
      const visibleHeightRatio = photoAspect / previewAspect;
      maxOffsetX = ((1 - 1 / zoom) / 2) * 100;
      maxOffsetY = ((1 - visibleHeightRatio / zoom) / 2) * 100;
    }

    return {
      offsetX: Math.max(-maxOffsetX, Math.min(maxOffsetX, ox)),
      offsetY: Math.max(-maxOffsetY, Math.min(maxOffsetY, oy)),
    };
  }, []);

  function handleZoomChange(newZoom: number) {
    if (!selectedPhoto) return;
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    const clamped = clampOffset(crop.offsetX, crop.offsetY, z, selectedPhoto);
    setCrop({ ...clamped, zoom: z });
  }

  // Mouse/touch drag
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragOffset({ x: crop.offsetX, y: crop.offsetY });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [crop.offsetX, crop.offsetY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !selectedPhoto || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const dx = ((e.clientX - dragStart.x) / rect.width) * 100;
    const dy = ((e.clientY - dragStart.y) / rect.height) * 100;
    const clamped = clampOffset(dragOffset.x + dx, dragOffset.y + dy, crop.zoom, selectedPhoto);
    setCrop((prev) => ({ ...prev, ...clamped }));
  }, [dragging, dragStart, dragOffset, crop.zoom, selectedPhoto, clampOffset]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Reset
  function handleReset() {
    setCrop(DEFAULT_CROP);
  }

  async function handleSave() {
    if (!selectedPhotoId) return;
    setSaving(true);
    try {
      await onSave(selectedPhotoId, crop);
    } finally {
      setSaving(false);
    }
  }

  const hasChanges = selectedPhotoId !== coverPhotoId ||
    crop.offsetX !== (coverCropData?.offsetX ?? 0) ||
    crop.offsetY !== (coverCropData?.offsetY ?? 0) ||
    crop.zoom !== (coverCropData?.zoom ?? 1);

  const imageStyle: React.CSSProperties = selectedPhoto ? {
    transform: `translate(${crop.offsetX}%, ${crop.offsetY}%) scale(${crop.zoom})`,
    transition: dragging ? 'none' : 'transform 0.15s ease-out',
  } : {};

  return (
    <div className="space-y-4">
      {/* Preview area */}
      <div className="flex flex-col items-center gap-3">
        <div
          ref={previewRef}
          className="aspect-[4/3] w-full max-w-md overflow-hidden rounded relative select-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', cursor: dragging ? 'grabbing' : 'grab' }}
          onPointerDown={selectedPhoto ? handlePointerDown : undefined}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {selectedPhoto ? (
            <img
              src={selectedPhoto.url_medium || selectedPhoto.url_thumbnail}
              alt="Cover preview"
              className="w-full h-full object-cover pointer-events-none"
              style={imageStyle}
              draggable={false}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm"
              style={{ color: 'var(--text-tertiary)' }}>
              Select a photo as cover
            </div>
          )}
        </div>

        {/* Zoom controls */}
        {selectedPhoto && (
          <div className="flex items-center gap-3 w-full max-w-md">
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
