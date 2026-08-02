-- Removes exact-duplicate and fully-shadowed permissive SELECT policies
-- (pure performance cleanup, flagged by the advisor — no access change).
DROP POLICY IF EXISTS "Allow public select for categories" ON public.categories;
DROP POLICY IF EXISTS "Allow public select for order_items" ON public.order_items;
DROP POLICY IF EXISTS "Allow public select for orders" ON public.orders;
DROP POLICY IF EXISTS "Allow public select for products" ON public.products;
DROP POLICY IF EXISTS "Allow public select for stores" ON public.stores;
DROP POLICY IF EXISTS "Categories SELECT" ON public.categories;
DROP POLICY IF EXISTS "Products SELECT" ON public.products;
