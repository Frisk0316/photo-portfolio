import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './services/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const files = await fs.readdir(MIGRATIONS_DIR);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

    for (const file of sqlFiles) {
      const applied = await client.query('SELECT id FROM _migrations WHERE filename = $1', [file]);
      if (applied.rows.length > 0) {
        process.stdout.write(`  Skip: ${file} (already applied)\n`);
        continue;
      }
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        process.stdout.write(`  Applied: ${file}\n`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
    process.stdout.write('Migrations complete.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(err => {
  process.stderr.write(`Migration error: ${err.message}\n`);
  process.exit(1);
});
