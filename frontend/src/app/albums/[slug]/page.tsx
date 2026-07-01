import { redirect } from 'next/navigation';

function getApiUrl() {
  const url = process.env.BACKEND_URL;
  if (!url) throw new Error('Missing BACKEND_URL environment variable');
  return url;
}

async function getAlbum(slug: string) {
  try {
    const res = await fetch(`${getApiUrl()}/api/albums/${slug}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

type AlbumRedirectParams = Promise<{ slug: string }>;

export default async function AlbumRedirectPage({ params }: { params: AlbumRedirectParams }) {
  const { slug } = await params;
  const album = await getAlbum(slug);

  if (!album) {
    redirect('/');
  }

  const section = album.category_section;
  if (section === 'events') {
    redirect(`/events/${slug}`);
  } else {
    redirect(`/gallery/${slug}`);
  }
}
