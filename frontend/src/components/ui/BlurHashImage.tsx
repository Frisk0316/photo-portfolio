'use client';

import { useEffect, useRef } from 'react';
import { decode } from 'blurhash';

interface BlurHashImageProps {
  hash: string;
  width?: number;
  height?: number;
  className?: string;
}

export default function BlurHashImage({
  hash,
  width = 32,
  height = 32,
  className = '',
}: BlurHashImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hash) return;

    try {
      const pixels = decode(hash, width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
    } catch {
      // silently ignore decode errors
    }
  }, [hash, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ imageRendering: 'auto' }}
    />
  );
}
