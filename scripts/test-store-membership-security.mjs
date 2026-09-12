import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260912100000_lock_store_membership_inserts.sql';
const sql = readFileSync(migrationPath, 'utf8');

assert.match(sql, /drop policy if exists "Allow INSERT on store_members" on public\.store_members;/i,
  'the legacy self-enrollment policy must be removed');
assert.match(sql, /create policy "Store owners can add members"/i,
  'membership INSERTs must use the owner-authorized policy');
assert.match(sql, /for insert\s+to authenticated/i,
  'membership creation must be limited to authenticated callers');
assert.match(sql, /owner_profile\.auth_user_id\s*=\s*\(select auth\.uid\(\)\)/i,
  'the inserting user must be the target store owner');
assert.match(sql, /s\.id\s*=\s*store_members\.store_id/i,
  'owner authorization must be scoped to the exact target store');
assert.match(sql, /revoke insert on table public\.store_members from anon;/i,
  'anonymous users must not have direct INSERT privilege on store_members');

// Regression guard for the exact vulnerable shape: caller owns profile_id,
// therefore caller may join any store. That condition must never reappear in
// the active INSERT policy.
const activePolicy = sql.match(/create policy "Store owners can add members"([\s\S]*?);\n\n/i)?.[1] || '';
assert.ok(!/profile_id\s*=\s*\(\s*select\s+(?:profiles\.)?id[\s\S]*?auth_user_id\s*=\s*\(\s*select\s+auth\.uid\(\)/i.test(activePolicy),
  'membership policy must not authorize insertion merely because profile_id belongs to the caller');

console.log('Store membership RLS regression checks passed.');
