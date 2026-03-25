// Cloudflare Worker — proxies browser uploads to R2 via native binding.
// Auth: verifies the admin JWT token using the shared JWT_SECRET.

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    const corsOrigin = allowed.includes(origin) ? origin : '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'PUT',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Upload-Key',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'PUT') {
      return corsJson({ error: 'Method not allowed' }, 405, corsOrigin);
    }

    // Verify auth: accept either admin JWT (browser) or shared secret (backend)
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return corsJson({ error: 'Missing token' }, 401, corsOrigin);
    }
    const token = authHeader.slice(7);
    const isServerSecret = env.WORKER_SECRET && token === env.WORKER_SECRET;
    const isValidJwt = !isServerSecret && await verifyJwt(token, env.JWT_SECRET);
    if (!isServerSecret && !isValidJwt) {
      return corsJson({ error: 'Invalid token' }, 401, corsOrigin);
    }

    // Get the R2 key from header
    const key = request.headers.get('X-Upload-Key');
    if (!key) {
      return corsJson({ error: 'Missing X-Upload-Key header' }, 400, corsOrigin);
    }

    // Stream the body directly to R2 (no buffering in Worker memory)
    try {
      await env.PHOTOS_BUCKET.put(key, request.body, {
        httpMetadata: {
          contentType: request.headers.get('Content-Type') || 'image/jpeg',
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
      return corsJson({ success: true, key }, 200, corsOrigin);
    } catch (err) {
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

// Verify HS256 JWT using Web Crypto API (available in Workers)
async function verifyJwt(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const signature = base64UrlDecode(parts[2]);

    const valid = await crypto.subtle.verify('HMAC', key, signature, data);
    if (!valid) return false;

    // Check expiry
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
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
