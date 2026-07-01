const path = require('path');

/** @type {import('next').NextConfig} */
function r2RemotePatterns() {
  const value = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!value) return [];
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return [];
    return [{ protocol: 'https', hostname: url.hostname }];
  } catch {
    return [];
  }
}

function r2Origin() {
  const value = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function buildCsp() {
  const isDev = process.env.NODE_ENV !== 'production';
  const r2 = r2Origin();
  // Next.js 14 emits inline hydration scripts; without nonces we must allow 'unsafe-inline'.
  // 'unsafe-eval' is required for Next.js dev mode (HMR / React refresh).
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";
  // Tailwind / Next inject inline styles; Google Fonts CSS needs fonts.googleapis.com.
  const styleSrc = "'self' 'unsafe-inline' https://fonts.googleapis.com";
  const fontSrc = "'self' https://fonts.gstatic.com data:";
  const imgSrc = ["'self'", 'data:', 'blob:', r2].filter(Boolean).join(' ');
  // Dev needs WebSocket + localhost for HMR; prod is same-origin (backend is reverse-proxied via /api).
  const connectSrc = isDev
    ? "'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*"
    : "'self'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `font-src ${fontSrc}`,
    `img-src ${imgSrc}`,
    `connect-src ${connectSrc}`,
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

const nextConfig = {
  outputFileTracingRoot: path.resolve(__dirname),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: buildCsp() },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/:path*`,
        },
      ],
    };
  },
  images: {
    remotePatterns: r2RemotePatterns(),
  },
};

module.exports = nextConfig;
