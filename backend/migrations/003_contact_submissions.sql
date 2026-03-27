CREATE TABLE IF NOT EXISTS contact_submissions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(300) NOT NULL,
  phone VARCHAR(50),
  inquiry_type VARCHAR(100),
  message TEXT NOT NULL,
  locale VARCHAR(10) DEFAULT 'zh',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_read BOOLEAN DEFAULT false
);
