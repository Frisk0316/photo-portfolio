'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

const navItems = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/categories', label: 'Categories' },
  { href: '/admin/hero', label: 'Hero Carousel' },
  { href: '/admin/contact', label: 'Contact Inbox' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { logout } = useAuth(false);

  return (
    <aside className="w-56 shrink-0 flex flex-col h-screen sticky top-0"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}>
      <div className="p-6">
        <Link href="/" className="text-sm font-display block mb-1" style={{ fontFamily: 'var(--font-playfair)' }}>
          Portfolio
        </Link>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Admin</p>
      </div>

      <nav className="flex-1 px-3 overflow-y-auto">
        {navItems.map((item) => {
          const active = item.href === '/admin'
            ? pathname === '/admin' || pathname.startsWith('/admin/albums')
            : pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2 rounded text-sm mb-1 transition-colors ${
                active ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4">
        <button
          onClick={logout}
          className="w-full px-3 py-2 text-xs rounded text-left transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
