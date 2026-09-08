-- A Mercado Pago payment must belong to at most one Miti Toys order.
-- NULL remains allowed for orders that have not received a provider payment yet.

CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_id_unique
  ON public.orders (payment_id)
  WHERE payment_id IS NOT NULL;
