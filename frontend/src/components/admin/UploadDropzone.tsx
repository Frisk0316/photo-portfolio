'use client';

import { useCallback, useState, useEffect } from 'react';
import { upload as uploadApi } from '@/lib/api';
import { processImage, classifyAspectRatio } from '@/lib/image-processor';
import type { Photo } from '@/lib/api';

interface UploadFile {
  file: File;
  preview: string;
  status: 'pending' | 'processing' | 'uploading' | 'done' | 'error';
  progress: number;
  statusText?: string;
  error?: string;
  result?: Photo;
}

interface UploadDropzoneProps {
  albumId: number;
  albumSlug: string;
  onComplete: (photos: Photo[]) => void;
}

export default function UploadDropzone({ albumId, albumSlug, onComplete }: UploadDropzoneProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [workerUrl, setWorkerUrl] = useState<string | null>(null);

  // Fetch worker URL once on mount
  useEffect(() => {
    uploadApi.getWorkerUrl().then(({ data }) => setWorkerUrl(data.workerUrl)).catch(() => {});
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    const jpgs = incoming.filter((f) => /\.(jpe?g)$/i.test(f.name) && f.type === 'image/jpeg');
    const items: UploadFile[] = jpgs.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      status: 'pending',
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...items]);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(Array.from(e.target.files));
  }

  function updateFile(file: File, updates: Partial<UploadFile>) {
    setFiles((prev) => prev.map((f) => (f.file === file ? { ...f, ...updates } : f)));
  }

  async function uploadAll() {
    const pending = files.filter((f) => f.status === 'pending');
    if (!pending.length || !workerUrl) return;
    setUploading(true);

    const results: Photo[] = [];
    const publicBaseUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '';

    for (const item of pending) {
      try {
        // Step 1: Process image in browser
        updateFile(item.file, { status: 'processing', progress: 5, statusText: 'Processing...' });
        const processed = await processImage(item.file);

        // Step 2: Upload all variants to R2 via Worker
        updateFile(item.file, { status: 'uploading', progress: 15, statusText: 'Uploading...' });

        const baseName = item.file.name.replace(/\.[^.]+$/, '');
        const prefix = `albums/${albumSlug}`;
        const keys = {
          original: `${prefix}/original/${baseName}.jpg`,
          thumbnail: `${prefix}/thumbnail/${baseName}.jpg`,
          small: `${prefix}/small/${baseName}.jpg`,
          medium: `${prefix}/medium/${baseName}.jpg`,
          webp: `${prefix}/webp/${baseName}.webp`,
        };

        // Upload original (largest file)
        await uploadApi.putToWorker(workerUrl, keys.original, processed.original, 'image/jpeg');
        updateFile(item.file, { progress: 35 });

        // Upload variants in parallel
        await Promise.all([
          uploadApi.putToWorker(workerUrl, keys.thumbnail, processed.thumbnail, 'image/jpeg'),
          uploadApi.putToWorker(workerUrl, keys.small, processed.small, 'image/jpeg'),
          uploadApi.putToWorker(workerUrl, keys.medium, processed.medium, 'image/jpeg'),
          uploadApi.putToWorker(workerUrl, keys.webp, processed.webp, 'image/webp'),
        ]);
        updateFile(item.file, { progress: 80, statusText: 'Saving...' });

        // Step 3: Register in database (lightweight JSON, through Vercel rewrite)
        const { data: photo } = await uploadApi.register({
          albumId,
          fileName: item.file.name,
          width: processed.meta.originalWidth,
          height: processed.meta.originalHeight,
          aspectRatio: processed.meta.aspectRatio,
          aspectCategory: classifyAspectRatio(processed.meta.originalWidth, processed.meta.originalHeight),
          blurHash: processed.meta.blurHash,
          urlOriginal: `${publicBaseUrl}/${keys.original}`,
          urlThumbnail: `${publicBaseUrl}/${keys.thumbnail}`,
          urlSmall: `${publicBaseUrl}/${keys.small}`,
          urlMedium: `${publicBaseUrl}/${keys.medium}`,
          urlWebp: `${publicBaseUrl}/${keys.webp}`,
          fileSize: processed.meta.fileSize,
        });

        results.push(photo);
        updateFile(item.file, { status: 'done', progress: 100, result: photo });
      } catch (err) {
        updateFile(item.file, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    }

    setUploading(false);
    if (results.length) onComplete(results);
  }

  const pendingCount = files.filter((f) => f.status === 'pending').length;

  return (
    <div>
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        className={`border-2 border-dashed rounded-lg p-12 text-center mb-6 transition-colors ${
          dragging ? 'border-white/30 bg-white/5' : 'border-white/10'
        }`}
      >
        <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
          Drag & drop JPEG photos here
        </p>
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>or</p>
        <label className="cursor-pointer px-4 py-2 rounded text-sm"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          Browse files
          <input
            type="file" accept=".jpg,.jpeg" multiple className="hidden"
            onChange={handleInputChange}
          />
        </label>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2 mb-6 max-h-96 overflow-y-auto">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <img src={f.preview} alt="" className="w-10 h-10 object-cover rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate mb-1" style={{ fontFamily: 'var(--font-dm-mono)' }}>{f.file.name}</p>
                {(f.status === 'processing' || f.status === 'uploading') && (
                  <>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                      <div className="h-full bg-white/60 transition-all" style={{ width: `${f.progress}%` }} />
                    </div>
                    {f.statusText && (
                      <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{f.statusText}</p>
                    )}
                  </>
                )}
                {f.status === 'error' && (
                  <p className="text-xs text-red-400">{f.error}</p>
                )}
              </div>
              <span className={`text-xs ${
                f.status === 'done' ? 'text-green-400' :
                f.status === 'error' ? 'text-red-400' :
                (f.status === 'processing' || f.status === 'uploading') ? 'text-white/40' :
                'text-white/25'
              }`}>
                {f.status === 'done' ? '✓' : f.status === 'error' ? '✗' : (f.status === 'processing' || f.status === 'uploading') ? '…' : '○'}
              </span>
            </div>
          ))}
        </div>
      )}

      {pendingCount > 0 && (
        <button
          onClick={uploadAll}
          disabled={uploading || !workerUrl}
          className="px-5 py-2.5 rounded text-sm font-medium"
          style={{ background: 'var(--accent)', color: '#0a0a0a' }}
        >
          {uploading ? 'Uploading…' : `Upload ${pendingCount} photo${pendingCount !== 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
}
