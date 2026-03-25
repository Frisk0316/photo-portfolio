'use client';

import { useState, useEffect } from 'react';
import { slugify } from '@/lib/utils';
import { categories } from '@/lib/api';
import type { Album, Category } from '@/lib/api';

interface AlbumFormProps {
  initial?: Partial<Album>;
  onSubmit: (data: Partial<Album>) => Promise<void>;
  submitLabel?: string;
}

export default function AlbumForm({ initial = {}, onSubmit, submitLabel = 'Save' }: AlbumFormProps) {
  const [title, setTitle] = useState(initial.title || '');
  const [slug, setSlug] = useState(initial.slug || '');
  const [description, setDescription] = useState(initial.description || '');
  const [shotDate, setShotDate] = useState(initial.shot_date?.slice(0, 10) || '');
  const [categoryId, setCategoryId] = useState<string>(initial.category_id?.toString() || '');
  const [isPublished, setIsPublished] = useState(initial.is_published || false);
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [slugManual, setSlugManual] = useState(!!initial.slug);

  useEffect(() => {
    categories.list().then((r) => setCategoryList(r.data));
  }, []);

  useEffect(() => {
    if (!slugManual) setSlug(slugify(title));
  }, [title, slugManual]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onSubmit({
        title,
        slug,
        description: description || undefined,
        shot_date: shotDate || undefined,
        category_id: categoryId ? Number(categoryId) : undefined,
        is_published: isPublished,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  const inputClass = 'w-full px-3 py-2 rounded text-sm outline-none focus:ring-1 focus:ring-white/20';
  const inputStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-xl">
      <div>
        <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Title *</label>
        <input
          type="text" value={title} onChange={(e) => setTitle(e.target.value)} required
          className={inputClass} style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          Slug *
        </label>
        <input
          type="text" value={slug}
          onChange={(e) => { setSlugManual(true); setSlug(e.target.value); }} required
          className={inputClass} style={{ ...inputStyle, fontFamily: 'var(--font-dm-mono)' }}
        />
      </div>

      <div>
        <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Description</label>
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
          className={inputClass} style={inputStyle}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Shot Date</label>
          <input
            type="date" value={shotDate} onChange={(e) => setShotDate(e.target.value)}
            className={inputClass} style={inputStyle}
          />
        </div>

        <div>
          <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Category</label>
          <select
            value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className={inputClass} style={inputStyle}
          >
            <option value="">— None —</option>
            {categoryList.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)}
          className="w-4 h-4 rounded"
        />
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Published</span>
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit" disabled={loading}
        className="px-5 py-2.5 rounded text-sm font-medium"
        style={{ background: 'var(--accent)', color: '#0a0a0a' }}
      >
        {loading ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
