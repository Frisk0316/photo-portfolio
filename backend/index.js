import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import categoriesRoutes from './routes/categories.js';
import albumsRoutes from './routes/albums.js';
import photosRoutes from './routes/photos.js';
import uploadRoutes from './routes/upload.js';
import batchUploadRoutes from './routes/batch-upload.js';

const app = express();

// CORS
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(null, false);
  },
}));

app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/albums', albumsRoutes);
app.use('/api/photos', photosRoutes);
app.use('/api', photosRoutes); // also handles /api/albums/:albumId/photos
app.use('/api/upload', uploadRoutes);
app.use('/api/batch-upload', batchUploadRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || 'Internal server error');
  res.status(500).json({ error: message });
});

app.listen(config.port, () => {
  process.stdout.write(`Backend listening on port ${config.port}\n`);
});

export default app;
