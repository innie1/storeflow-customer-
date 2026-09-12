-- The order push Edge Function is called by pg_net database triggers, so it
-- cannot use a normal end-user JWT. Give those internal calls a random secret
-- stored encrypted in Supabase Vault and expose only a service-role verifier.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'storeflow_order_push_internal') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'storeflow_order_push_internal',
      'Authenticates orders-table pg_net calls to the send-order-push Edge Function'
    );
  end if;
end
$$;

create or replace function public.verify_order_push_internal_secret(p_secret text)
returns boolean
language sql
security definer
set search_path = public, vault
as $$
  select exists (
    select 1
    from vault.decrypted_secrets s
    where s.name = 'storeflow_order_push_internal'
      and s.decrypted_secret = p_secret
  );
$$;

revoke all on function public.verify_order_push_internal_secret(text) from public, anon, authenticated;
grant execute on function public.verify_order_push_internal_secret(text) to service_role;

create or replace function public.trigger_send_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'storeflow_order_push_internal'
  limit 1;

  if v_secret is null then
    raise warning 'trigger_send_order_push: internal push secret missing';
    return new;
  end if;

  perform net.http_post(
    url := 'https://jawfalghkftldvkopuaw.supabase.co/functions/v1/send-order-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-storeflow-internal-secret', v_secret
    ),
    body := jsonb_build_object(
      'order_id', new.id,
      'event', 'new_order'
    )
  );
  return new;
exception when others then
  raise warning 'trigger_send_order_push failed: %', sqlerrm;
  return new;
end;
$$;

create or replace function public.trigger_send_customer_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  if new.status is distinct from old.status then
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'storeflow_order_push_internal'
    limit 1;

    if v_secret is null then
      raise warning 'trigger_send_customer_order_push: internal push secret missing';
      return new;
    end if;

    perform net.http_post(
      url := 'https://jawfalghkftldvkopuaw.supabase.co/functions/v1/send-order-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-storeflow-internal-secret', v_secret
      ),
      body := jsonb_build_object(
        'order_id', new.id,
        'event', 'status_update'
      )
    );
  end if;
  return new;
exception when others then
  raise warning 'trigger_send_customer_order_push failed: %', sqlerrm;
  return new;
end;
$$;
