'use client';

import { useState, useEffect } from 'react';
interface Submission {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  inquiry_type: string | null;
  message: string;
  locale: string;
  created_at: string;
  is_read: boolean;
}

const API_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:4000'
  : '';

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_token');
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const INQUIRY_LABELS: Record<string, string> = {
  event: '活動攝影 / Event',
  portrait: '人像攝影 / Portrait',
  commercial: '商業攝影 / Commercial',
  other: '其他 / Other',
};

export default function AdminContactPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Submission | null>(null);

  useEffect(() => {
    apiRequest<{ data: Submission[] }>('/api/contact')
      .then(r => setSubmissions(r.data))
      .finally(() => setLoading(false));
  }, []);

  async function markRead(id: number) {
    await apiRequest(`/api/contact/${id}/read`, { method: 'PUT' });
    setSubmissions(s => s.map(sub => sub.id === id ? { ...sub, is_read: true } : sub));
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, is_read: true } : null);
  }

  async function deleteSubmission(id: number) {
    if (!confirm('Delete this submission?')) return;
    await apiRequest(`/api/contact/${id}`, { method: 'DELETE' });
    setSubmissions(s => s.filter(sub => sub.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  const unreadCount = submissions.filter(s => !s.is_read).length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl mb-1" style={{ fontFamily: 'var(--font-playfair)' }}>Contact Inbox</h1>
          {unreadCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60">
              {unreadCount} unread
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No submissions yet.</p>
      ) : (
        <div className="flex gap-6">
          {/* List */}
          <div className="w-80 shrink-0 space-y-2">
            {submissions.map(sub => (
              <button
                key={sub.id}
                onClick={() => { setSelected(sub); if (!sub.is_read) markRead(sub.id); }}
                className={`w-full text-left p-4 rounded transition-colors ${
                  selected?.id === sub.id ? 'bg-white/10' : 'hover:bg-white/5'
                }`}
                style={{ background: selected?.id === sub.id ? undefined : 'var(--bg-surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">
                    {!sub.is_read && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-2 -mt-0.5" />}
                    {sub.name}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(sub.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{sub.email}</p>
                {sub.inquiry_type && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    {INQUIRY_LABELS[sub.inquiry_type] || sub.inquiry_type}
                  </p>
                )}
              </button>
            ))}
          </div>

          {/* Detail */}
          {selected && (
            <div className="flex-1 p-6 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-lg mb-1" style={{ fontFamily: 'var(--font-playfair)' }}>{selected.name}</h2>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{selected.email}</p>
                  {selected.phone && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{selected.phone}</p>}
                </div>
                <div className="flex gap-2">
                  {!selected.is_read && (
                    <button
                      onClick={() => markRead(selected.id)}
                      className="text-xs px-3 py-1 rounded transition-colors hover:bg-white/10"
                      style={{ color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    onClick={() => deleteSubmission(selected.id)}
                    className="text-xs px-3 py-1 rounded transition-colors hover:bg-red-500/10 text-red-400"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <div>
                  <p style={{ color: 'var(--text-tertiary)' }}>Inquiry Type</p>
                  <p>{selected.inquiry_type ? (INQUIRY_LABELS[selected.inquiry_type] || selected.inquiry_type) : '—'}</p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-tertiary)' }}>Date</p>
                  <p>{new Date(selected.created_at).toLocaleString()}</p>
                </div>
                <div>
                  <p style={{ color: 'var(--text-tertiary)' }}>Language</p>
                  <p>{selected.locale === 'zh' ? 'Chinese' : 'English'}</p>
                </div>
              </div>

              <div>
                <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>Message</p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{selected.message}</p>
              </div>

              <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                <a
                  href={`mailto:${selected.email}?subject=Re: ${encodeURIComponent(selected.inquiry_type ? INQUIRY_LABELS[selected.inquiry_type] || '' : 'Your inquiry')}`}
                  className="text-xs px-4 py-2 inline-block transition-colors"
                  style={{ background: 'white', color: 'black' }}
                >
                  Reply via Email
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
