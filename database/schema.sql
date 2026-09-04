-- Base de datos de Mititoys coleccionables
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  product_id TEXT NOT NULL,
  product_title TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ARS',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','processing','shipped','delivered','cancelled','refunded')),
  payment_id TEXT,
  payment_status TEXT,
  payment_status_detail TEXT,
  external_reference TEXT NOT NULL UNIQUE,
  preference_id TEXT,
  shipping_status TEXT NOT NULL DEFAULT 'not_shipped' CHECK (shipping_status IN ('not_shipped','preparing','shipped','delivered')),
  tracking_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id);
CREATE INDEX IF NOT EXISTS idx_events_order_id ON order_events(order_id);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customers_touch_updated_at ON customers;
CREATE TRIGGER customers_touch_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS orders_touch_updated_at ON orders;
CREATE TRIGGER orders_touch_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Extensiones de logística. La migración completa y compatible con instalaciones
-- existentes está en database/migrations/20260904_professional_shipping.sql.
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(8,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS package_length_cm NUMERIC(8,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS package_width_cm NUMERIC(8,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS package_height_cm NUMERIC(8,2);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_provider TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_carrier_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_service TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_estimated_hours INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_province TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_quote_id TEXT;

CREATE TABLE IF NOT EXISTS shipping_quotes (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  cart_hash TEXT NOT NULL,
  destination_postal_code TEXT NOT NULL,
  destination_province TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  carrier_name TEXT NOT NULL,
  service_code TEXT,
  service_name TEXT,
  dispatch_mode TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'ARS',
  estimated_hours INTEGER,
  package_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipping_quotes_expires_at ON shipping_quotes(expires_at);
