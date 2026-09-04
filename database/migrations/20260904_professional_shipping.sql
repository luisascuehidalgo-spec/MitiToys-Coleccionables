-- Envíos profesionales con cotización multi-correo por Envíopack.
-- Compatible con productos y pedidos existentes.

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

UPDATE orders SET subtotal_amount = total_amount WHERE subtotal_amount IS NULL;

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
CREATE INDEX IF NOT EXISTS idx_shipping_quotes_cart_destination ON shipping_quotes(cart_hash,destination_postal_code,destination_province);
