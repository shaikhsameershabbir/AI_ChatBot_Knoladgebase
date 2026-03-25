CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  status VARCHAR(64) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO users (id, email, balance)
VALUES (123, 'demo@example.com', 99.50)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, balance = EXCLUDED.balance;

INSERT INTO orders (user_id, status, amount)
SELECT 123, 'pending', 49.99
WHERE NOT EXISTS (SELECT 1 FROM orders WHERE user_id = 123 LIMIT 1);

SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users));
