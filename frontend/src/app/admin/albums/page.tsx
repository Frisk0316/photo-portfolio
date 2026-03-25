'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { albums } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import type { Album } from '@/lib/api';

function SortableAlbumRow({ album, onTogglePublish, onDelete }: {
  album: Album;
  onTogglePublish: (id: number, val: boolean) => void;
  onDelete: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: album.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <tr ref={setNodeRef} style={style}>
      <td className="py-3 px-4 w-8">
        <button {...attributes} {...listeners} className="cursor-grab text-white/20 hover:text-white/50">
          ⠿
        </button>
      </td>
      <td className="py-3 px-4">
        {album.cover_url && (
          <img src={album.cover_url} alt="" className="w-12 h-8 object-cover rounded" />
        )}
      </td>
      <td className="py-3 px-4 text-sm">{album.title}</td>
      <td className="py-3 px-4 text-xs font-mono" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
        {formatDate(album.shot_date)}
      </td>
      <td className="py-3 px-4 text-xs font-mono" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
        {album.photo_count}
      </td>
      <td className="py-3 px-4">
        <button
          onClick={() => onTogglePublish(album.id, !album.is_published)}
          className={`text-xs px-2 py-1 rounded ${album.is_published ? 'bg-green-900/40 text-green-400' : 'bg-white/5 text-white/30'}`}
        >
          {album.is_published ? 'Published' : 'Draft'}
        </button>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <Link href={`/admin/albums/${album.id}`} className="text-xs text-white/40 hover:text-white">Edit</Link>
          <button onClick={() => onDelete(album.id)} className="text-xs text-red-400/50 hover:text-red-400">Delete</button>
        </div>
      </td>
    </tr>
  );
}

export default function AdminAlbumsPage() {
  const [albumList, setAlbumList] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(useSensor(PointerSensor));

  useEffect(() => {
    albums.list(true).then((r) => setAlbumList(r.data)).finally(() => setLoading(false));
  }, []);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = albumList.findIndex((a) => a.id === active.id);
    const newIndex = albumList.findIndex((a) => a.id === over.id);
    const reordered = arrayMove(albumList, oldIndex, newIndex);
    setAlbumList(reordered);
    await albums.reorder(reordered.map((a, i) => ({ id: a.id, sort_order: i })));
  }

  async function handleTogglePublish(id: number, val: boolean) {
    await albums.update(id, { is_published: val });
    setAlbumList((prev) => prev.map((a) => a.id === id ? { ...a, is_published: val } : a));
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this album and all its photos?')) return;
    await albums.delete(id);
    setAlbumList((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl" style={{ fontFamily: 'var(--font-playfair)' }}>Albums</h1>
        <Link href="/admin/albums/new"
          className="px-4 py-2 rounded text-sm"
          style={{ background: 'var(--accent)', color: '#0a0a0a' }}>
          + New Album
        </Link>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                <th className="py-3 px-4 text-left text-xs w-8" style={{ color: 'var(--text-tertiary)' }}></th>
                <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>Cover</th>
                <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>Title</th>
                <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>Date</th>
                <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>Photos</th>
                <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>Status</th>
                <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>Actions</th>
              </tr>
            </thead>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={albumList.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {albumList.map((album) => (
                    <SortableAlbumRow
                      key={album.id}
                      album={album}
                      onTogglePublish={handleTogglePublish}
                      onDelete={handleDelete}
                    />
                  ))}
                </tbody>
              </SortableContext>
            </DndContext>
          </table>
        </div>
      )}
    </div>
  );
}
