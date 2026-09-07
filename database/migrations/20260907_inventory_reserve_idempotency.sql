CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_one_reserve_per_order_product
ON public.inventory_movements (order_id, product_id, movement_type)
WHERE order_id IS NOT NULL AND movement_type = 'reserve';
