-- push_subscriptions had DELETE/UPDATE policies with USING (true) — anyone
-- with the public API key could delete or hijack any store's push
-- subscription. Never touched by the customer app; restricting to
-- verified store members, matching every other staff-only table.
DROP POLICY IF EXISTS "Allow public DELETE on push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Store members can DELETE push_subscriptions"
  ON public.push_subscriptions FOR DELETE
  USING (is_store_member(store_id));

DROP POLICY IF EXISTS "Allow public UPSERT-style UPDATE on push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Store members can UPDATE push_subscriptions"
  ON public.push_subscriptions FOR UPDATE
  USING (is_store_member(store_id))
  WITH CHECK (is_store_member(store_id));
