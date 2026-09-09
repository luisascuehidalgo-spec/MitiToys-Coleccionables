CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip_hash text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  window_started_at timestamptz NOT NULL DEFAULT NOW(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
