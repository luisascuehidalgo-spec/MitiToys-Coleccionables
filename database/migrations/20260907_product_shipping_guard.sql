-- Protect Miti Toys product shipping data at the database layer.
--
-- Goals:
-- 1. Never allow a previously valid package weight/dimension to be cleared
--    by an UPDATE that sends NULL, zero, or a negative value.
-- 2. Keep an audit trail of blocked clears and legitimate changes.
--
-- Existing products whose logistics are still NULL are not blocked from
-- receiving valid values later.

CREATE TABLE IF NOT EXISTS public.product_shipping_history (
  id bigserial PRIMARY KEY,
  product_id text NOT NULL,
  event_type text NOT NULL,
  old_weight_kg numeric(8,3),
  old_package_length_cm numeric(8,2),
  old_package_width_cm numeric(8,2),
  old_package_height_cm numeric(8,2),
  new_weight_kg numeric(8,3),
  new_package_length_cm numeric(8,2),
  new_package_width_cm numeric(8,2),
  new_package_height_cm numeric(8,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_shipping_history_product_created_idx
  ON public.product_shipping_history(product_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.protect_product_shipping_data()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempted_weight numeric(8,3) := NEW.weight_kg;
  attempted_length numeric(8,2) := NEW.package_length_cm;
  attempted_width numeric(8,2) := NEW.package_width_cm;
  attempted_height numeric(8,2) := NEW.package_height_cm;
  blocked boolean := false;
BEGIN
  IF OLD.weight_kg IS NOT NULL AND OLD.weight_kg > 0
     AND (NEW.weight_kg IS NULL OR NEW.weight_kg <= 0) THEN
    NEW.weight_kg := OLD.weight_kg;
    blocked := true;
  END IF;

  IF OLD.package_length_cm IS NOT NULL AND OLD.package_length_cm > 0
     AND (NEW.package_length_cm IS NULL OR NEW.package_length_cm <= 0) THEN
    NEW.package_length_cm := OLD.package_length_cm;
    blocked := true;
  END IF;

  IF OLD.package_width_cm IS NOT NULL AND OLD.package_width_cm > 0
     AND (NEW.package_width_cm IS NULL OR NEW.package_width_cm <= 0) THEN
    NEW.package_width_cm := OLD.package_width_cm;
    blocked := true;
  END IF;

  IF OLD.package_height_cm IS NOT NULL AND OLD.package_height_cm > 0
     AND (NEW.package_height_cm IS NULL OR NEW.package_height_cm <= 0) THEN
    NEW.package_height_cm := OLD.package_height_cm;
    blocked := true;
  END IF;

  IF blocked THEN
    INSERT INTO public.product_shipping_history(
      product_id,event_type,
      old_weight_kg,old_package_length_cm,old_package_width_cm,old_package_height_cm,
      new_weight_kg,new_package_length_cm,new_package_width_cm,new_package_height_cm
    ) VALUES (
      OLD.id,'blocked_invalid_clear',
      OLD.weight_kg,OLD.package_length_cm,OLD.package_width_cm,OLD.package_height_cm,
      attempted_weight,attempted_length,attempted_width,attempted_height
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_product_shipping_data()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(OLD.weight_kg,OLD.package_length_cm,OLD.package_width_cm,OLD.package_height_cm)
     IS DISTINCT FROM
     ROW(NEW.weight_kg,NEW.package_length_cm,NEW.package_width_cm,NEW.package_height_cm) THEN
    INSERT INTO public.product_shipping_history(
      product_id,event_type,
      old_weight_kg,old_package_length_cm,old_package_width_cm,old_package_height_cm,
      new_weight_kg,new_package_length_cm,new_package_width_cm,new_package_height_cm
    ) VALUES (
      NEW.id,'changed',
      OLD.weight_kg,OLD.package_length_cm,OLD.package_width_cm,OLD.package_height_cm,
      NEW.weight_kg,NEW.package_length_cm,NEW.package_width_cm,NEW.package_height_cm
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_product_shipping_data ON public.products;
CREATE TRIGGER trg_protect_product_shipping_data
BEFORE UPDATE OF weight_kg, package_length_cm, package_width_cm, package_height_cm
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.protect_product_shipping_data();

DROP TRIGGER IF EXISTS trg_audit_product_shipping_data ON public.products;
CREATE TRIGGER trg_audit_product_shipping_data
AFTER UPDATE OF weight_kg, package_length_cm, package_width_cm, package_height_cm
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.audit_product_shipping_data();
