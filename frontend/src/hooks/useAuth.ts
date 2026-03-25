'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, clearToken } from '@/lib/api';

export function useAuth(redirectIfUnauth = true) {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const ok = isAuthenticated();
    setAuthed(ok);
    setLoading(false);
    if (!ok && redirectIfUnauth) {
      router.replace('/admin/login');
    }
  }, [router, redirectIfUnauth]);

  const logout = () => {
    clearToken();
    router.replace('/admin/login');
  };

  return { authed, loading, logout };
}
