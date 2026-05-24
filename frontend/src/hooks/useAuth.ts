'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, isAuthenticated } from '@/lib/api';

export function useAuth(redirectIfUnauth = true) {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    isAuthenticated().then((ok) => {
      if (!mounted) return;
      setAuthed(ok);
      setLoading(false);
      if (!ok && redirectIfUnauth) {
        router.replace('/admin/login');
      }
    });
    return () => { mounted = false; };
  }, [router, redirectIfUnauth]);

  const logout = async () => {
    await auth.logout().catch(() => {});
    router.replace('/admin/login');
  };

  return { authed, loading, logout };
}
