'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Category } from '@/lib/api';

interface HeaderProps {
  categories?: Category[];
  activeCategory?: number | null;
  onCategoryChange?: (id: number | null) => void;
}

export default function Header({ categories = [], activeCategory, onCategoryChange }: HeaderProps) {
  const pathname = usePathname();
  const isHome = pathname === '/';

  return (
    <header className="sticky top-0 z-40 px-6 py-4 flex items-center justify-between"
      style={{ background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}>
      <Link href="/" className="font-display text-lg tracking-wide" style={{ fontFamily: 'var(--font-playfair)' }}>
        Portfolio
      </Link>

      {isHome && categories.length > 0 && onCategoryChange && (
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
    </header>
  );
}
