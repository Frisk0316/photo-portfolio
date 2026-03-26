'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Category } from '@/lib/api';

interface HeaderProps {
  categories?: Category[];
  activeCategory?: number | null;
  onCategoryChange?: (id: number | null) => void;
  sortOrder?: 'date_desc' | 'date_asc';
  onSortChange?: (sort: 'date_desc' | 'date_asc') => void;
}

export default function Header({ categories = [], activeCategory, onCategoryChange, sortOrder, onSortChange }: HeaderProps) {
  const pathname = usePathname();
  const isHome = pathname === '/';

  return (
    <header className="sticky top-0 z-40 px-6 py-4 flex items-center justify-between"
      style={{ background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}>
      <Link href="/" className="font-display text-lg tracking-wide" style={{ fontFamily: 'var(--font-playfair)' }}>
        Portfolio
      </Link>

      {isHome && (
        <div className="flex items-center gap-4">
          {categories.length > 0 && onCategoryChange && (
            <nav className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => onCategoryChange(null)}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${
                  activeCategory === null
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => onCategoryChange(cat.id)}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-white/10 text-white'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </nav>
          )}

          {onSortChange && (
            <button
              onClick={() => onSortChange(sortOrder === 'date_desc' ? 'date_asc' : 'date_desc')}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
              title={sortOrder === 'date_desc' ? '新到舊' : '舊到新'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {sortOrder === 'date_desc' ? (
                  <path d="M12 5v14M5 12l7 7 7-7" />
                ) : (
                  <path d="M12 19V5M5 12l7-7 7 7" />
                )}
              </svg>
              <span>{sortOrder === 'date_desc' ? '新→舊' : '舊→新'}</span>
            </button>
          )}
        </div>
      )}
    </header>
  );
}
