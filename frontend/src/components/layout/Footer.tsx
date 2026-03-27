'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';

export default function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer
      className="px-6 py-8 mt-16 text-center text-xs"
      style={{
        color: 'var(--text-tertiary)',
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-dm-mono)',
      }}
    >
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <span>{t('footer.copyright', { year })}</span>
        <span className="hidden sm:inline" style={{ color: 'var(--border)' }}>|</span>
        <Link
          href="/contact"
          className="hover:text-white/60 transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {t('footer.contact')}
        </Link>
      </div>
    </footer>
  );
}
