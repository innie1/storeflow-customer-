import { useMemo } from 'react';
import type { Product } from '../types';
import {
  isLogoImageUrl, getStoreBusinessTypeLabel, getStoreBusinessType, isServiceStore,
} from '../lib/storeIdentity';
import StoreBrandMark from '../components/StoreBrandMark';
import ProductImageWithFallback from '../components/ProductImageWithFallback';
import LaundryStorefront from '../components/LaundryStorefront';
import StoreReviewsModal from '../components/StoreReviewsModal';
import TrackOrderLookup from '../components/TrackOrderLookup';

/**
 * A merchant's storefront: identity, published facts, promotions and catalog.
 *
 * The six render helpers below used to live on the root App component even
 * though nothing outside this screen called them.
 */
interface StoreScreenProps {
  // ── The store and its catalog ──────────────────────────────────────────
  store: any;
  products: Product[];
  filteredProducts: Product[];
  categories: string[];
  loading: boolean;
  productsLoading: boolean;
  serviceBusiness: boolean;
  storefrontNoun: string;
  storeStatusText: string;
  minimumOrder: number;
  fulfilment: { pickup: boolean; delivery: boolean };
  loyaltyBalance: { enabled: boolean; points: number; redeemThreshold: number; redeemValueNaira: number } | null;

  // ── Catalog controls ───────────────────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  selectedCategory: string;
  setSelectedCategory: (value: string) => void;
  sortBy: 'default' | 'price_asc' | 'price_desc' | 'name_asc';
  setSortBy: (value: 'default' | 'price_asc' | 'price_desc' | 'name_asc') => void;
  showInStockOnly: boolean;
  setShowInStockOnly: (value: boolean) => void;
  showFilterModal: boolean;
  setShowFilterModal: (value: boolean) => void;
  priceMode: 'retail' | 'wholesale';
  setPriceMode: (value: 'retail' | 'wholesale') => void;
  isRetailEnabled: boolean;
  isWholesaleEnabled: boolean;

  // ── Cart ───────────────────────────────────────────────────────────────
  getPrice: (product: Product) => number;
  getQty: (productId: string) => number;
  addToCart: (product: Product, qty?: number) => void;
  total: number;
  totalItemsCount: number;
  setIsCartOpen: (open: boolean) => void;
  setSelectedProduct: (product: Product | null) => void;

  // ── Favourites and reviews ─────────────────────────────────────────────
  favorites: string[];
  toggleFavorite: (productId: string) => void;
  isStoreFavorited: boolean;
  toggleStoreFavorite: () => void;
  showReviewsModal: boolean;
  setShowReviewsModal: (open: boolean) => void;
  userRating: number | null;
  onRated: (stars: number) => void;
  onStoreUpdated: (store: any) => void;
  customerIdentifier: string;

  // ── Tracking an order without an account ───────────────────────────────
  showTrackLookup: boolean;
  setShowTrackLookup: (open: boolean) => void;
  onOpenLookedUpOrder: (order: any) => void;

  // ── Pull to refresh ────────────────────────────────────────────────────
  pullDistance: number;
  refreshing: boolean;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: () => void;

  // ── Navigation and actions ─────────────────────────────────────────────
  navigateToScreen: (screen: any) => void;
  loadStoreDetails: (storeId: string) => void;
  loadOrdersHistory: () => void;
  startScanner: () => void;
  handleVoiceSearch: () => void;
  handleLaundryOrderPlaced: (order: any) => void;
}

export default function StoreScreen(props: StoreScreenProps) {
  const {
    store,
    products,
    filteredProducts,
    categories,
    loading,
    productsLoading,
    serviceBusiness,
    storefrontNoun,
    storeStatusText,
    minimumOrder,
    fulfilment,
    loyaltyBalance,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    sortBy,
    setSortBy,
    showInStockOnly,
    setShowInStockOnly,
    showFilterModal,
    setShowFilterModal,
    priceMode,
    setPriceMode,
    isRetailEnabled,
    isWholesaleEnabled,
    getPrice,
    getQty,
    addToCart,
    total,
    totalItemsCount,
    setIsCartOpen,
    setSelectedProduct,
    favorites,
    toggleFavorite,
    isStoreFavorited,
    toggleStoreFavorite,
    showReviewsModal,
    setShowReviewsModal,
    userRating,
    onRated,
    onStoreUpdated,
    customerIdentifier,
    showTrackLookup,
    setShowTrackLookup,
    onOpenLookedUpOrder,
    pullDistance,
    refreshing,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    navigateToScreen,
    loadStoreDetails,
    loadOrdersHistory,
    startScanner,
    handleVoiceSearch,
    handleLaundryOrderPlaced,
  } = props;


  const renderStoreSkeleton = () => (
    <div className="bg-[#F8F9FA] min-h-screen pb-32 animate-pulse text-left animate-fade-in">
      <div className="h-48 md:h-64 bg-gray-200/50 relative w-full overflow-hidden">
        <div className="absolute top-4 left-4 w-11 h-11 rounded-full bg-gray-300/60" />
        <div className="absolute top-4 right-4 flex gap-2">
          <div className="w-11 h-11 rounded-full bg-gray-300/60" />
          <div className="w-11 h-11 rounded-full bg-gray-300/60" />
        </div>
      </div>
      <div className="relative bg-white rounded-t-[28px] -mt-8 pt-20 pb-6 px-4 md:px-6 shadow-sm border-t border-gray-100 text-center flex flex-col items-center max-w-lg md:max-w-2xl mx-auto">
        <div className="absolute -top-16 w-32 h-32 rounded-full border-4 border-white bg-gray-200 shadow-md animate-shimmer" />
        <div className="h-8 w-56 bg-gray-200 rounded-xl mt-2 animate-shimmer" />
        <div className="h-4 w-32 bg-gray-100 rounded-md mt-3 animate-shimmer" />
        <div className="h-4 w-64 bg-gray-100 rounded-md mt-2 animate-shimmer" />
      </div>

      <div className="mt-6 px-4 md:px-8 max-w-5xl lg:max-w-6xl mx-auto space-y-6">
        {/* Info Card Skeleton */}
        <div className="bg-white p-5 rounded-[24px] border border-gray-100 shadow-sm space-y-4">
          <div className="h-4 w-36 bg-gray-200 rounded-md animate-shimmer" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map(n => (
              <div key={n} className="flex gap-3 items-center">
                <div className="w-5 h-5 rounded bg-gray-200 animate-shimmer" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-2 w-16 bg-gray-100 rounded" />
                  <div className="h-3 w-40 bg-gray-200 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Product Grid Skeleton */}
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="bg-white p-3 rounded-[24px] border border-gray-100 shadow-sm space-y-3">
              <div className="aspect-square bg-gray-100 rounded-2xl animate-shimmer" />
              <div className="h-4 w-3/4 bg-gray-200 rounded-md animate-shimmer" />
              <div className="h-4 w-1/2 bg-gray-100 rounded-md animate-shimmer" />
              <div className="h-8 w-full bg-gray-200 rounded-xl animate-shimmer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderStoreHeader = () => {
    const rating = store?.data?.marketplaceSettings?.rating;
    const reviewsCount = store?.data?.marketplaceSettings?.reviewsCount || 0;
    const showVerified = store?.data?.marketplaceSettings?.verified !== false;
    return (
      <div className="relative">
        <div className="h-48 md:h-64 relative w-full overflow-hidden bg-[#1A1C1E]">
          {/* Every storefront used to be topped with the same hot-linked
              Unsplash supermarket photo, while the merchant's own
              marketplaceSettings.coverImage was never read at all. Use their
              cover when they have set one, and a neutral brand wash when they
              have not, rather than dressing every shop up as a supermarket. */}
          {storeCoverImage ? (
            <img
              className="w-full h-full object-cover opacity-50 mix-blend-luminosity animate-fade-in"
              src={storeCoverImage}
              alt=""
              decoding="async"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#1A1C1E] via-[#26282c] to-[#3a3227]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-[#1A1C1E]/60 via-transparent to-[#1A1C1E] pointer-events-none" />
          <header className="flex justify-between items-center w-full px-4 h-16 absolute top-0 left-0 z-20">
            <button 
              onClick={() => navigateToScreen('home')} 
              className="w-11 h-11 flex items-center justify-center rounded-full bg-[#1A1C1E]/60 backdrop-blur-md border border-white/10 text-white active-scale transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <div className="flex items-center gap-2">
              <button 
                onClick={toggleStoreFavorite}
                className={`w-11 h-11 flex items-center justify-center rounded-full bg-[#1A1C1E]/60 backdrop-blur-md border border-white/10 text-white active-scale transition-all cursor-pointer ${
                  isStoreFavorited ? 'text-[#FFD23F]' : 'hover:text-[#FFD23F]'
                }`}
              >
                <span className={`material-symbols-outlined text-lg ${isStoreFavorited ? 'font-variation-fill' : ''}`} style={isStoreFavorited ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                  favorite
                </span>
              </button>
              <button 
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: store?.business_name || 'StoreFlow Store',
                      text: `Shop online at ${store?.business_name || 'StoreFlow'}!`,
                      url: window.location.href
                    }).catch(() => {});
                  } else {
                    navigator.clipboard.writeText(window.location.href);
                    alert('Link copied to clipboard!');
                  }
                }}
                className="w-11 h-11 flex items-center justify-center rounded-full bg-[#1A1C1E]/60 backdrop-blur-md border border-white/10 text-white active-scale transition-transform cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">share</span>
              </button>
            </div>
          </header>
        </div>

        {/* Center the store branding */}
        <div className="relative bg-white dark:bg-zinc-900 rounded-t-[28px] -mt-8 pt-14 pb-3 px-4 md:px-6 text-center flex flex-col items-center max-w-5xl lg:max-w-6xl mx-auto">
          <div className="absolute -top-11 w-24 h-24 rounded-full border-4 border-white dark:border-zinc-900 bg-white shadow-xl overflow-hidden flex items-center justify-center shrink-0 animate-fade-in">
            <StoreBrandMark store={store} />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-[#1A1C1E] dark:text-zinc-100 flex items-center justify-center gap-1.5 font-headline-xl">
              {store?.business_name || store?.data?.storeName || store?.data?.businessName || 'Store'}
              {showVerified && (
                <span className="material-symbols-outlined text-[#FFD23F] text-xl font-bold font-variation-fill" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
              )}
            </h1>

            {/* Rating Stars and Reviews Summary clickable overlay */}
            <div 
              onClick={() => setShowReviewsModal(true)}
              className="flex items-center justify-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
              title={rating ? "View Reviews" : "Rate this store"}
            >
              {rating ? (
                <>
                  <div className="flex items-center gap-0.5 text-[#FFD23F]">
                    {Array.from({ length: 5 }).map((_, s) => {
                      const fill = rating >= s + 1 ? 1 : rating >= s + 0.5 ? 0.5 : 0;
                      return (
                        <span 
                          key={s} 
                          className={`material-symbols-outlined text-base font-bold ${fill === 1 ? 'font-variation-fill' : ''}`}
                          style={fill === 1 ? { fontVariationSettings: "'FILL' 1" } : undefined}
                        >
                          {fill === 0.5 ? 'star_half' : 'star'}
                        </span>
                      );
                    })}
                  </div>
                  <span className="text-xs font-black text-[#1A1C1E]">{rating.toFixed(1)}</span>
                  <span className="text-xs text-gray-400 font-bold">({reviewsCount} {reviewsCount === 1 ? 'review' : 'reviews'})</span>
                </>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 text-xs font-black hover:bg-amber-500/25 transition-all">
                  <span className="material-symbols-outlined text-xs font-variation-fill" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                  <span>Rate this store</span>
                </div>
              )}
            </div>

            {/* Only the merchant's own description. This used to fall back to
                "Your trusted neighborhood store." for every shop that had not
                written one, which said nothing and cost a line of screen. */}
            {store?.data?.marketplaceSettings?.description && (
              <p className="text-sm text-gray-500 dark:text-zinc-400 font-medium max-w-sm mx-auto leading-relaxed pt-1">
                {store.data.marketplaceSettings.description}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const storeCoverImage = useMemo(() => {
    const cover = store?.data?.marketplaceSettings?.coverImage;
    return isLogoImageUrl(cover) ? String(cover) : null;
  }, [store]);

  /**
   * A compact strip of facts about the store.
   *
   * This was a card of eight large two-column tiles that pushed the catalog
   * most of a screen down, truncated its own values ("Provision / ..."), and
   * left ragged empty cells whenever a merchant had filled in only three
   * fields. It is now a wrapping row of chips: it takes the height it needs,
   * nothing is cut off, and every fact the merchant published is shown.
   *
   * A service shop is not an inventory shop, so the wording follows the
   * business: a laundry or barber offers "services" that are "booked" and have
   * a turnaround; a provision store has "items" that are "in stock".
   */
  const renderStoreInfoCard = () => {
    const ms = store?.data?.marketplaceSettings;
    const serviceShop = isServiceStore(store);

    const configuredDeliveryFee = Number(ms?.deliveryFee);
    const hasConfiguredFee = Number.isFinite(configuredDeliveryFee) && configuredDeliveryFee >= 0;
    const freeOver = Number(ms?.freeDeliveryThreshold);

    const deliveryLabel = [
      ms?.deliveryTime || '',
      hasConfiguredFee ? (configuredDeliveryFee === 0 ? 'Free' : '₦' + configuredDeliveryFee.toLocaleString()) : '',
      Number.isFinite(freeOver) && freeOver > 0 ? `free over ₦${freeOver.toLocaleString()}` : '',
    ].filter(Boolean).join(' · ');

    // Turnaround is a service-shop fact: how long the job takes, not stock.
    const turnaround = products.map(p => p.turnaround).filter(Boolean)[0] || '';

    const chips: Array<{ icon: string; label: string; value: string; href?: string }> = [];

    if (fulfilment.delivery) {
      chips.push({ icon: 'local_shipping', label: 'Delivery', value: deliveryLabel || 'Available' });
    }
    if (fulfilment.pickup) {
      chips.push({ icon: 'storefront', label: serviceShop ? 'Drop-off' : 'Pickup', value: 'In store' });
    }
    if (minimumOrder > 0) {
      chips.push({ icon: 'payments', label: 'Min order', value: '₦' + minimumOrder.toLocaleString() });
    }
    if (products.length > 0) {
      chips.push({
        icon: serviceShop ? 'design_services' : 'inventory_2',
        label: serviceShop ? 'Services' : 'Catalog',
        value: `${products.length} ${serviceShop ? (products.length === 1 ? 'service' : 'services') : (products.length === 1 ? 'item' : 'items')}`,
      });
    }
    if (serviceShop && turnaround) {
      chips.push({ icon: 'timer', label: 'Turnaround', value: String(turnaround) });
    }
    if (ms?.openingTime && ms?.closingTime) {
      chips.push({ icon: 'schedule', label: 'Hours', value: `${ms.openingTime} – ${ms.closingTime}` });
    }
    if (store?.address) {
      chips.push({ icon: 'place', label: 'Address', value: String(store.address) });
    }
    if (store?.phone) {
      chips.push({ icon: 'call', label: 'Phone', value: String(store.phone), href: `tel:${store.phone}` });
    }
    if (store?.email) {
      chips.push({ icon: 'mail', label: 'Email', value: String(store.email), href: `mailto:${store.email}` });
    }
    if (ms?.website) {
      chips.push({ icon: 'language', label: 'Website', value: String(ms.website), href: String(ms.website) });
    }

    if (chips.length === 0 && !loyaltyBalance?.enabled) return null;

    const chipClass = 'inline-flex items-center gap-2 rounded-full border border-gray-150 dark:border-zinc-800 bg-[#F8F9FA] dark:bg-zinc-950/60 pl-2.5 pr-3.5 py-1.5 max-w-full';

    return (
      <div className="bg-white dark:bg-zinc-900 rounded-[20px] p-3.5 sm:p-4 border border-gray-100 dark:border-zinc-800 shadow-sm text-left space-y-3 animate-fade-in">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-black text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">
            {getStoreBusinessTypeLabel(store)}
          </h3>
          <div className="flex items-center gap-3 shrink-0">
            {/*
              The "Track an order" sheet has existed since this app was first
              written — a phone-number / order-code lookup for someone with no
              order history on the device they are holding (a fresh scan, a
              borrowed phone). Nothing anywhere ever set showTrackLookup to
              true, so it could not be opened. This is its entry point, on the
              store page because the lookup is scoped to one merchant.
            */}
            <button
              onClick={() => setShowTrackLookup(true)}
              className="text-[11px] font-black text-gray-500 dark:text-zinc-400 hover:underline cursor-pointer flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">search</span>
              Track an order
            </button>
            <button
              onClick={() => { navigateToScreen('history'); loadOrdersHistory(); }}
              className="text-[11px] font-black text-[#1A1C1E] dark:text-zinc-200 hover:underline cursor-pointer flex items-center gap-1"
            >
              My orders
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {chips.map(chip => {
            const inner = (
              <>
                <span className="material-symbols-outlined text-sm text-gray-400 dark:text-zinc-500 shrink-0">{chip.icon}</span>
                <span className="min-w-0">
                  <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 dark:text-zinc-500 block leading-none mb-0.5">{chip.label}</span>
                  <span className="text-[11px] font-black text-[#1A1C1E] dark:text-zinc-100 block leading-tight break-words">{chip.value}</span>
                </span>
              </>
            );
            return chip.href ? (
              <a
                key={chip.label}
                href={chip.href}
                target={chip.href.startsWith('http') ? '_blank' : undefined}
                rel={chip.href.startsWith('http') ? 'noreferrer' : undefined}
                className={chipClass + ' hover:border-gray-300 dark:hover:border-zinc-700 transition-colors'}
              >
                {inner}
              </a>
            ) : (
              <div key={chip.label} className={chipClass}>{inner}</div>
            );
          })}
        </div>

        {loyaltyBalance?.enabled && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 px-3 py-2">
            <p className="text-[11px] font-black text-[#1A1C1E] dark:text-amber-200">🪙 {loyaltyBalance.points} points</p>
            <p className="text-[10px] text-amber-700 dark:text-amber-300 font-bold text-right">
              {loyaltyBalance.points >= loyaltyBalance.redeemThreshold
                ? `Ready to redeem for ₦${loyaltyBalance.redeemValueNaira.toLocaleString()} off`
                : `${loyaltyBalance.redeemThreshold - loyaltyBalance.points} more for ₦${loyaltyBalance.redeemValueNaira.toLocaleString()} off`}
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderStoreStatus = () => {
    const status = storeStatusText; // 'Open' | 'Closed' | 'Closing Soon'
    const statusTextColor = status === 'Open'
      ? 'text-emerald-600 dark:text-emerald-400'
      : status === 'Closing Soon'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400';

    const dotColor = status === 'Open' 
      ? 'bg-emerald-500' 
      : status === 'Closing Soon' 
        ? 'bg-amber-500' 
        : 'bg-rose-500';

    const closingTime = store?.data?.marketplaceSettings?.closingTime;

    return (
      <div className="space-y-3">
        {/* One line, and it says when the store closes rather than repeating
            "Accepting orders now" — which the Open dot already implies. */}
        <div className="flex items-center gap-2 px-1 text-xs font-bold">
          <span className={`w-2 h-2 rounded-full ${dotColor} ${status === 'Open' ? 'animate-pulse' : ''}`} />
          <span className={`uppercase tracking-wider font-extrabold text-[10px] ${statusTextColor}`}>{status}</span>
          {closingTime && status !== 'Closed' && (
            <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-semibold">· closes {closingTime}</span>
          )}
        </div>

        {/* Closed warning message */}
        {status === 'Closed' && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-800 p-4 rounded-[20px] text-xs text-left space-y-1">
            <div className="flex items-center gap-2 text-rose-900 font-extrabold">
              <span className="material-symbols-outlined text-sm font-bold">warning</span>
              <span>Notice</span>
            </div>
            <p className="text-rose-700 font-medium leading-relaxed">
              This store is currently closed. Orders will be processed when the store opens.
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderStorePromotions = () => {
    const ms = store?.data?.marketplaceSettings;
    const promos: Array<{ title: string; subtitle: string; icon: string; bg: string; text: string }> = [];

    if (ms?.freeDeliveryThreshold) {
      promos.push({
        title: 'Free Delivery',
        subtitle: `On orders above ₦${ms.freeDeliveryThreshold.toLocaleString()}`,
        icon: 'local_shipping',
        bg: 'from-emerald-500 to-teal-600',
        text: 'text-white'
      });
    }

    if (ms?.onlineDiscount) {
      promos.push({
        title: `${ms.onlineDiscount}% Discount`,
        subtitle: 'Applied automatically on checkout',
        icon: 'percent',
        bg: 'from-[#FFD23F] to-amber-500',
        text: 'text-slate-950'
      });
    }

    // Support custom promotions list in marketplace settings
    if (Array.isArray(ms?.promotions)) {
      ms.promotions.forEach((p: any) => {
        if (typeof p === 'string') {
          promos.push({
            title: p,
            subtitle: 'Limited Time Offer',
            icon: 'local_offer',
            bg: 'from-gray-800 to-[#1A1C1E]',
            text: 'text-white'
          });
        } else if (p && typeof p === 'object' && p.title) {
          promos.push({
            title: p.title,
            subtitle: p.subtitle || 'Special Offer',
            icon: p.icon || 'local_offer',
            bg: p.bg || 'from-gray-800 to-[#1A1C1E]',
            text: p.text || 'text-white'
          });
        }
      });
    }

    if (promos.length === 0) return null;

    return (
      <div className="space-y-3 text-left">
        <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 px-1">Exclusive Offers</h3>
        <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-4 px-4 py-1">
          {promos.map((promo, idx) => (
            <div 
              key={idx}
              className={`bg-gradient-to-br ${promo.bg} ${promo.text} p-4 rounded-[24px] flex items-center gap-3.5 shadow-sm shrink-0 w-64 relative overflow-hidden group`}
            >
              <span className="material-symbols-outlined text-2xl font-bold bg-white/20 p-2.5 rounded-[18px]">
                {promo.icon}
              </span>
              <div className="min-w-0">
                <h4 className="font-extrabold text-sm truncate uppercase tracking-wide">{promo.title}</h4>
                <p className="text-[10px] opacity-90 truncate leading-relaxed font-semibold">{promo.subtitle}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };



  return (
    <div 
      className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] pb-32 font-sans relative overflow-x-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull to refresh indicator */}
      <div 
        className="absolute top-0 left-0 right-0 flex items-center justify-center pointer-events-none transition-all"
        style={{
          height: '50px',
          transform: `translateY(${pullDistance - 50}px)`,
          opacity: pullDistance > 0 ? 1 : 0
        }}
      >
        <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md py-1.5 px-3 rounded-full shadow-md border border-gray-100 text-xs font-bold text-slate-700">
          {refreshing ? (
            <>
              <span className="material-symbols-outlined text-sm animate-spin text-[#FFD23F]">progress_activity</span>
              <span>Refreshing store...</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-sm text-gray-400">arrow_downward</span>
              <span>{pullDistance > 60 ? 'Release to refresh' : 'Pull to refresh'}</span>
            </>
          )}
        </div>
      </div>

      <div 
        className="transition-transform duration-200"
        style={{
          transform: `translateY(${pullDistance}px)`
        }}
      >
        {loading ? (
          renderStoreSkeleton()
        ) : (
          <div className="animate-fade-up space-y-6 pb-12">
            {/* 1. Store Header */}
            {renderStoreHeader()}

            {/* Main Content Layout Container */}
            <div className="px-4 md:px-8 max-w-5xl lg:max-w-6xl mx-auto space-y-6">
              {/* 2. Store Status badge & Closed Warning */}
              {renderStoreStatus()}

              {/* 3. Store Information Card */}
              {renderStoreInfoCard()}

              {/* 4. Store Promotions */}
              {renderStorePromotions()}

              {getStoreBusinessType(store) === 'laundry' ? (
                <LaundryStorefront
                  store={store}
                  onOrderPlaced={handleLaundryOrderPlaced}
                  onOpenOrders={() => { navigateToScreen('history'); loadOrdersHistory(); }}
                />
              ) : (
              <>
              {/* 5. Product Search & Sort / Filter */}
              <div className="space-y-4">
                <div className="flex gap-2">
                  <div className="relative flex-1 h-13 bg-white rounded-full flex items-center px-4 border border-gray-200 focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 transition-all shadow-sm">
                    <span className="material-symbols-outlined text-gray-400 mr-2.5">search</span>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder={
                        serviceBusiness ? 'Search services...'
                        : store?.data?.storeType === 'gas_filling' ? 'Search gas & fuel...'
                        : 'Search products...'
                      }
                      className="bg-transparent border-none text-sm focus:ring-0 focus:outline-none w-full text-[#1A1C1E] placeholder:text-gray-400"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="mr-2 cursor-pointer text-gray-400 hover:text-[#1A1C1E]">
                        <span className="material-symbols-outlined text-base">close</span>
                      </button>
                    )}
                    <button 
                      onClick={handleVoiceSearch}
                      className="material-symbols-outlined text-gray-400 cursor-pointer ml-1 hover:text-[#1A1C1E] p-1 rounded-full hover:bg-gray-50 active-scale"
                      title="Voice Search"
                    >
                      mic
                    </button>
                    <button 
                      onClick={startScanner}
                      className="material-symbols-outlined text-gray-400 cursor-pointer ml-1 hover:text-[#1A1C1E] p-1 rounded-full hover:bg-gray-50 active-scale"
                      title="Barcode Search"
                    >
                      qr_code_scanner
                    </button>
                  </div>
                  
                  {/* Filter Button */}
                  <button 
                    onClick={() => setShowFilterModal(true)}
                    className={`w-13 h-13 rounded-full bg-white border flex items-center justify-center shadow-sm cursor-pointer active-scale transition-colors ${
                      sortBy !== 'default' || showInStockOnly ? 'border-[#FFD23F] text-[#FFD23F]' : 'border-gray-200 text-gray-500 hover:text-[#1A1C1E]'
                    }`}
                    title="Filters & Sort"
                  >
                    <span className="material-symbols-outlined">{serviceBusiness ? 'tune' : 'filter_list'}</span>
                  </button>
                </div>

                {/* 6. Category Pills */}
                <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 py-1">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-4 py-2 rounded-full font-bold text-xs shrink-0 transition-all cursor-pointer shadow-sm ${
                        selectedCategory === cat
                          ? 'bg-[#1A1C1E] text-[#FFD23F] font-black'
                          : 'bg-white border border-gray-100 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* 7. Segmented Pricing Control */}
              {isRetailEnabled && isWholesaleEnabled && (
                <div className="flex p-1 rounded-[18px] bg-white border border-gray-100 text-xs font-bold w-full max-w-[280px] mx-auto shadow-sm">
                  <button
                    onClick={() => setPriceMode('retail')}
                    className={`flex-1 py-2.5 rounded-[14px] transition-all cursor-pointer flex items-center justify-center gap-1.5 font-black ${
                      priceMode === 'retail' ? 'bg-[#1A1C1E] text-white shadow-sm' : 'text-gray-400 hover:text-gray-800'
                    }`}
                  >
                    <span>Retail</span>
                  </button>
                  <button
                    onClick={() => setPriceMode('wholesale')}
                    className={`flex-1 py-2.5 rounded-[14px] transition-all cursor-pointer flex items-center justify-center gap-1.5 font-black ${
                      priceMode === 'wholesale' ? 'bg-[#1A1C1E] text-white shadow-sm' : 'text-gray-400 hover:text-gray-800'
                    }`}
                  >
                    <span>Wholesale</span>
                  </button>
                </div>
              )}

              {/* 8. Product Grid & Loading states */}
              {productsLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 md:gap-6">
                  {[1, 2, 3, 4].map(n => (
                    <div key={n} className="bg-white p-3 rounded-[24px] border border-gray-100 shadow-sm space-y-3 animate-pulse">
                      <div className="aspect-square bg-gray-100 rounded-2xl animate-shimmer" />
                      <div className="h-4 w-3/4 bg-gray-200 rounded-md" />
                      <div className="h-4 w-1/2 bg-gray-200 rounded-md" />
                      <div className="h-8 w-full bg-gray-100 rounded-xl" />
                    </div>
                  ))}
                </div>
              ) : filteredProducts.length === 0 ? (
                /* 9. Empty States */
                <div className="bg-white border border-gray-100 rounded-[28px] p-10 text-center shadow-sm space-y-4 animate-fade-in">
                  <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto text-gray-300">
                    <span className="material-symbols-outlined text-4xl">{serviceBusiness ? 'design_services' : 'shopping_basket'}</span>
                  </div>
                  <div className="space-y-1">
                    <p className="font-extrabold text-[#1A1C1E] text-base">No {storefrontNoun} Found</p>
                    <p className="text-xs text-gray-400 font-medium">This business hasn't added any {storefrontNoun.toLowerCase()} yet or nothing matches your search.</p>
                  </div>
                  <button 
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('All');
                      setSortBy('default');
                      setShowInStockOnly(false);
                      if (store?.id) loadStoreDetails(store.id);
                    }} 
                    className="px-6 py-2.5 bg-[#1A1C1E] text-white font-extrabold text-xs rounded-full active-scale cursor-pointer hover:bg-black transition-colors inline-block"
                  >
                    Retry / Reset
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-4 md:gap-x-6 gap-y-6">
                  {filteredProducts.map(p => {
                    const qtyInCart = getQty(p.id);
                    const isOutOfStock = !p.isService && p.quantity <= 0;
                    const showLimitedStock = store?.data?.marketplaceSettings?.showLimitedStock === true;
                    const isLimited = showLimitedStock && p.quantity > 0 && p.quantity <= 5;
                    const isNew = p.status === 'new' || (p.cost_price === 0 && p.selling_price > 0);
                    const isPopular = p.status === 'popular';
                    const isFavorited = favorites.includes(p.id);

                    // Mock discount if comparing prices
                    const hasDiscount = p.id.charCodeAt(0) % 4 === 0;
                    const originalPrice = hasDiscount ? getPrice(p) * 1.25 : getPrice(p);
                    const discountPct = 20;

                    return (
                      <div
                        key={p.id}
                        onClick={() => setSelectedProduct(p)}
                        className="bg-white border border-gray-100 rounded-[24px] p-[18px] flex flex-col justify-between shadow-sm relative group cursor-pointer hover:border-gray-200 transition-colors text-left"
                      >
                        <div className="relative">
                          {/* Badges Container */}
                          <div className="absolute top-1 left-1 z-10 flex flex-col gap-1 pointer-events-none">
                            {isOutOfStock ? (
                              <span className="bg-rose-500 text-white font-black text-[8px] px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">Sold Out</span>
                            ) : isLimited ? (
                              <span className="bg-amber-500 text-white font-black text-[8px] px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">Limited</span>
                            ) : (
                              <span className="bg-emerald-500 text-white font-black text-[8px] px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">Available</span>
                            )}

                            {isNew && !isOutOfStock && (
                              <span className="bg-[#FFD23F] text-slate-950 font-black text-[8px] px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">New</span>
                            )}

                            {isPopular && !isOutOfStock && (
                              <span className="bg-indigo-500 text-white font-black text-[8px] px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">Popular</span>
                            )}

                            {hasDiscount && !isOutOfStock && (
                              <span className="bg-rose-500 text-white font-black text-[8px] px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">-{discountPct}%</span>
                            )}
                          </div>

                          {/* Favorite heart icon */}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(p.id);
                            }}
                            className="absolute top-1 right-1 z-10 w-7 h-7 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center shadow-sm cursor-pointer text-gray-400 hover:text-rose-500 transition-transform"
                          >
                            <span className={`material-symbols-outlined text-base ${isFavorited ? 'text-rose-500 font-variation-fill' : ''}`} style={isFavorited ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                              favorite
                            </span>
                          </button>

                          <div className="relative w-full aspect-square bg-[#F8F9FA] dark:bg-zinc-900 rounded-2xl mb-4 overflow-hidden flex items-center justify-center">
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

                          <div className="space-y-0.5">
                            <h4 className="font-extrabold text-xs text-[#1A1C1E] truncate">{p.name}</h4>
                            {p.isService && p.turnaround ? (
                              <p className="text-[10px] text-gray-400 truncate flex items-center gap-0.5">
                                <span className="material-symbols-outlined text-[11px]">schedule</span> {p.turnaround}
                              </p>
                            ) : (
                              <p className="text-[10px] text-gray-400 truncate">{p.unit || p.brand || p.category || 'Product'}</p>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="font-black text-sm text-[#1A1C1E]">
                              ₦{getPrice(p).toLocaleString()}
                              {p.unit && p.unit !== 'pcs' && <span className="text-[9px] font-semibold text-gray-400">/{p.unit}</span>}
                            </span>
                            {hasDiscount && (
                              <span className="text-[10px] text-gray-400 line-through font-medium mt-0.5">₦{Math.round(originalPrice).toLocaleString()}</span>
                            )}
                          </div>
                          {isOutOfStock ? (
                            <span className="text-[9px] font-black text-rose-500 uppercase">Sold Out</span>
                          ) : qtyInCart > 0 ? (
                            <div className="flex items-center gap-2 bg-[#1A1C1E] text-white rounded-full p-1 shadow-md" onClick={e => e.stopPropagation()}>
                              <button onClick={() => addToCart(p, -1)} className="w-6.5 h-6.5 rounded-full bg-white/10 flex items-center justify-center text-white active:scale-95 cursor-pointer">
                                <span className="material-symbols-outlined text-xs">remove</span>
                              </button>
                              <span className="text-xs font-black px-1">{qtyInCart}</span>
                              <button onClick={() => addToCart(p, 1)} className="w-6.5 h-6.5 rounded-full bg-[#FFD23F] text-slate-950 flex items-center justify-center active:scale-95 cursor-pointer">
                                <span className="material-symbols-outlined text-xs font-bold">add</span>
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                addToCart(p, 1);
                              }}
                              className="w-8 h-8 bg-[#FFD23F] hover:bg-[#FFD23F]/95 text-slate-950 rounded-full flex items-center justify-center active:scale-95 transition shadow-sm cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-sm font-bold">add</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              </>
              )}

            </div>
          </div>
        )}
      </div>

      {/* 10. Bottom Cart Bar */}
      {getStoreBusinessType(store) !== 'laundry' && totalItemsCount > 0 && (
        <div className="fixed bottom-20 left-0 right-0 z-40 w-full max-w-5xl lg:max-w-6xl mx-auto px-4">
          <button
            onClick={() => setIsCartOpen(true)}
            className="w-full bg-[#1A1C1E] border border-white/5 text-white py-4 px-6 rounded-full flex justify-between items-center shadow-2xl active:scale-98 transition-all cursor-pointer font-black"
          >
            <div className="flex items-center gap-3">
              <span className="bg-[#FFD23F] text-slate-950 text-[11px] w-6 h-6 flex items-center justify-center rounded-full font-black font-mono">{totalItemsCount}</span>
              <span className="font-black text-sm uppercase tracking-wider text-white">View Cart</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-black text-sm text-[#FFD23F]">₦{total.toLocaleString()}</span>
              <span className="material-symbols-outlined text-lg font-bold text-[#FFD23F]">arrow_forward</span>
            </div>
          </button>
        </div>
      )}

      {getStoreBusinessType(store) !== 'laundry' && showFilterModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center animate-fade-in"
          onClick={() => setShowFilterModal(false)}
        >
          <div 
            className="bg-white w-full rounded-t-3xl overflow-hidden p-6 animate-slide-up flex flex-col text-left"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-5"></div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-extrabold text-lg text-[#1A1C1E]">Sort & Filter</h3>
              <button onClick={() => setShowFilterModal(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:text-black">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-6 pb-6">
              {/* Sorting Options */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Sort Products By</label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { key: 'default', label: 'Default' },
                    { key: 'name_asc', label: 'Name A-Z' },
                    { key: 'price_asc', label: 'Price: Low to High' },
                    { key: 'price_desc', label: 'Price: High to Low' }
                  ].map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setSortBy(opt.key as any)}
                      className={`py-3 px-4 rounded-xl border text-center font-bold transition-all cursor-pointer ${
                        sortBy === opt.key 
                          ? 'bg-[#1A1C1E] border-[#1A1C1E] text-[#FFD23F]' 
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stock Availability Filter */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Availability</label>
                <button
                  onClick={() => setShowInStockOnly(!showInStockOnly)}
                  className={`w-full py-3 px-4 rounded-xl border font-bold text-left flex items-center justify-between cursor-pointer transition-all ${
                    showInStockOnly 
                      ? 'bg-[#1A1C1E]/5 border-[#1A1C1E] text-[#1A1C1E]' 
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>Show In-Stock Only</span>
                  <span className={`material-symbols-outlined text-lg ${showInStockOnly ? 'text-[#FFD23F]' : 'text-gray-300'}`}>
                    {showInStockOnly ? 'check_box' : 'check_box_outline_blank'}
                  </span>
                </button>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 flex gap-3 mt-2">
              <button 
                onClick={() => {
                  setSortBy('default');
                  setShowInStockOnly(false);
                  setShowFilterModal(false);
                }}
                className="flex-1 py-3.5 border border-gray-200 text-gray-600 font-extrabold rounded-xl active-scale text-center text-xs hover:bg-gray-50"
              >
                Reset Filters
              </button>
              <button 
                onClick={() => setShowFilterModal(false)}
                className="flex-1 py-3.5 bg-[#1A1C1E] text-white font-black rounded-xl active-scale text-center text-xs hover:bg-black"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ratings overlay popup */}
      {showReviewsModal && (
            <StoreReviewsModal
              store={store}
              customerIdentifier={customerIdentifier}
              userRating={userRating}
              onClose={() => setShowReviewsModal(false)}
              onStoreUpdated={onStoreUpdated}
              onRated={onRated}
            />
          )}

      {/* Track an Order — guest lookup, no local history needed */}
      {showTrackLookup && (
        <TrackOrderLookup
          store={store}
          onClose={() => setShowTrackLookup(false)}
          onOpenOrder={onOpenLookedUpOrder}
        />
      )}

    </div>
  );
}
