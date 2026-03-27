import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import categoriesRoutes from './routes/categories.js';
import albumsRoutes from './routes/albums.js';
import photosRoutes from './routes/photos.js';
import uploadRoutes from './routes/upload.js';
import batchUploadRoutes from './routes/batch-upload.js';
import contactRoutes from './routes/contact.js';
import downloadRoutes from './routes/download.js';
import heroRoutes from './routes/hero.js';

const app = express();

// Security headers
app.use(helmet());

// CORS — only allow missing Origin in development (e.g. Postman, curl)
app.use(cors({
  origin: (origin, callback) => {
    if (!origin && config.nodeEnv === 'development') {
      return callback(null, true);
    }
    if (origin && config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(null, false);
  },
}));

// Global rate limit: 200 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/albums', albumsRoutes);
app.use('/api/photos', photosRoutes);
app.use('/api', photosRoutes); // also handles /api/albums/:albumId/photos
app.use('/api/upload', uploadRoutes);
app.use('/api/batch-upload', batchUploadRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/hero-images', heroRoutes);

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
