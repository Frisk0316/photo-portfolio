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
    await photosApi.bulkDelete(Array.from(selected));
    onChange(photos.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
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
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{selected.size} selected</span>
          <button onClick={handleBulkDelete} className="text-xs text-red-400 hover:text-red-300">
            Delete selected
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Clear
          </button>
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
