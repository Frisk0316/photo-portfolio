export function formatDate(dateStr: string | null | undefined, locale: string = 'zh'): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const loc = locale === 'en' ? 'en-US' : 'zh-TW';
  return d.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' });
}

const ASPECT_RATIOS: Record<string, string> = {
  '4:3': '4/3',
  '3:2': '3/2',
  '16:9': '16/9',
  '3:4': '3/4',
  '9:16': '9/16',
};

// Desktop aspect ratio (default landscape)
export function coverAspectStyle(ratio?: string): string {
  return ASPECT_RATIOS[ratio || '4:3'] || '4/3';
}

// Mobile aspect ratio — portrait covers get taller display on mobile
export function coverMobileAspectStyle(ratio?: string): string {
  const r = ratio || '4:3';
  // Portrait ratios stay as-is on mobile
  if (r === '3:4' || r === '9:16') return ASPECT_RATIOS[r];
  // Landscape ratios become squarer on mobile for better use of screen space
  return '4/3';
}

export const COVER_ASPECT_OPTIONS = ['4:3', '3:2', '16:9', '3:4', '9:16'] as const;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function classifyAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  if (ratio >= 2.1) return 'ultra-wide';
  if (ratio >= 1.7) return '16:9';
  if (ratio >= 1.45) return '3:2';
  if (ratio >= 1.2) return '4:3';
  if (ratio >= 0.95) return '1:1';
  if (ratio >= 0.65) return '4:5';
  return 'portrait';
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
