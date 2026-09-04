-- Professional fulfillment, notifications and verified reviews
-- Applied branch-first in Neon before production.
ALTER TABLE orders
 ADD COLUMN IF NOT EXISTS shipping_destination_type text NOT NULL DEFAULT 'home',
 ADD COLUMN IF NOT EXISTS shipping_locality_id text,
 ADD COLUMN IF NOT EXISTS shipping_street text,
 ADD COLUMN IF NOT EXISTS shipping_number text,
 ADD COLUMN IF NOT EXISTS shipping_floor text,
 ADD COLUMN IF NOT EXISTS shipping_unit text,
 ADD COLUMN IF NOT EXISTS shipping_branch_id text,
 ADD COLUMN IF NOT EXISTS shipping_branch_name text,
 ADD COLUMN IF NOT EXISTS shipping_branch_address text,
 ADD COLUMN IF NOT EXISTS enviopack_order_id text,
 ADD COLUMN IF NOT EXISTS enviopack_shipment_id text,
 ADD COLUMN IF NOT EXISTS enviopack_state text,
 ADD COLUMN IF NOT EXISTS shipping_generation_status text NOT NULL DEFAULT 'not_created',
 ADD COLUMN IF NOT EXISTS shipping_last_error text,
 ADD COLUMN IF NOT EXISTS shipping_label_ready boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS shipping_tracking_url text,
 ADD COLUMN IF NOT EXISTS shipping_created_at timestamptz,
 ADD COLUMN IF NOT EXISTS shipping_last_synced_at timestamptz,
 ADD COLUMN IF NOT EXISTS payment_url text;

ALTER TABLE shipping_quotes
 ADD COLUMN IF NOT EXISTS destination_type text NOT NULL DEFAULT 'home',
 ADD COLUMN IF NOT EXISTS destination_locality_id text,
 ADD COLUMN IF NOT EXISTS destination_locality_name text,
 ADD COLUMN IF NOT EXISTS branch_id text,
 ADD COLUMN IF NOT EXISTS branch_name text,
 ADD COLUMN IF NOT EXISTS branch_address text,
 ADD COLUMN IF NOT EXISTS branch_schedule text;

CREATE TABLE IF NOT EXISTS notifications (
 id bigserial PRIMARY KEY,
 order_id bigint REFERENCES orders(id) ON DELETE CASCADE,
 type text NOT NULL,
 recipient text NOT NULL,
 status text NOT NULL DEFAULT 'pending',
 provider_id text,
 last_error text,
 attempts integer NOT NULL DEFAULT 0,
 idempotency_key text NOT NULL UNIQUE,
 scheduled_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
 id bigserial PRIMARY KEY,
 product_id varchar NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
 review_token text NOT NULL UNIQUE,
 rating integer,
 title varchar(120),
 body text,
 status text NOT NULL DEFAULT 'invited',
 verified_purchase boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 submitted_at timestamptz,
 published_at timestamptz,
 UNIQUE(order_id,product_id),
 CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_orders_enviopack_shipment ON orders(enviopack_shipment_id) WHERE enviopack_shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_shipping_generation ON orders(shipping_generation_status,payment_status);
CREATE INDEX IF NOT EXISTS idx_notifications_status_schedule ON notifications(status,scheduled_at);
CREATE INDEX IF NOT EXISTS idx_reviews_product_published ON reviews(product_id,published_at DESC) WHERE status='published';
