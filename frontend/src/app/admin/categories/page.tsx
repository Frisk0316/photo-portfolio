'use client';

import { useEffect, useState } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { categories as catApi } from '@/lib/api';
import { slugify } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import type { Category } from '@/lib/api';

function SortableCategoryRow({ cat, onSave, onDelete }: {
  cat: Category;
  onSave: (id: number, name: string, section: 'events' | 'other') => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [section, setSection] = useState<'events' | 'other'>(cat.section || 'other');
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: cat.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  async function save() {
    await onSave(cat.id, name, section);
    setEditing(false);
  }

  return (
    <tr ref={setNodeRef} style={style}>
      <td className="py-3 px-4 w-8">
        <button {...attributes} {...listeners} className="cursor-grab text-white/20 hover:text-white/50">⠿</button>
      </td>
      <td className="py-3 px-4">
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            autoFocus
            className="px-2 py-1 rounded text-sm outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
        ) : (
          <span className="text-sm">{cat.name}</span>
        )}
      </td>
      <td className="py-3 px-4 text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
        {cat.slug}
      </td>
      <td className="py-3 px-4">
        {editing ? (
          <select
            value={section}
            onChange={e => setSection(e.target.value as 'events' | 'other')}
            className="px-2 py-1 rounded text-xs outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            <option value="events">Events</option>
            <option value="other">Other</option>
          </select>
        ) : (
          <span className={`text-xs px-2 py-0.5 rounded-full ${cat.section === 'events' ? 'bg-blue-500/20 text-blue-300' : 'bg-white/10 text-white/40'}`}>
            {cat.section === 'events' ? 'Events' : 'Other'}
          </span>
        )}
      </td>
      <td className="py-3 px-4">
        <div className="flex gap-2">
          {editing ? (
            <>
              <button onClick={save} className="text-xs text-green-400">Save</button>
              <button onClick={() => setEditing(false)} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="text-xs text-white/40 hover:text-white">Edit</button>
          )}
          <button onClick={() => onDelete(cat.id)} className="text-xs text-red-400/50 hover:text-red-400">Delete</button>
        </div>
      </td>
    </tr>
  );
}

export default function CategoriesPage() {
  const [catList, setCatList] = useState<Category[]>([]);
  const [newName, setNewName] = useState('');
  const [newSection, setNewSection] = useState<'events' | 'other'>('other');
  const sensors = useSensors(useSensor(PointerSensor));
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    catApi.list().then((r) => setCatList(r.data));
  }, []);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = catList.findIndex((c) => c.id === active.id);
    const newIndex = catList.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(catList, oldIndex, newIndex);
    setCatList(reordered);
    await catApi.reorder(reordered.map((c, i) => ({ id: c.id, sort_order: i })));
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      const result = await catApi.create({ name: newName.trim(), slug: slugify(newName.trim()), section: newSection });
      setCatList((prev) => [...prev, result.data]);
      setNewName('');
      showSuccess('已順利儲存');
    } catch (err) {
      showError(err instanceof Error ? err.message : '建立失敗');
    }
  }

  async function handleSave(id: number, name: string, section: 'events' | 'other') {
    try {
      await catApi.update(id, { name, slug: slugify(name), section });
      setCatList((prev) => prev.map((c) => c.id === id ? { ...c, name, slug: slugify(name), section } : c));
      showSuccess('已順利儲存');
    } catch (err) {
      showError(err instanceof Error ? err.message : '儲存失敗');
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this category?')) return;
    try {
      await catApi.delete(id);
      setCatList((prev) => prev.filter((c) => c.id !== id));
      showSuccess('已成功刪除');
    } catch (err) {
      showError(err instanceof Error ? err.message : '刪除失敗');
    }
  }

  return (
    <div>
      <h1 className="text-2xl mb-8" style={{ fontFamily: 'var(--font-playfair)' }}>Categories</h1>

      {/* New category */}
      <div className="flex gap-3 mb-8">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          placeholder="New category name…"
          className="px-3 py-2 rounded text-sm outline-none flex-1 max-w-xs"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        />
        <select
          value={newSection}
          onChange={e => setNewSection(e.target.value as 'events' | 'other')}
          className="px-3 py-2 rounded text-sm outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        >
          <option value="other">Other</option>
          <option value="events">Events</option>
        </select>
        <button onClick={handleCreate}
          className="px-4 py-2 rounded text-sm"
          style={{ background: 'var(--accent)', color: '#0a0a0a' }}>
          Add
        </button>
      </div>

      <div className="rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
              <th className="py-3 px-4 w-8"></th>
              <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>Name</th>
              <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>Slug</th>
              <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>Section</th>
              <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>Actions</th>
            </tr>
          </thead>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={catList.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <tbody>
                {catList.map((cat) => (
                  <SortableCategoryRow
                    key={cat.id}
                    cat={cat}
                    onSave={handleSave}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>
    </div>
  );
}
