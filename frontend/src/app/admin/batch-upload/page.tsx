'use client';

import { useState, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/useToast';

interface ScannedPhoto {
  fileName: string;
  absolutePath: string;
  sortOrder: number;
}

interface ScannedAlbum {
  folderName: string;
  title: string;
  albumTitle: string;
  date: string;
  slug: string;
  editedPath: string;
  photoCount: number;
  photos: ScannedPhoto[];
  selected?: boolean;
}

interface ScanResult {
  albums: ScannedAlbum[];
  skipped: { name: string; reason: string }[];
  errors: string[];
}

type UploadStatus = 'idle' | 'scanning' | 'scanned' | 'uploading' | 'complete';

interface ProgressInfo {
  currentAlbum: string;
  albumIndex: number;
  albumTotal: number;
  photoIndex: number;
  photoTotal: number;
  fileName: string;
  photoStatus: string;
  uploaded: number;
  failed: number;
  skipped: number;
}

const API_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:4000'
  : '';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('admin_token');
}

export default function BatchUploadPage() {
  const [rootDir, setRootDir] = useState('');
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [albums, setAlbums] = useState<ScannedAlbum[]>([]);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [summary, setSummary] = useState<{ uploaded: number; failed: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { showSuccess, showError } = useToast();

  const handleScan = useCallback(async () => {
    if (!rootDir.trim()) { showError('請輸入資料夾路徑'); return; }
    setStatus('scanning');
    setScanResult(null);
    setAlbums([]);
    setSummary(null);

    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/batch-upload/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rootDir: rootDir.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      const result = json.data as ScanResult;
      setScanResult(result);
      setAlbums(result.albums.map(a => ({ ...a, selected: true })));
      setStatus('scanned');

      if (result.albums.length === 0) {
        showError('未找到符合格式的相簿資料夾');
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '掃描失敗');
      setStatus('idle');
    }
  }, [rootDir, showError]);

  const toggleAlbum = useCallback((index: number) => {
    setAlbums(prev => prev.map((a, i) => i === index ? { ...a, selected: !a.selected } : a));
  }, []);

  const toggleAll = useCallback((selected: boolean) => {
    setAlbums(prev => prev.map(a => ({ ...a, selected })));
  }, []);

  const handleUpload = useCallback(async () => {
    const selected = albums.filter(a => a.selected);
    if (selected.length === 0) { showError('請選擇至少一個相簿'); return; }

    setStatus('uploading');
    setProgress({ currentAlbum: '', albumIndex: 0, albumTotal: selected.length, photoIndex: 0, photoTotal: 0, fileName: '', photoStatus: '', uploaded: 0, failed: 0, skipped: 0 });

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/batch-upload/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ albums: selected }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Parse SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let uploaded = 0;
      let failed = 0;
      let skipped = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let eventName = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith('data: ') && eventName) {
              try {
                const data = JSON.parse(line.slice(6));

                if (eventName === 'album_start') {
                  setProgress(prev => prev ? {
                    ...prev,
                    currentAlbum: data.title,
                    albumIndex: data.index,
                    albumTotal: data.total,
                    photoTotal: data.photoCount,
                    photoIndex: 0,
                  } : prev);
                } else if (eventName === 'photo_progress') {
                  if (data.status === 'done') uploaded++;
                  else if (data.status === 'error') failed++;
                  else if (data.status === 'skipped') skipped++;

                  setProgress(prev => prev ? {
                    ...prev,
                    photoIndex: data.photoIndex + 1,
                    fileName: data.fileName,
                    photoStatus: data.status,
                    uploaded,
                    failed,
                    skipped,
                  } : prev);
                } else if (eventName === 'complete') {
                  setSummary({ uploaded: data.uploaded, failed: data.failed });
                  setStatus('complete');
                  showSuccess(`上傳完成！成功 ${data.uploaded} 張，失敗 ${data.failed} 張`);
                } else if (eventName === 'error') {
                  showError(data.message);
                }
              } catch { /* ignore parse errors */ }
              eventName = '';
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        showError(err instanceof Error ? err.message : '上傳失敗');
      }
      setStatus('scanned');
    }
  }, [albums, showError, showSuccess]);

  const inputClass = 'w-full px-3 py-2 rounded text-sm outline-none focus:ring-1 focus:ring-white/20';
  const inputStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' };

  const selectedCount = albums.filter(a => a.selected).length;
  const totalPhotos = albums.filter(a => a.selected).reduce((sum, a) => sum + a.photoCount, 0);

  return (
    <div>
      <h1 className="text-2xl mb-8" style={{ fontFamily: 'var(--font-playfair)' }}>Batch Upload</h1>

      {/* Scan section */}
      <div className="mb-8">
        <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          根目錄路徑（包含照片資料夾的硬碟路徑）
        </label>
        <div className="flex gap-3">
          <input
            type="text"
            value={rootDir}
            onChange={(e) => setRootDir(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleScan(); }}
            placeholder="例如: D:\Photos\2026"
            className={`${inputClass} flex-1 max-w-xl`}
            style={{ ...inputStyle, fontFamily: 'var(--font-dm-mono)' }}
            disabled={status === 'scanning' || status === 'uploading'}
          />
          <button
            onClick={handleScan}
            disabled={status === 'scanning' || status === 'uploading'}
            className="px-5 py-2 rounded text-sm font-medium shrink-0"
            style={{ background: 'var(--accent)', color: '#0a0a0a' }}
          >
            {status === 'scanning' ? '掃描中…' : '掃描'}
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
          系統將自動尋找「YYYYMMDD - 標題」格式的資料夾，並讀取其中的「調整後 JPG」子資料夾
        </p>
      </div>

      {/* Scan results */}
      {scanResult && albums.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              找到 {albums.length} 個相簿，共 {albums.reduce((s, a) => s + a.photoCount, 0)} 張照片
            </h2>
            <div className="flex gap-2">
              <button onClick={() => toggleAll(true)} className="text-xs text-white/40 hover:text-white">全選</button>
              <button onClick={() => toggleAll(false)} className="text-xs text-white/40 hover:text-white">全不選</button>
            </div>
          </div>

          <div className="rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                  <th className="py-3 px-4 w-8"></th>
                  <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>資料夾</th>
                  <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>日期</th>
                  <th className="py-3 px-4 text-left text-xs" style={{ color: 'var(--text-tertiary)' }}>標題</th>
                  <th className="py-3 px-4 text-right text-xs" style={{ color: 'var(--text-tertiary)' }}>照片數</th>
                </tr>
              </thead>
              <tbody>
                {albums.map((album, i) => (
                  <tr
                    key={album.folderName}
                    className="transition-colors hover:bg-white/[0.02]"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={album.selected || false}
                        onChange={() => toggleAlbum(i)}
                        className="w-4 h-4 rounded"
                        disabled={status === 'uploading'}
                      />
                    </td>
                    <td className="py-3 px-4 text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
                      {album.folderName}
                    </td>
                    <td className="py-3 px-4 text-xs" style={{ fontFamily: 'var(--font-dm-mono)' }}>
                      {album.date}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {album.albumTitle}
                    </td>
                    <td className="py-3 px-4 text-xs text-right" style={{ fontFamily: 'var(--font-dm-mono)' }}>
                      {album.photoCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Skipped folders */}
      {scanResult && scanResult.skipped.length > 0 && (
        <div className="mb-8">
          <details>
            <summary className="text-xs cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>
              已跳過 {scanResult.skipped.length} 個資料夾
            </summary>
            <div className="mt-2 space-y-1">
              {scanResult.skipped.map((s, i) => (
                <p key={i} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {s.name} — {s.reason}
                </p>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Upload button */}
      {status === 'scanned' && selectedCount > 0 && (
        <button
          onClick={handleUpload}
          className="px-5 py-2.5 rounded text-sm font-medium"
          style={{ background: 'var(--accent)', color: '#0a0a0a' }}
        >
          開始上傳 {selectedCount} 個相簿（{totalPhotos} 張照片）
        </button>
      )}

      {/* Progress */}
      {status === 'uploading' && progress && (
        <div className="rounded p-6 space-y-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <p className="text-sm">上傳中…</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
              相簿 {progress.albumIndex + 1}/{progress.albumTotal}
            </p>
          </div>

          <div>
            <p className="text-sm mb-1">{progress.currentAlbum}</p>
            <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
              {progress.fileName} — {progress.photoStatus === 'processing' ? '處理中' : progress.photoStatus === 'uploading' ? '上傳中' : progress.photoStatus === 'done' ? '完成' : progress.photoStatus === 'skipped' ? '已跳過' : progress.photoStatus === 'error' ? '錯誤' : ''}
            </p>

            {/* Progress bar */}
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progress.photoTotal > 0 ? (progress.photoIndex / progress.photoTotal) * 100 : 0}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
          </div>

          <div className="flex gap-6 text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-dm-mono)' }}>
            <span>成功: {progress.uploaded}</span>
            <span>跳過: {progress.skipped}</span>
            <span>失敗: {progress.failed}</span>
          </div>
        </div>
      )}

      {/* Summary */}
      {status === 'complete' && summary && (
        <div className="rounded p-6" style={{ background: 'var(--bg-surface)', border: '1px solid rgba(74,222,128,0.3)' }}>
          <p className="text-sm mb-2" style={{ color: 'rgb(74,222,128)' }}>上傳完成</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-dm-mono)' }}>
            成功上傳 {summary.uploaded} 張照片
            {summary.failed > 0 && <span className="text-red-400">，失敗 {summary.failed} 張</span>}
          </p>
          <button
            onClick={() => { setStatus('idle'); setScanResult(null); setAlbums([]); setSummary(null); }}
            className="mt-4 px-4 py-2 rounded text-xs"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            重新掃描
          </button>
        </div>
      )}
    </div>
  );
}
