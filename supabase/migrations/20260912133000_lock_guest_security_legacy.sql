-- Final guest-security lockdown. Apply only after the customer bundle and the
-- hardened send-order-push Edge Function are deployed.

-- Phone alone must never be able to bind a browser push endpoint to another
-- customer. Order-scoped subscriptions use an access token instead.
revoke execute on function public.upsert_customer_push_subscription(text,text,text,text)
  from public, anon, authenticated;

-- Order code alone exposed status/notes. Cross-device lookup now requires the
-- matching customer phone and returns status-only information.
revoke execute on function public.get_order_by_number(uuid,text)
  from public, anon, authenticated;

-- Rating identity must come from a completed order token, never typed phone.
revoke execute on function public.submit_store_rating(text,text,numeric,text[])
  from public, anon, authenticated;

-- Old phone-bound push rows are test data and are deliberately discarded.
-- The live sender uses customer_order_push_subscriptions after this rollout.
delete from public.customer_push_subscriptions;
revoke all on table public.customer_push_subscriptions from anon, authenticated;
