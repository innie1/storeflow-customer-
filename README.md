# StoreFlow Customer

The customer-facing storefront for StoreFlow: scan a merchant's QR code, browse
their catalog, and place an order — no account required.

It is a React + TypeScript PWA (Vite, Tailwind v4) talking to Supabase, built
mobile-first and offline-tolerant: catalogs, cart and order state are cached per
store in `localStorage`, and orders placed without a connection are queued and
replayed when one returns.

## Running it

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b` then a production build |
| `npm test` | Regression suite (see below) |
| `npm run lint` | oxlint |
| `npm run preview` | Serve the production build |

## How a store is resolved

Everything a customer can scan, paste or deep-link goes through one path:

1. `src/router.ts` parses the URL or scanned payload — StoreFlow's obfuscated QR
   format, a `/s/:code` link, a `?storeId=` query, an `SF-` code, or a bare
   access code.
2. `src/utils/storeResolver.ts` resolves that reference against the
   `get_public_storefront` / `list_public_storefronts` RPCs. These are the only
   supported entry points; the `stores_public` view is not queried directly.
3. `resolveStoreProducts` in `src/App.tsx` reads the catalog from either
   `stores.data.products` (JSONB — how most merchants store it) or the
   relational `products` table, and merges in `businessTemplate.offerings` for
   service businesses.

## Merchant settings are the source of truth

Anything a customer is shown or charged comes from the merchant's
`data.marketplaceSettings`, never from a default invented by this app. Delivery
fees, free-delivery thresholds, online discounts and minimum orders all flow
through `src/utils/orderPricing.ts`, which is the single place order totals are
computed — the cart, the checkout summary and the submitted order all call it,
so what a customer is quoted cannot drift from what they are billed.

Where a merchant has published nothing, the app says nothing. It does not fill
in a placeholder delivery time, distance, bank account or wallet number.

## Tests

`npm test` runs `scripts/test-*.mjs` under `node:assert`. Most of these are
source assertions — they read `src/App.tsx` as text and check that a previously
fixed bug has not been re-introduced. `test-order-pricing.mjs` is a real
behavioural test that imports and exercises `src/utils/orderPricing.ts`.

There is no test runner and no component tests; adding either would be a
worthwhile next step.

## Notes for anyone working here

- `src/App.tsx` is ~7,000 lines and holds nearly every screen in one component.
  Splitting screens out is the single highest-value refactor available.
- The scanner runs `@zxing/library` + `jsQR` in `src/workers/scanner.worker.ts`.
  The main-thread loop in `App.tsx` throttles frame analysis and only writes to
  React state when the on-screen hint actually changes — keep it that way, since
  a `setState` per frame re-renders the whole app while the camera is open.
- Font stylesheets are imported from `src/index.css` into the `base` cascade
  layer, above `@import "tailwindcss"`. Both details matter; see the comment
  there before moving them back into `index.html`.
- `downloads/` holds design mockups and an old snapshot of `App.tsx`. It is not
  built or linted.
