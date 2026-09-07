-- Guarantee that reserved stock can be released at most once per order/product.
-- This protects against concurrent cancellation paths (webhook, admin and cron).

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_one_release_per_order_product
  ON public.inventory_movements(order_id, product_id, movement_type)
  WHERE order_id IS NOT NULL AND movement_type = 'release';
