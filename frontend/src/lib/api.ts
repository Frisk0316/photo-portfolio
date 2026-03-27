const API_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:4000'
  : '';


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
  section: 'events' | 'other';
}

export const categories = {
  list: (section?: 'events' | 'other') => {
    const qs = section ? `?section=${section}` : '';
    return request<{ data: Category[] }>(`/api/categories${qs}`);
  },
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
  cover_crop_data: { offsetX: number; offsetY: number; zoom: number } | null;
  photo_count: number;
  is_published: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  cover_url?: string;
  category_name?: string;
  category_section?: 'events' | 'other';
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
  list: (all = false, sort?: 'date_desc' | 'date_asc', section?: 'events' | 'other') => {
    const params = new URLSearchParams();
    if (all) params.set('all', 'true');
    if (sort) params.set('sort', sort);
    if (section) params.set('section', section);
    const qs = params.toString();
    return request<{ data: Album[] }>(`/api/albums${qs ? `?${qs}` : ''}`);
  },
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

// Contact
export interface ContactFormData {
  name: string;
  email: string;
  phone?: string;
  inquiryType?: string;
  message: string;
  locale?: string;
}

export const contact = {
  submit: (data: ContactFormData) =>
    request<{ data: { id: number } }>('/api/contact', { method: 'POST', body: JSON.stringify(data) }),
};

// Hero images
export interface HeroImage {
  id: number;
  photo_id: number;
  sort_order: number;
  url_medium: string;
  url_original: string;
  blur_hash: string | null;
  width: number;
  height: number;
  album_title: string;
}

export const heroImages = {
  list: () => request<{ data: HeroImage[] }>('/api/hero-images'),
  add: (photoId: number) =>
    request<{ data: { id: number } }>('/api/hero-images', { method: 'POST', body: JSON.stringify({ photoId }) }),
  remove: (id: number) =>
    request<{ data: { id: number } }>(`/api/hero-images/${id}`, { method: 'DELETE' }),
  reorder: (items: { id: number; sort_order: number }[]) =>
    request<{ data: { updated: number } }>('/api/hero-images/reorder', { method: 'PUT', body: JSON.stringify({ items }) }),
};

// Download (watermarked)
export const download = {
  getUrl: (photoId: number) => `${API_URL}/api/download/${photoId}`,
};

// Upload — all R2 writes go through the Cloudflare Worker.
// Backend only handles lightweight DB registration (no image processing).
export const upload = {
  getWorkerUrl: () =>
    request<{ data: { workerUrl: string } }>('/api/upload/worker-url'),
  putToWorker: async (workerUrl: string, key: string, body: Blob | File, contentType: string) => {
    const token = getToken();
    const res = await fetch(workerUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Authorization': `Bearer ${token}`,
        'X-Upload-Key': key,
      },
      body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Worker upload failed: ${res.status}`);
    }
    return res.json();
  },
  register: (data: {
    albumId: number;
    fileName: string;
    width: number;
    height: number;
    aspectRatio: number;
    aspectCategory: string;
    blurHash: string | null;
    urlOriginal: string;
    urlThumbnail: string;
    urlMedium: string;
    urlWebp: string;
    fileSize: number;
    sortOrder?: number;
  }) =>
    request<{ data: Photo }>('/api/upload/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
