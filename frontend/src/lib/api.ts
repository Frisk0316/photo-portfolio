const API_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:4000'
  : '';

// Long-running requests (upload process) go directly to Railway to avoid Vercel proxy timeout
const DIRECT_API_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:4000'
  : 'https://determined-enthusiasm-production-22d1.up.railway.app';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_token');
}

export function setToken(token: string) {
  localStorage.setItem('admin_token', token);
}

export function clearToken() {
  localStorage.removeItem('admin_token');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth
export const auth = {
  login: (username: string, password: string) =>
    request<{ data: { token: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
};

// Categories
export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
}

export const categories = {
  list: () => request<{ data: Category[] }>('/api/categories'),
  create: (data: Partial<Category>) =>
    request<{ data: Category }>('/api/categories', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Category>) =>
    request<{ data: Category }>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<{ data: { id: number } }>(`/api/categories/${id}`, { method: 'DELETE' }),
  reorder: (items: { id: number; sort_order: number }[]) =>
    request<{ data: { updated: number } }>('/api/categories/reorder', { method: 'PUT', body: JSON.stringify({ items }) }),
};

// Albums
export interface Album {
  id: number;
  category_id: number | null;
  title: string;
  slug: string;
  description: string | null;
  shot_date: string | null;
  folder_name: string | null;
  cover_photo_id: number | null;
  photo_count: number;
  is_published: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  cover_url?: string;
}

export interface Photo {
  id: number;
  album_id: number;
  file_name: string;
  caption: string | null;
  group_tag: string | null;
  aspect_ratio: number;
  aspect_category: string | null;
  width: number;
  height: number;
  blur_hash: string | null;
  url_original: string;
  url_thumbnail: string;
  url_medium: string;
  url_webp: string;
  file_size: number | null;
  sort_order: number;
  exif_data: Record<string, unknown> | null;
}

export const albums = {
  list: (all = false) =>
    request<{ data: Album[] }>(`/api/albums${all ? '?all=true' : ''}`),
  get: (slug: string) =>
    request<{ data: Album & { photos: Photo[] } }>(`/api/albums/${slug}`),
  create: (data: Partial<Album>) =>
    request<{ data: Album }>('/api/albums', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Album>) =>
    request<{ data: Album }>(`/api/albums/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<{ data: { id: number } }>(`/api/albums/${id}`, { method: 'DELETE' }),
  reorder: (items: { id: number; sort_order: number }[]) =>
    request<{ data: { updated: number } }>('/api/albums/reorder', { method: 'PUT', body: JSON.stringify({ items }) }),
};

// Photos
export const photos = {
  update: (id: number, data: { caption?: string; group_tag?: string }) =>
    request<{ data: Photo }>(`/api/photos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<{ data: { id: number } }>(`/api/photos/${id}`, { method: 'DELETE' }),
  bulkDelete: (ids: number[]) =>
    request<{ data: { deleted: number } }>('/api/photos/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  reorder: (albumId: number, items: { id: number; sort_order: number }[]) =>
    request<{ data: { updated: number } }>(`/api/albums/${albumId}/photos/reorder`, { method: 'PUT', body: JSON.stringify({ items }) }),
};

// Upload — presign & process go through Vercel rewrite (small JSON),
// the large file goes to the Cloudflare Worker which writes to R2 natively.
export const upload = {
  presign: (albumSlug: string, fileName: string, contentType: string) =>
    request<{ data: { workerUrl: string; key: string } }>('/api/upload/presign', {
      method: 'POST',
      body: JSON.stringify({ albumSlug, fileName, contentType }),
    }),
  putToWorker: async (workerUrl: string, key: string, file: File) => {
    const token = getToken();
    const res = await fetch(workerUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'image/jpeg',
        'Authorization': `Bearer ${token}`,
        'X-Upload-Key': key,
      },
      body: file,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Worker upload failed: ${res.status}`);
    }
    return res.json();
  },
  process: async (albumId: number, albumSlug: string, key: string, fileName: string): Promise<{ data: Photo }> => {
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${DIRECT_API_URL}/api/upload/process`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ albumId, albumSlug, key, fileName }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return res.json();
  },
};
