// Cloudflare Worker: streams browser uploads to R2 after validating a short-lived
// prefix-scoped upload token issued by the backend.

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const corsOrigin = allowed.includes(origin) ? origin : '';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
          'Access-Control-Allow-Methods': 'PUT',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Upload-Key',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'PUT') {
      return corsJson({ error: 'Method not allowed' }, 405, corsOrigin);
    }

    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return corsJson({ error: 'Missing upload token' }, 401, corsOrigin);
    }

    const token = authHeader.slice(7);
    const payload = await verifyJwt(token, env.UPLOAD_TOKEN_SECRET || env.R2_WORKER_SECRET || env.WORKER_SECRET);
    if (!payload || payload.purpose !== 'r2-upload' || typeof payload.allowedPrefix !== 'string') {
      return corsJson({ error: 'Invalid upload token' }, 401, corsOrigin);
    }

    const rawKey = request.headers.get('X-Upload-Key');
    if (!rawKey) return corsJson({ error: 'Missing X-Upload-Key header' }, 400, corsOrigin);
    const key = decodeURIComponent(rawKey);
    if (!isSafeKey(key, payload.allowedPrefix)) {
      return corsJson({ error: 'Invalid upload key' }, 400, corsOrigin);
    }

    const contentType = request.headers.get('Content-Type') || '';
    if (!isAllowedContentType(contentType, key)) {
      return corsJson({ error: 'Invalid content type' }, 400, corsOrigin);
    }

    const maxBytes = Number(payload.maxBytes || env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024);
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (!contentLength) {
      return corsJson({ error: 'Missing content length' }, 411, corsOrigin);
    }
    if (contentLength && contentLength > maxBytes) {
      return corsJson({ error: 'Upload too large' }, 413, corsOrigin);
    }

    try {
      await env.PHOTOS_BUCKET.put(key, request.body, {
        httpMetadata: {
          contentType,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
      return corsJson({ success: true, key }, 200, corsOrigin);
    } catch {
      return corsJson({ error: 'Upload failed' }, 500, corsOrigin);
    }
  },
};

function corsJson(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    },
  });
}

async function verifyJwt(token, secret) {
  try {
    if (!secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(base64UrlDecodeToString(parts[0]));
    if (header.alg !== 'HS256') return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlDecode(parts[2]);
    const valid = await crypto.subtle.verify('HMAC', key, signature, data);
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecodeToString(parts[1]));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function isSafeKey(key, allowedPrefix) {
  if (!key.startsWith(`${allowedPrefix}/`)) return false;
  if (key.startsWith('/') || key.includes('..') || key.includes('\\')) return false;
  const rest = key.slice(allowedPrefix.length + 1);
  const parts = rest.split('/');
  if (parts.length !== 2) return false;
  const [variant, fileName] = parts;
  if (!['original', 'thumbnail', 'small', 'medium', 'webp'].includes(variant)) return false;
  const expectedExtension = variant === 'webp' ? 'webp' : 'jpe?g';
  return new RegExp(`^[A-Za-z0-9._-]+\\.(?:${expectedExtension})$`, 'i').test(fileName);
}

function isAllowedContentType(contentType, key) {
  if (key.endsWith('.webp')) return contentType === 'image/webp';
  return contentType === 'image/jpeg';
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlDecodeToString(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  return atob(str);
}
