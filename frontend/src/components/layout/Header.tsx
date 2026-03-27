'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import type { Category } from '@/lib/api';

interface HeaderProps {
  categories?: Category[];
  activeCategory?: number | null;
  onCategoryChange?: (id: number | null) => void;
  sortOrder?: 'date_desc' | 'date_asc';
  onSortChange?: (sort: 'date_desc' | 'date_asc') => void;
}

export default function Header({
  categories = [],
  activeCategory,
  onCategoryChange,
  sortOrder,
  onSortChange,
}: HeaderProps) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = [
    { href: '/', label: t('header.home') },
    { href: '/events', label: t('header.events') },
    { href: '/gallery', label: t('header.gallery') },
    { href: '/contact', label: t('header.contact') },
  ];

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <header
      className="sticky top-0 z-40 px-6 py-4"
      style={{
        background: 'rgba(10,10,10,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="font-display text-lg tracking-wide shrink-0"
          style={{ fontFamily: 'var(--font-playfair)' }}
        >
          Ospreay Photo
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`text-xs tracking-wide transition-colors ${
                isActive(href) ? 'text-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Right: sort + lang toggle + mobile menu */}
        <div className="flex items-center gap-3">
          {/* Sort button (shown on section pages when provided) */}
          {onSortChange && (
            <button
              onClick={() =>
                onSortChange(sortOrder === 'date_desc' ? 'date_asc' : 'date_desc')
              }
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
              title={
                sortOrder === 'date_desc'
                  ? t('sort.newToOldTitle')
                  : t('sort.oldToNewTitle')
              }
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {sortOrder === 'date_desc' ? (
                  <path d="M12 5v14M5 12l7 7 7-7" />
                ) : (
                  <path d="M12 19V5M5 12l7-7 7 7" />
                )}
              </svg>
              <span>
                {sortOrder === 'date_desc' ? t('sort.newToOld') : t('sort.oldToNew')}
              </span>
            </button>
          )}

          {/* Language toggle */}
          <button
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            className="text-xs px-2 py-1 rounded transition-colors text-white/40 hover:text-white/70 hover:bg-white/5"
            style={{ fontFamily: 'var(--font-dm-mono)' }}
          >
            {locale === 'zh' ? 'EN' : '中'}
          </button>

          {/* Mobile hamburger */}
          <button
            className="md:hidden text-white/50 hover:text-white transition-colors"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
          >
            {menuOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Category filter (shown when provided) */}
      {categories.length > 0 && onCategoryChange && (
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <button
            onClick={() => onCategoryChange(null)}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              activeCategory === null
                ? 'bg-white/10 text-white'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            {t('common.all')}
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
        </div>
      )}

      {/* Mobile dropdown */}
      {menuOpen && (
        <nav className="md:hidden mt-4 flex flex-col gap-3 pb-2">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className={`text-sm transition-colors ${
                isActive(href) ? 'text-white' : 'text-white/50 hover:text-white'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
