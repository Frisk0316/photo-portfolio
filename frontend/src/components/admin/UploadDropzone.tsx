'use client';

import { useCallback, useState } from 'react';
import { upload as uploadApi } from '@/lib/api';
import type { Photo } from '@/lib/api';

interface UploadFile {
  file: File;
  preview: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
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

  const addFiles = useCallback((incoming: File[]) => {
    const jpgs = incoming.filter((f) => /\.(jpe?g)$/i.test(f.name));
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

  async function uploadAll() {
    const pending = files.filter((f) => f.status === 'pending');
    if (!pending.length) return;
    setUploading(true);

    const results: Photo[] = [];

    for (const item of pending) {
      // Mark uploading
      setFiles((prev) => prev.map((f) =>
        f.file === item.file ? { ...f, status: 'uploading', progress: 10 } : f
      ));

      try {
        setFiles((prev) => prev.map((f) => f.file === item.file ? { ...f, progress: 30 } : f));

        // Upload file to backend, which handles R2 upload + processing
        const { data: photo } = await uploadApi.process(albumId, albumSlug, item.file.name, item.file);

        setFiles((prev) => prev.map((f) => f.file === item.file ? { ...f, progress: 90 } : f));

        results.push(photo);
        setFiles((prev) => prev.map((f) =>
          f.file === item.file ? { ...f, status: 'done', progress: 100, result: photo } : f
        ));
      } catch (err) {
        setFiles((prev) => prev.map((f) =>
          f.file === item.file
            ? { ...f, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
            : f
        ));
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
                {f.status === 'uploading' && (
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                    <div className="h-full bg-white/60 transition-all" style={{ width: `${f.progress}%` }} />
                  </div>
                )}
                {f.status === 'error' && (
                  <p className="text-xs text-red-400">{f.error}</p>
                )}
              </div>
              <span className={`text-xs ${
                f.status === 'done' ? 'text-green-400' :
                f.status === 'error' ? 'text-red-400' :
                f.status === 'uploading' ? 'text-white/40' :
                'text-white/25'
              }`}>
                {f.status === 'done' ? '✓' : f.status === 'error' ? '✗' : f.status === 'uploading' ? '…' : '○'}
              </span>
            </div>
          ))}
        </div>
      )}

      {pendingCount > 0 && (
        <button
          onClick={uploadAll}
          disabled={uploading}
          className="px-5 py-2.5 rounded text-sm font-medium"
          style={{ background: 'var(--accent)', color: '#0a0a0a' }}
        >
          {uploading ? 'Uploading…' : `Upload ${pendingCount} photo${pendingCount !== 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
}
