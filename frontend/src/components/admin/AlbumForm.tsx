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
  const [titleEn, setTitleEn] = useState(initial.title_en || '');
  const [slug, setSlug] = useState(initial.slug || '');
  const [description, setDescription] = useState(initial.description || '');
  const [descriptionEn, setDescriptionEn] = useState(initial.description_en || '');
  const [shotDate, setShotDate] = useState(initial.shot_date?.slice(0, 10) || '');
  const [categoryId, setCategoryId] = useState<string>(initial.category_id?.toString() || '');
  const [isPublished, setIsPublished] = useState(initial.is_published || false);
  const [coverAspectRatio, setCoverAspectRatio] = useState(initial.cover_aspect_ratio || '4:3');
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    categories.list().then((r) => setCategoryList(r.data));
  }, []);

  useEffect(() => {
    setSlug(slugify(title));
  }, [title]);

  const isDirty =
    title !== (initial.title || '') ||
    titleEn !== (initial.title_en || '') ||
    description !== (initial.description || '') ||
    descriptionEn !== (initial.description_en || '') ||
    shotDate !== (initial.shot_date?.slice(0, 10) || '') ||
    categoryId !== (initial.category_id?.toString() || '') ||
    isPublished !== (initial.is_published || false) ||
    coverAspectRatio !== (initial.cover_aspect_ratio || '4:3');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onSubmit({
        title,
        title_en: titleEn || undefined,
        slug,
        description: description || undefined,
        description_en: descriptionEn || undefined,
        shot_date: shotDate || undefined,
        category_id: categoryId ? Number(categoryId) : undefined,
        is_published: isPublished,
        cover_aspect_ratio: coverAspectRatio,
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
        <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Title (English)</label>
        <input
          type="text" value={titleEn} onChange={(e) => setTitleEn(e.target.value)}
          placeholder="English title for i18n"
          className={inputClass} style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          Slug
        </label>
        <input
          type="text" value={slug} readOnly
          className={inputClass} style={{ ...inputStyle, fontFamily: 'var(--font-dm-mono)', opacity: 0.5 }}
        />
      </div>

      <div>
        <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Description</label>
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
          className={inputClass} style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Description (English)</label>
        <textarea
          value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} rows={3}
          placeholder="English description for i18n"
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

      <div>
        <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Cover Aspect Ratio</label>
        <div className="flex gap-2">
          {['4:3', '3:2', '16:9'].map((ratio) => (
            <button
              key={ratio}
              type="button"
              onClick={() => setCoverAspectRatio(ratio)}
              className="px-3 py-1.5 rounded text-xs transition-colors"
              style={{
                background: coverAspectRatio === ratio ? 'var(--accent)' : 'var(--bg-elevated)',
                color: coverAspectRatio === ratio ? '#0a0a0a' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              {ratio}
            </button>
          ))}
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
        type="submit" disabled={loading || !isDirty}
        className="px-5 py-2.5 rounded text-sm font-medium transition-opacity"
        style={{ background: 'var(--accent)', color: '#0a0a0a', opacity: isDirty ? 1 : 0.4 }}
      >
        {loading ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
