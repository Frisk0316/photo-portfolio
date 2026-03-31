'use client';

import { useState } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { photos as photosApi } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import type { Photo } from '@/lib/api';

function SortablePhoto({ photo, selected, onSelect, onEditCaption }: {
  photo: Photo;
  selected: boolean;
  onSelect: (id: number) => void;
  onEditCaption: (photo: Photo) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: photo.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <div
        className={`relative aspect-square overflow-hidden rounded cursor-pointer ${selected ? 'ring-2 ring-white' : ''}`}
        onClick={() => onSelect(photo.id)}
      >
        <img
          src={photo.url_thumbnail}
          alt={photo.caption || photo.file_name}
          className="w-full h-full object-cover"
        />
        {selected && (
          <div className="absolute inset-0 bg-white/20 flex items-center justify-center">
            <span className="text-white text-xl">✓</span>
          </div>
        )}
      </div>

      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          {...attributes} {...listeners}
          className="w-6 h-6 rounded bg-black/60 text-white/60 text-xs flex items-center justify-center cursor-grab"
        >
          ⠿
        </button>
        <button
          onClick={() => onEditCaption(photo)}
          className="w-6 h-6 rounded bg-black/60 text-white/60 text-xs flex items-center justify-center"
        >
          ✎
        </button>
      </div>

      {photo.caption && (
        <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
          {photo.caption}
        </p>
      )}
    </div>
  );
}

interface PhotoGridProps {
  albumId: number;
  photos: Photo[];
  onChange: (photos: Photo[]) => void;
}

export default function PhotoGrid({ albumId, photos, onChange }: PhotoGridProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [caption, setCaption] = useState('');
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number } | null>(null);
  const { showSuccess, showError } = useToast();

  const sensors = useSensors(useSensor(PointerSensor));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = photos.findIndex((p) => p.id === active.id);
    const newIndex = photos.findIndex((p) => p.id === over.id);
    const reordered = arrayMove(photos, oldIndex, newIndex);
    onChange(reordered);
    await photosApi.reorder(albumId, reordered.map((p, i) => ({ id: p.id, sort_order: i })));
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} photos?`)) return;
    const ids = Array.from(selected);
    const total = ids.length;
    let deleted = 0;
    let failed = 0;
    setDeleteProgress({ current: 0, total });

    for (const id of ids) {
      try {
        await photosApi.delete(id);
        deleted++;
      } catch {
        failed++;
      }
      setDeleteProgress({ current: deleted + failed, total });
    }

    setDeleteProgress(null);
    onChange(photos.filter((p) => !selected.has(p.id)));
    setSelected(new Set());

    if (failed === 0) {
      showSuccess(`已刪除 ${deleted} 張照片`);
    } else {
      showError(`已刪除 ${deleted} 張，${failed} 張失敗`);
    }
  }

  function openEditCaption(photo: Photo) {
    setEditingPhoto(photo);
    setCaption(photo.caption || '');
  }

  async function saveCaption() {
    if (!editingPhoto) return;
    const updated = await photosApi.update(editingPhoto.id, { caption });
    onChange(photos.map((p) => p.id === editingPhoto.id ? updated.data : p));
    setEditingPhoto(null);
  }

  return (
    <div>
      {deleteProgress && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Deleting {deleteProgress.current} / {deleteProgress.total}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {Math.round((deleteProgress.current / deleteProgress.total) * 100)}%
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${(deleteProgress.current / deleteProgress.total) * 100}%`,
                background: 'var(--accent, rgba(255,255,255,0.7))',
              }}
            />
          </div>
        </div>
      )}

      {!deleteProgress && (
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          {selected.size === 0 ? (
            <button
              onClick={() => setSelected(new Set(photos.map((p) => p.id)))}
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Select All ({photos.length})
            </button>
          ) : (
            <>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{selected.size} / {photos.length} selected</span>
              <button
                onClick={() => setSelected(new Set(photos.map((p) => p.id)))}
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Select All
              </button>
              <button onClick={handleBulkDelete} className="text-xs text-red-400 hover:text-red-300">
                Delete selected
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Clear
              </button>
            </>
          )}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {photos.map((photo) => (
              <SortablePhoto
                key={photo.id}
                photo={photo}
                selected={selected.has(photo.id)}
                onSelect={toggleSelect}
                onEditCaption={openEditCaption}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Caption modal */}
      {editingPhoto && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="rounded p-6 w-full max-w-sm" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Edit caption</h3>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded text-sm outline-none mb-4"
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
            <div className="flex gap-2">
              <button onClick={saveCaption} className="px-4 py-2 rounded text-sm" style={{ background: 'var(--accent)', color: '#0a0a0a' }}>
                Save
              </button>
              <button onClick={() => setEditingPhoto(null)} className="px-4 py-2 rounded text-sm" style={{ color: 'var(--text-secondary)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
