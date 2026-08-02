-- Prevents duplicate orders when a client retries after a dropped response
-- (the actual cause of the SF-787073 duplicate found in production data).
-- If an order with this store_id + order_number already exists, return its
-- existing id instead of inserting a second copy.
CREATE OR REPLACE FUNCTION public.place_order_atomic(
  p_store_id text, p_customer_name text, p_customer_phone text,
  p_order_number text, p_status text, p_subtotal numeric, p_total numeric,
  p_notes text, p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order_id uuid;
  v_item jsonb;
BEGIN
  SELECT id INTO v_order_id
  FROM public.orders
  WHERE store_id = p_store_id::uuid AND order_number = p_order_number
  LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    RETURN v_order_id;
  END IF;

  INSERT INTO public.orders (store_id, customer_name, customer_phone, order_number, status, subtotal, total, notes, status_history)
  VALUES (
    p_store_id::uuid, p_customer_name, p_customer_phone, p_order_number, p_status, p_subtotal, p_total, p_notes,
    jsonb_build_array(jsonb_build_object('status', p_status, 'at', now()))
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.order_items (order_id, product_id, quantity, price, subtotal)
    VALUES (
      v_order_id,
      (v_item->>'product_id')::text,
      (v_item->>'quantity')::integer,
      (v_item->>'price')::numeric,
      (v_item->>'subtotal')::numeric
    );
  END LOOP;

  RETURN v_order_id;
END;
$function$;
