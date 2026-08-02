-- Pins search_path on functions flagged by the Supabase security advisor as
-- "function_search_path_mutable" — a known privilege-escalation vector for
-- SECURITY DEFINER functions in particular. No behavior change.

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_store_member(check_store_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = check_store_id
    AND profile_id = (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.merge_store_data_key(store_id_input uuid, key_input text, value_input jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  UPDATE public.stores
  SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(key_input, value_input),
      updated_at = now()
  WHERE id = store_id_input;
$function$;

CREATE OR REPLACE FUNCTION public.append_order_status_history()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_history = COALESCE(OLD.status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', NEW.status, 'at', now()));
  END IF;
  RETURN NEW;
END;
$function$;
