'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, setToken, isAuthenticated } from '@/lib/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) router.replace('/admin');
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await auth.login(username, password);
      setToken(result.data.token);
      router.replace('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl mb-8 text-center" style={{ fontFamily: 'var(--font-playfair)' }}>
          Admin Login
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-4 py-3 rounded text-sm outline-none focus:ring-1 focus:ring-white/20"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded text-sm outline-none focus:ring-1 focus:ring-white/20"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
            style={{ background: 'var(--accent)', color: '#0a0a0a' }}
          >
            {loading && <LoadingSpinner size={14} />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
