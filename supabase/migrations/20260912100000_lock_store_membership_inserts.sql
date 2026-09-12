-- Critical security fix: stop authenticated customers from enrolling themselves
-- into arbitrary merchant stores.
--
-- Previous policy allowed INSERT when profile_id belonged to the caller. That
-- proved who the new membership row referred to, but did not prove the caller
-- was authorized to join the target store. Since is_store_member(store_id) is
-- used throughout merchant RLS, self-enrollment could become cross-tenant
-- merchant access.
--
-- New rule: only the actual store owner may create a membership for that
-- store. The owner can still add their own initial membership after the store
-- row has owner_id assigned, and can add staff profiles later.

alter table public.store_members enable row level security;

drop policy if exists "Allow INSERT on store_members" on public.store_members;
drop policy if exists "Store owners can add members" on public.store_members;

create policy "Store owners can add members"
on public.store_members
for insert
to authenticated
with check (
  store_id is not null
  and profile_id is not null
  and exists (
    select 1
    from public.stores s
    join public.profiles owner_profile on owner_profile.id = s.owner_id
    where s.id = store_members.store_id
      and owner_profile.auth_user_id = (select auth.uid())
  )
);

-- RLS is the authorization boundary, but remove the unnecessary anonymous
-- table privilege as defense in depth. Customer-facing flows do not need to
-- write store_members directly.
revoke insert on table public.store_members from anon;
grant insert on table public.store_members to authenticated;

comment on policy "Store owners can add members" on public.store_members is
  'Only the authenticated owner of a store may add membership rows for that store; prevents customer self-enrollment and cross-tenant privilege escalation.';
