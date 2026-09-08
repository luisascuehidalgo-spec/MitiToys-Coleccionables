-- Ensure one Mercado Pago preference and one Enviopack shipment
-- can belong to at most one Miti Toys order.

CREATE UNIQUE INDEX IF NOT EXISTS orders_preference_id_unique
ON public.orders (preference_id)
WHERE preference_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_enviopack_shipment_id_unique
ON public.orders (enviopack_shipment_id)
WHERE enviopack_shipment_id IS NOT NULL;
