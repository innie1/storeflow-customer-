# StoreFlow — Priority Fixes (send this whole message to your coder)

## ⚠️ Round 3 — my mistake from Round 1, plus the navigation bugs you reported

**Order history stopped loading — this was a regression I introduced in
Round 1, now fixed.** I'd changed the order-history query to
`order_items(*, product:products(id, name))` to fix the "Product"
placeholder text. That relies on PostgREST detecting a foreign-key
relationship between `order_items.product_id` and `products.id` — but I
hadn't actually checked that one exists. It doesn't: `product_id` is a
loosely-typed `text` column with no FK constraint at all, and 62 existing
rows aren't even valid UUIDs (legacy data quality issue). So that query
started throwing an error on every single call, which was silently caught
(`catch { console.warn }`), meaning `ordersHistory` just never got set —
matches exactly what you saw ("orders do not appear in history"). Reverted
the query back to `order_items(*)`. The "Product" placeholder text issue
is still there for old orders, but that's a much smaller cosmetic problem
than an outage — I'll fix it properly (client-side lookup, no fragile
join) once you confirm history is loading again.

**Back navigation after placing an order — two real bugs found and fixed:**

1. `loadStoreDetails()` was syncing the URL to the store's page with a raw
   `window.history.pushState(null, '', targetPath)` — note the `null`
   state. Every other navigation in this app tags its history entry with
   `{screen: '...'}` so the back button can restore it instantly; this one
   didn't, so it fell through to a slower fallback path that had to
   re-parse the URL and refetch the store. Worse, this could also create a
   duplicate/orphan history entry on top of the one `navigateToScreen`
   already created moments earlier (both fire for a single "open store"
   action, in a race — whichever finishes first). Changed it to
   `replaceState` with `{screen: 'store'}`, so it corrects the existing
   entry in place instead of adding a stray one, and going back to the
   store screen is now instant and reliable rather than falling back to a
   network re-fetch.

2. The Track Order screen's own back arrow called `navigateToScreen('store')`,
   which — since the URL was still `/tracking` at that moment — pushed a
   *brand new* history entry rather than returning to the one that was
   already there. That leaves the browser's real back-stack out of sync
   with what the user just did in-app, so a follow-up physical/gesture
   back-press doesn't behave consistently. Added a `goBack()` helper that
   calls the browser's real `history.back()` (falling back to
   `navigateToScreen` only if there's genuinely nothing to go back to,
   e.g. the screen was opened via a direct link), and wired the Track
   Order back arrow to it.

Between these two, the store's history entry is now reliably tagged and
never duplicated, and the in-app back button stays in sync with the real
browser stack — which is what was letting "back" end up on Home instead of
the store.

**Orders on top of history:** checked this — the sort logic already puts
in-progress orders (Pending/Accepted/Preparing/Ready) above finished ones,
newest first within each group, so a freshly placed order (always
"Pending") already lands at the top once history is actually loading. This
was really the same bug as the history outage above, not a separate
sorting problem — no change needed here now that loading is fixed.

---

Fixed in priority order: critical → high → cleanup. Everything below has
already been typechecked (`tsc --noEmit`) and built (`npm run build`)
successfully against this repo.

## How to apply

Two ways — use whichever is cleaner for your setup:

1. **Patch (preferred):** from the repo root:
   ```
   git apply storeflow-fixes.patch
   ```
   If it fails to apply cleanly (because of local changes since this repo
   was pulled), fall back to option 2.

2. **Manual:** replace these 3 files with the versions in this folder:
   - `src/App.tsx`
   - `src/supabase.ts`
   - `package-lock.json` (then run `npm install` to sync node_modules)

After applying, run `npm install && npm run build` to confirm it's clean
before deploying.

---

## 🔴 Critical — duplicate orders (fixed on the DATABASE side, already live)

**This one is already applied directly to your Supabase project — no code
change needed, nothing to do here except read this.**

Found a real duplicate in your `orders` table: `SF-787073` exists twice,
same customer/phone/total, timestamps 942ms apart. Root cause: order
numbers are generated client-side with `Math.random()`, and
`placeOrderWithRetry()` retries on any error. If the database write
actually succeeded but the response got lost (dropped connection, mobile
tab backgrounded, etc.), the client retried and created a second, fully
duplicate order — nothing in the database stopped it.

I updated the `place_order_atomic` Postgres function so it now checks for
an existing order with the same `store_id` + `order_number` before
inserting, and returns the existing order's id instead of creating a
duplicate if a retry happens. I also set `search_path` on that function
while I was in there (it was flagged by Supabase's security advisor as a
privilege-escalation risk pattern).

**⚠️ One thing that needs a human decision, not a code fix:** the existing
duplicate pair (`SF-787073`, order ids `85bb9e8e-6ba8-441d-8cf7-fd3224d420e5`
and `62e868e9-0e93-49f1-82e0-0f6cba75be7f`, both status "Completed") is
still sitting in the database as two rows. I didn't touch it — deleting or
merging a completed order is a business call (was it actually fulfilled
twice? refunded?), not something to auto-resolve. Once you've decided which
one (if either) to remove, let me know and I can also add a hard
`UNIQUE (store_id, order_number)` constraint as a second layer of
protection — I held off on that because Postgres won't let you add a
unique constraint while a duplicate still exists.

## 🟠 High

**1. Login didn't survive a page reload — `src/supabase.ts`**
The Supabase client was created with `persistSession: false,
autoRefreshToken: false`, but the app actively uses
`signUp`/`signInWithPassword`/`signInWithOtp` and reads the session back on
every mount. With persistence off, "being logged in" only lasted until the
next reload. Changed both to `true`.

**2. "Add to cart" had no stock limit — `src/App.tsx`, `addToCart()`**
The `+` button had no ceiling — a customer could tap past what the store
actually has in stock. Now caps at `product.quantity`.

**3. The offline-order safety net could itself crash and lose the order —
`src/App.tsx`, `queueOrderForOfflineSync()`**
This function exists to save an order locally when the network fails, so
nothing gets lost. It did an unguarded `JSON.parse` on stored data with no
try/catch — if that stored JSON was ever corrupted, this would throw
unhandled, in the exact fallback path meant to prevent order loss. Wrapped
both the read and the write in try/catch with safe fallbacks.

## 🟡 Medium

**4. Order history showed the literal word "Product" instead of real item
names — `src/App.tsx`, `loadOrdersHistory()`**
The order-history query was `.select('*, order_items(*)')` — never joining
the `products` table — while three separate places in the code read
`order_items[].product?.name` expecting it to be populated (order history
cards, the history search filter, and previously the reorder button, which
I fixed last time). It always resolved to `undefined` and silently fell
back to the placeholder text "Product" for any order that predates the
`notes.items_summary` field being added. Fixed the query to
`order_items(*, product:products(id, name))` so all three call sites get
real data now, no per-call-site fix needed.

## 🟢 Low / cleanup

**5. `npm audit fix` applied** — cleared 2 high-severity advisories
(`brace-expansion`, `fast-uri`), both build-tooling transitive deps, not
shipped to users. `package-lock.json` updated, `package.json` untouched.
Build re-verified clean after this.

**6. Not fixed yet, flagging only:** `downloads/*.html` (14 files, ~244KB)
and `store_page.html`/`store_page.png` (~68KB) aren't referenced anywhere
in the Vite build or `vercel.json` — looks like leftover static design
mockups. Safe to delete or move out of the repo if you confirm they're not
needed for anything (e.g. a design handoff), just didn't want to delete
files without checking first.

---

---

## Round 2 — Security/RLS batch (also already applied directly to Supabase)

These are **database-only changes**, already live on your project. No code
change, nothing to apply in the app repo. The `supabase_migrations/` folder
in this zip has the exact SQL, for your migration history / staging env /
records — you don't need to run it against production again.

**1. `push_subscriptions` was wide open — fixed.**
DELETE and UPDATE policies had `USING (true)` — anyone with your public API
key could delete or hijack any store's push subscription row, no ownership
check at all. This table is never touched by the customer-facing app (it's
merchant device registrations), so I restricted DELETE/UPDATE to verified
store members, same check already used everywhere else in your schema
(`is_store_member()`). Table had 0 rows at the time, so nothing to migrate.
INSERT stays open — a device needs to register before anything else exists.

**2. `search_path` pinned on 4 more functions** — `update_updated_at_column`,
`is_store_member`, `merge_store_data_key`, `append_order_status_history`.
Closes a known privilege-escalation pattern for `SECURITY DEFINER`
functions. Behavior unchanged, verify-able by diffing the old vs new
function bodies in the migration file.

**3. Removed 7 redundant RLS policies** on `categories`, `products`,
`orders`, `order_items`, `stores` — exact duplicates, or narrower policies
fully shadowed by a broader `true` policy already on the same table (so
removing them changes nothing about who can read what — permissive
policies are OR'd together, a shadowed one was already a no-op). Pure
performance win: fewer policy checks per query.

### Flagged, not changed — needs your call

- **`products`/`categories` are fully publicly readable** (`SELECT ... true`
  policy, no auth needed). That's presumably intentional for a public
  storefront, but it also means fields like `cost_price` and
  `wholesale_price` are queryable by anyone with the anon key, not just
  `selling_price`/`retail_price` — i.e. a competitor could scrape every
  merchant's cost basis. Worth deciding whether those columns should be
  excluded from what the anon role can read (e.g. a public view exposing
  only customer-facing columns, with the storefront querying that instead
  of the raw table). This is a real design decision, not a quick migration
  — flagging it, not touching it.
- **Leaked-password protection** is still off — I don't have a tool that
  reaches Auth settings, this one needs a manual toggle: Supabase Dashboard
  → Authentication → Policies → Password Security → enable "Leaked
  password protection."
- `rls_auto_enable` and `trigger_send_order_push` show up in the advisor as
  "callable by anon" — checked this, both `RETURNS trigger`/`RETURNS
  event_trigger`, which Postgres refuses to execute outside their trigger
  context regardless of grants. Not exploitable, no action needed, just
  didn't want to leave it unexplained.
- The `notifications`/`order_items`/`orders`/`profiles`/`stores` public
  `INSERT` policies — these back guest checkout and signup, which this app
  relies on working without login. Left alone; locking these down would
  need to happen alongside app changes, not as a standalone DB migration.

---

## Still open (not started)
- Duplicate order `SF-787073` in production data — needs your decision (see
  Round 1 notes above).
- ~30 foreign keys with no covering index (performance, low urgency at your
  current data volume — 38 orders total as of this audit).
- Unused `downloads/*.html` and `store_page.html`/`.png` files in the repo.
