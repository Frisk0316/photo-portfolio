'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { homepageFeatured, albums } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import type { HomepageFeaturedItem, Album } from '@/lib/api';

const MAX_FEATURED = 3;

function SortableFeaturedRow({ item, onRemove }: {
  item: HomepageFeaturedItem;
  onRemove: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
      className="flex items-center gap-3 p-3 rounded"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-white/20 hover:text-white/50 shrink-0"
        style={{ touchAction: 'none' }}
      >
        ⠿
      </button>
      {item.cover_url && (
        <img
          src={item.cover_url}
          alt={item.title}
          className="w-14 h-10 object-cover rounded shrink-0"
          style={{ background: 'var(--bg-surface)' }}
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{item.title}</p>
        {item.shot_date && (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            {item.shot_date.slice(0, 10)}
          </p>
        )}
      </div>
      <button
        onClick={() => onRemove(item.id)}
        className="shrink-0 text-xs text-red-400/60 hover:text-red-400 transition-colors px-2"
      >
        ×
      </button>
    </div>
  );
}

function FeaturedSection({
  section,
  label,
  featured,
  allAlbums,
  onUpdate,
}: {
  section: 'events' | 'other';
  label: string;
  featured: HomepageFeaturedItem[];
  allAlbums: Album[];
  onUpdate: (section: 'events' | 'other', updated: HomepageFeaturedItem[]) => void;
}) {
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>('');
  const { showSuccess, showError } = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Albums eligible for this section (same category section, not already featured)
  const featuredIds = new Set(featured.map(f => f.album_id));
  const eligible = allAlbums.filter(a => {
    const inSection = a.category_section === section;
    return inSection && !featuredIds.has(a.id);
  });

  async function handleAdd() {
    const id = parseInt(selectedAlbumId);
    if (!id) return;
    if (featured.length >= MAX_FEATURED) {
      showError(`最多只能選 ${MAX_FEATURED} 本相簿`);
      return;
    }
    try {
      await homepageFeatured.add(section, id);
      const r = await homepageFeatured.list(section);
      onUpdate(section, r.data);
      setSelectedAlbumId('');
      showSuccess('已加入首頁精選');
    } catch (err) {
      showError(err instanceof Error ? err.message : '加入失敗');
    }
  }

  async function handleRemove(featuredId: number) {
    try {
      await homepageFeatured.remove(featuredId);
      onUpdate(section, featured.filter(f => f.id !== featuredId));
      showSuccess('已移除');
    } catch {
      showError('移除失敗');
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = featured.findIndex(f => f.id === active.id);
    const newIdx = featured.findIndex(f => f.id === over.id);
    const reordered = arrayMove(featured, oldIdx, newIdx);
    onUpdate(section, reordered);
    try {
      await homepageFeatured.reorder(reordered.map((f, i) => ({ id: f.id, sort_order: i })));
    } catch {
      // revert
      const r = await homepageFeatured.list(section);
      onUpdate(section, r.data);
    }
  }

  return (
    <div
      className="flex-1 min-w-0 p-5 rounded-lg"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <h2 className="text-sm mb-1" style={{ fontFamily: 'var(--font-dm-mono)' }}>{label}</h2>
      <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
        {featured.length} / {MAX_FEATURED} 本 — 拖曳可調整順序
      </p>

      {/* Sortable list */}
      {featured.length === 0 ? (
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
          尚未設定精選，首頁將顯示最新 3 本相簿。
        </p>
      ) : (
        <div className="space-y-2 mb-4">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={featured.map(f => f.id)} strategy={verticalListSortingStrategy}>
              {featured.map(item => (
                <SortableFeaturedRow key={item.id} item={item} onRemove={handleRemove} />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Add album */}
      {featured.length < MAX_FEATURED && (
        <div className="flex gap-2 items-center">
          <select
            value={selectedAlbumId}
            onChange={e => setSelectedAlbumId(e.target.value)}
            className="flex-1 px-3 py-2 rounded text-sm outline-none"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              color: selectedAlbumId ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            <option value="">選擇相簿…</option>
            {eligible.map(a => (
              <option key={a.id} value={a.id}>
                {a.title}{a.shot_date ? ` (${a.shot_date.slice(0, 10)})` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!selectedAlbumId}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#0a0a0a' }}
          >
            加入
          </button>
        </div>
      )}

      {featured.length >= MAX_FEATURED && (
        <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
          已達上限（{MAX_FEATURED} 本）。移除後可新增。
        </p>
      )}
    </div>
  );
}

export default function AdminHomepagePage() {
  const [eventsFeatured, setEventsFeatured] = useState<HomepageFeaturedItem[]>([]);
  const [otherFeatured, setOtherFeatured] = useState<HomepageFeaturedItem[]>([]);
  const [allAlbums, setAllAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      homepageFeatured.list('events'),
      homepageFeatured.list('other'),
      albums.list(true),
    ]).then(([ev, ot, al]) => {
      setEventsFeatured(ev.data);
      setOtherFeatured(ot.data);
      setAllAlbums(al.data);
    }).finally(() => setLoading(false));
  }, []);

  const handleUpdate = useCallback((section: 'events' | 'other', updated: HomepageFeaturedItem[]) => {
    if (section === 'events') setEventsFeatured(updated);
    else setOtherFeatured(updated);
  }, []);

  if (loading) return <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-playfair)' }}>首頁精選相簿</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          選擇首頁各區塊顯示的相簿（最多各 3 本）。未設定時自動顯示最新的 3 本。
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <FeaturedSection
          section="events"
          label="活動攝影（Event Photography）"
          featured={eventsFeatured}
          allAlbums={allAlbums}
          onUpdate={handleUpdate}
        />
        <FeaturedSection
          section="other"
          label="攝影作品（Gallery）"
          featured={otherFeatured}
          allAlbums={allAlbums}
          onUpdate={handleUpdate}
        />
      </div>
    </div>
  );
}
