export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
}

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
