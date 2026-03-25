import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

const pool = new Pool({ connectionString: config.databaseUrl });

pool.on('error', (err) => {
  process.stderr.write(`Unexpected DB error: ${err.message}\n`);
});

export default pool;
