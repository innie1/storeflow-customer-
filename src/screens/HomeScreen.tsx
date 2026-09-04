import type { Product, Store } from '../types';
import { computeStoreOpen } from '../lib/storeIdentity';
import StoreBrandMark from '../components/StoreBrandMark';
import ProductImageWithFallback from '../components/ProductImageWithFallback';
import SearchPlaceholderInput from '../components/SearchPlaceholderInput';

/** Discover: the customer's scanned stores plus recommendations. */
export default function HomeScreen({
  selectedAddress,
  searchQuery,
  onSearchChange,
  categories,
  selectedCategory,
  onSelectCategory,
  stores,
  products,
  getPrice,
  onScan,
  onOpenStore,
  onRemoveStore,
  onOpenProduct,
  onAddToCart,
  onOpenLocation,
  onOpenProfile,
  onQuickOrder,
  onInstall,
}: {
  selectedAddress: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  categories: string[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  stores: Store[];
  products: Product[];
  getPrice: (product: Product) => number;
  onScan: () => void;
  onOpenStore: (storeId: string) => void;
  onRemoveStore: (store: { id: string; name: string }) => void;
  onOpenProduct: (product: Product) => void;
  onAddToCart: (product: Product, qty?: number) => void;
  onOpenLocation: () => void;
  onOpenProfile: () => void;
  onQuickOrder: () => void;
  onInstall: (() => void) | null;
}) {
  return (
    <div className="bg-[#F8F9FA] dark:bg-zinc-950 min-h-screen text-[#1A1C1E] dark:text-zinc-100 pb-24">
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md h-16 flex justify-between items-center border-b border-gray-100 dark:border-zinc-800 px-4 md:px-gutter text-[#1A1C1E] dark:text-zinc-100">
        <div className="flex items-center gap-3">
          <button 
            onClick={onOpenProfile} 
            className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-zinc-900 transition-colors rounded-full cursor-pointer text-[#1A1C1E] dark:text-zinc-100"
            aria-label="Open Profile Menu"
            title="Profile Menu"
          >
            <span className="material-symbols-outlined text-xl">menu</span>
          </button>
          <div onClick={onOpenLocation} className="flex flex-col cursor-pointer hover:opacity-85 select-none">
            <span className="text-[9px] font-bold text-gray-400 dark:text-zinc-400 uppercase tracking-wider">Deliver to</span>
            <div className="flex items-center gap-1">
              <span className="text-xs font-black text-[#1A1C1E] dark:text-zinc-100">{selectedAddress}</span>
              <span className="material-symbols-outlined text-gray-400 dark:text-zinc-400 text-base">expand_more</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Left blank or for other menu actions */}
        </div>
      </header>

      <main className="px-4 md:px-8 max-w-5xl lg:max-w-6xl mx-auto mt-4 space-y-8">
        {/* Search Bar */}
        <div className="relative w-full h-14 bg-white dark:bg-zinc-900 rounded-full flex items-center px-4 border border-gray-200 dark:border-zinc-800 focus-within:border-gray-400 dark:focus-within:border-zinc-600 focus-within:ring-2 focus-within:ring-gray-100 dark:focus-within:ring-zinc-800 transition-all shadow-sm">
          <span className="material-symbols-outlined text-gray-400 dark:text-zinc-400 mr-3">search</span>
          <SearchPlaceholderInput
            className="bg-transparent border-none focus:ring-0 focus:outline-none w-full text-sm outline-none text-[#1A1C1E] dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 [&::-webkit-search-cancel-button]:hidden"
            ariaLabel="Search stores and products"
            value={searchQuery}
            onChange={onSearchChange}
          />
          {searchQuery && (
            <button onClick={() => onSearchChange('')} className="mr-2 cursor-pointer text-gray-400 hover:text-black dark:hover:text-white">
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          )}
          <button 
            onClick={onScan} 
            className="w-8 h-8 rounded-full bg-gray-50 dark:bg-zinc-800 flex items-center justify-center text-gray-400 dark:text-zinc-300 hover:text-[#1A1C1E] dark:hover:text-white active:scale-95 transition-all shrink-0 cursor-pointer"
            title="Scan Barcode"
          >
            <span className="material-symbols-outlined text-lg">qr_code_scanner</span>
          </button>
        </div>

        {onInstall && (
          <div className="bg-[#1A1C1E] text-white p-4 rounded-[24px] flex items-center justify-between border border-white/5 shadow-sm">
            <div>
              <h4 className="font-extrabold text-sm text-white">Install StoreFlow App</h4>
              <p className="text-xs text-gray-400 mt-0.5 font-semibold">Access offline shopping directly from your home screen.</p>
            </div>
            <button onClick={onInstall!} className="px-4 py-2 bg-[#FFD23F] text-slate-950 text-xs font-black rounded-full active-scale cursor-pointer">
              Install
            </button>
          </div>
        )}

        {/*
          This slot used to advertise a "Nigeria Grocery Deals" promo
          offering "free delivery and up to 25% off StoreFlow partner
          orders today" — to every customer, on every store, permanently.
          No such promotion exists anywhere in the app: nothing waived a
          delivery fee or applied a discount at checkout. Real per-store
          offers already render from the merchant's own settings in
          renderStorePromotions, so this is now a plain statement of what
          the app does, and the hot-linked Unsplash photo behind it is a
          gradient instead of a 1200px third-party request.
        */}
        <section className="relative w-full aspect-[21/9] rounded-[24px] overflow-hidden shadow-sm bg-gradient-to-br from-[#1A1C1E] via-[#24262a] to-[#3a3227] text-white p-6 flex flex-col justify-center">
          <div className="relative z-20 space-y-1.5 max-w-xs text-left">
            <span className="inline-flex items-center gap-1 bg-[#FFD23F] text-slate-950 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded">
              <span className="material-symbols-outlined text-[11px] leading-none">bolt</span>
              StoreFlow
            </span>
            <h2 className="text-lg md:text-xl font-extrabold text-white">Scan. Order. Collect.</h2>
            <p className="text-[11px] text-gray-200 font-medium leading-relaxed">Order from any StoreFlow shop in under a minute — no account needed.</p>
          </div>
          <span aria-hidden="true" className="material-symbols-outlined absolute -right-4 -bottom-6 text-[140px] leading-none text-white/5 select-none pointer-events-none">storefront</span>
        </section>

        {/* Categories */}
        <section className="text-left">
          <h3 className="text-xs font-black text-gray-400 uppercase px-1 mb-3 tracking-wider">Browse Categories</h3>
          <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 py-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => onSelectCategory(cat)}
                className={`px-5 py-2 rounded-full font-bold text-xs shrink-0 transition-all cursor-pointer shadow-sm ${
                  selectedCategory === cat ? 'bg-[#1A1C1E] text-[#FFD23F] font-black' : 'bg-white border border-gray-100 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </section>

        {/* Your Scanned Stores */}
        <section className="text-left">
          <div className="mb-4">
            <h2 className="text-xl font-black text-[#1A1C1E] font-headline-md tracking-tight">Your Stores</h2>
          </div>

          {stores.length === 0 ? (
            /* Empty state — no stores scanned yet */
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
              {/*
                This used to be a 176px button that a block of !important CSS
                in index.css silently resized to 220px, blanked the QR glyph
                out of (font-size: 0) and repainted as a plain animated
                rectangle — so the one affordance on an empty Home screen
                read as an empty box. The scanner target is expressed here
                now, at a size that keeps the heading above the fold.
              */}
              <button
                onClick={onScan}
                aria-label="Scan a store QR code"
                className="sf-scan-target relative w-36 h-36 bg-white border border-gray-200 rounded-[32px] flex items-center justify-center shadow-sm cursor-pointer active-scale hover:border-amber-300 hover:shadow-md transition-all duration-300 overflow-hidden"
              >
                <span className="material-symbols-outlined text-[84px] leading-none text-[#1A1C1E] select-none pointer-events-none">
                  qr_code_2
                </span>
                <span className="sf-scan-beam pointer-events-none" aria-hidden="true" />
              </button>

              <div className="space-y-1.5 max-w-[260px]">
                <h3 className="text-base font-black text-[#1A1C1E]">No stores yet</h3>
                <p className="text-xs text-gray-500 font-semibold leading-relaxed">Scan a store’s QR code to open their storefront and start ordering.</p>
              </div>

              <button
                onClick={onScan}
                className="min-h-11 px-6 rounded-full bg-[#1A1C1E] text-[#FFD23F] text-xs font-black uppercase tracking-wider shadow-sm active-scale hover:bg-black transition-colors cursor-pointer"
              >
                Scan a store
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {stores.map(s => (
                <div
                  key={s.id}
                  onClick={() => onOpenStore(s.id)}
                  className="relative p-4 bg-white border border-gray-100 hover:border-gray-200 rounded-[24px] flex gap-4 cursor-pointer active-scale transition-all shadow-sm"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveStore({ id: s.id, name: s.business_name });
                    }}
                    className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-gray-50 hover:bg-rose-50 text-gray-400 hover:text-rose-500 flex items-center justify-center transition cursor-pointer z-10"
                    title="Remove from Your Stores"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                  <div className="w-16 h-16 bg-[#F8F9FA] border border-gray-50 rounded-xl overflow-hidden shrink-0 flex items-center justify-center shadow-sm">
                    <StoreBrandMark store={s} />
                  </div>
                  <div className="flex-1 min-w-0 text-left pr-4">
                    <h4 className="font-extrabold text-base text-[#1A1C1E] truncate">{s.business_name}</h4>
                    <p className="text-xs text-gray-400 mt-0.5 truncate font-semibold">{s.address || 'Partner Store'}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider">
                        <span className={`w-1.5 h-1.5 rounded-full ${computeStoreOpen(s) ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                        <span className={computeStoreOpen(s) ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          {computeStoreOpen(s) ? 'Open' : 'Closed'}
                        </span>
                      </span>
                      <span className="text-[10px] font-semibold text-gray-400">• Scanned store</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Dynamic Recommended Products */}
        <section className="text-left">
          <h2 className="text-xl font-black text-[#1A1C1E] mb-4 font-headline-md tracking-tight">Recommended For You</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {products.slice(0, 4).map(p => (
              <div
                key={p.id}
                onClick={() => onOpenProduct(p)}
                className="relative bg-white border border-gray-100 rounded-[24px] p-3 cursor-pointer hover:border-gray-200 transition-all flex flex-col justify-between active-scale shadow-sm"
              >
                <div className="relative w-full aspect-square bg-[#F8F9FA] rounded-xl mb-3 overflow-hidden flex items-center justify-center">
                  <ProductImageWithFallback
                    src={p.image}
                    alt={p.name}
                    className="w-full h-full object-contain p-2"
                    productName={p.name}
                    category={p.category}
                    unit={p.unit}
                    isService={p.isService}
                  />
                </div>
                <div className="space-y-1 text-left">
                  <p className="font-bold text-xs text-[#1A1C1E] truncate">{p.name}</p>
                  <div className="flex items-center justify-between gap-1">
                    <p className="font-black text-sm text-[#1A1C1E]">{p.isService && getPrice(p) <= 0 ? 'Price on request' : `₦${getPrice(p).toLocaleString()}`}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); onAddToCart(p, 1); }}
                      className="w-7 h-7 rounded-full bg-[#1A1C1E] text-[#FFD23F] flex items-center justify-center shrink-0 active:scale-90 transition cursor-pointer"
                      title="Add to cart"
                    >
                      <span className="material-symbols-outlined text-sm font-bold">add</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* ⚡ Quick Order FAB */}
      <div className="fixed bottom-24 left-0 right-0 w-full max-w-5xl lg:max-w-6xl mx-auto px-4 z-40 pointer-events-none">
        <div className="flex justify-end pointer-events-auto">
          <button
            onClick={onQuickOrder}
            className="w-14 h-14 bg-[#1A1C1E] text-[#FFD23F] rounded-full flex items-center justify-center shadow-lg cursor-pointer hover:scale-105 active:scale-95 transition-transform"
            title="Quick Order"
          >
            <span className="material-symbols-outlined text-2xl font-bold">bolt</span>
          </button>
        </div>
      </div>
    </div>
  );
}
