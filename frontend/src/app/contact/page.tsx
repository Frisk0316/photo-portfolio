'use client';

import { useState } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { useTranslation } from '@/lib/i18n';
import { contact } from '@/lib/api';
import type { ContactFormData } from '@/lib/api';

export default function ContactPage() {
  const { t, locale } = useTranslation();
  const [form, setForm] = useState<ContactFormData>({
    name: '',
    email: '',
    phone: '',
    inquiryType: '',
    message: '',
  });
  const [errors, setErrors] = useState<Partial<ContactFormData & { submit: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const inquiryTypes = [
    { value: 'event', label: t('contact.inquiryTypes.event') },
    { value: 'portrait', label: t('contact.inquiryTypes.portrait') },
    { value: 'commercial', label: t('contact.inquiryTypes.commercial') },
    { value: 'other', label: t('contact.inquiryTypes.other') },
  ];

  function validate() {
    const e: Partial<ContactFormData & { submit: string }> = {};
    if (!form.name.trim()) e.name = t('contact.required');
    if (!form.email.trim()) e.email = t('contact.required');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = t('contact.invalidEmail');
    if (!form.message.trim()) e.message = t('contact.required');
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSubmitting(true);
    try {
      await contact.submit({ ...form, locale });
      setSubmitted(true);
    } catch {
      setErrors({ submit: t('contact.error') });
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "w-full px-4 py-3 rounded text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-white/30 transition-colors";
  const labelClass = "block text-xs mb-2 tracking-wide";

  return (
    <>
      <Header />
      <main className="px-6 pb-16">
        <section className="py-16 md:py-20 max-w-2xl">
          <p className="text-xs tracking-[0.2em] uppercase mb-4"
            style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            Contact
          </p>
          <h1 className="text-4xl md:text-5xl mb-4" style={{ fontFamily: 'var(--font-playfair)' }}>
            {t('contact.title')}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('contact.subtitle')}
          </p>
        </section>

        {submitted ? (
          <div className="max-w-2xl p-8 rounded-lg text-center"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <svg className="mx-auto mb-4" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-lg mb-2" style={{ fontFamily: 'var(--font-playfair)' }}>
              {t('contact.success')}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
            {/* Name + Email row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                  {t('contact.name')} <span className="text-white/30">*</span>
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder={t('contact.namePlaceholder')}
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
                {errors.name && <p className="text-xs mt-1 text-red-400">{errors.name}</p>}
              </div>
              <div>
                <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                  {t('contact.email')} <span className="text-white/30">*</span>
                </label>
                <input
                  type="email"
                  className={inputClass}
                  placeholder={t('contact.emailPlaceholder')}
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
                {errors.email && <p className="text-xs mt-1 text-red-400">{errors.email}</p>}
              </div>
            </div>

            {/* Phone + Inquiry type row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                  {t('contact.phone')}
                </label>
                <input
                  type="tel"
                  className={inputClass}
                  placeholder={t('contact.phonePlaceholder')}
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                  {t('contact.inquiryType')}
                </label>
                <select
                  className={inputClass}
                  value={form.inquiryType}
                  onChange={e => setForm(f => ({ ...f, inquiryType: e.target.value }))}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="">{t('contact.selectType')}</option>
                  {inquiryTypes.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Message */}
            <div>
              <label className={labelClass} style={{ color: 'var(--text-secondary)' }}>
                {t('contact.message')} <span className="text-white/30">*</span>
              </label>
              <textarea
                className={`${inputClass} resize-none`}
                rows={6}
                placeholder={t('contact.messagePlaceholder')}
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              />
              {errors.message && <p className="text-xs mt-1 text-red-400">{errors.message}</p>}
            </div>

            {errors.submit && (
              <p className="text-sm text-red-400">{errors.submit}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="px-8 py-3 text-sm tracking-wide transition-colors disabled:opacity-50"
              style={{
                background: 'white',
                color: 'black',
                fontFamily: 'var(--font-dm-mono)',
              }}
            >
              {submitting ? t('contact.submitting') : t('contact.submit')}
            </button>
          </form>
        )}
      </main>
      <Footer />
    </>
  );
}
