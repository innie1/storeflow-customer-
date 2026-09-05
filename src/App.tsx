import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import { parseRoute, parseQRCode } from './router';
import { listPublicStorefronts, matchesPublicStoreReference, resolvePublicStore } from './utils/storeResolver';
import { describeActionFailure, describeOrderFailure, type OrderFailureKind } from './utils/orderErrors';
import { subscribeUserToPush, clearNotificationsForOrder, clearAllStoreFlowNotifications } from './utils/pushNotifications';
import { safeGetItem, safeSetItem, safeGetJSON, safeSetJSON } from './utils/safeStorage';
import { computeOrderPricing } from './utils/orderPricing';
import type { Product, Store, CartItem, Order, TrackedOrder } from './types';
import { computeStoreOpen, isServiceStore, getStorePrepMinutes } from './lib/storeIdentity';
import StoreBrandMark from './components/StoreBrandMark';
import { saveOrderAccessToken, getOrderAccessToken, getStoredOrderCredentials } from './lib/orderTokens';
import { loadItsMeProfile, saveItsMeProfile, type ItsMe } from './lib/itsMe';
import ProductImageWithFallback from './components/ProductImageWithFallback';
import OnboardingScreen from './screens/OnboardingScreen';
import StoreNotFoundScreen from './screens/StoreNotFoundScreen';
import LoginScreen from './screens/LoginScreen';
import LocationScreen from './screens/LocationScreen';
import TrackingScreen from './screens/TrackingScreen';
import OrdersHistoryScreen from './screens/OrdersHistoryScreen';
import ProfileScreen from './screens/ProfileScreen';
import ExploreScreen from './screens/ExploreScreen';
import ItsMeScreen from './screens/ItsMeScreen';
import HomeScreen from './screens/HomeScreen';
import StoreScreen from './screens/StoreScreen';
import CartDrawer from './screens/CartDrawer';
// STOREFLOW_SHARED_STORE_RESOLVER_V1

// ─── Type Definitions ────────────────────────────────────────────────────────

function readCachedStores(): Store[] {
  return safeGetJSON<Store[]>('storeflow_cached_all_stores', []);
}

// ─── It'sMe Identity ─────────────────────────────────────────────────────────

// ─── Shared store-open logic (used by store cards AND the store detail page,
// so they never disagree the way "Closed" on Home vs "Open" on the store
// page used to) ────────────────────────────────────────────────────────────
// The merchant app's "logo" field is often a design STYLE NAME (e.g.
// "minimalist", "classic") from its built-in logo generator, not an actual
// uploaded image URL. Treating any truthy string as an <img loading="lazy" decoding="async" src> silently
// fails to load and leaves a blank circle. Only real URLs should be rendered
// as an <img>; anything else should fall back to a generated initials badge.
// ─── Order access tokens ───────────────────────────────────────────────
// Each order gets a random, unguessable access_token server-side. We cache
// it locally right after placing the order and send it back on cancel/
// approve actions as a second proof of identity alongside the phone number
// — phone numbers alone are guessable, this closes that gap at zero cost.
// If a token isn't cached locally (e.g. customer looked the order up from
// a different device), these actions still work via phone match alone —
// the server treats the token as an extra check, not a hard requirement.
const ACTIVE_ORDER_STATUSES = ['Pending', 'Accepted', 'Preparing', 'Ready'];

/** Statuses an order can never leave, so there is nothing left to poll for. */
const TERMINAL_ORDER_STATUSES = new Set(['Completed', 'Rejected', 'Cancelled']);

/**
 * How often the open Tracking screen re-checks a live order.
 *
 * Was 3s, which is 1,200 requests an hour for a status a merchant changes a
 * handful of times across a whole order. 6s still feels immediate to someone
 * watching the screen and halves the traffic.
 */
const TRACKING_POLL_MS = 6000;

const SCREEN_PATHS: Record<string, string> = {
  home: '/', explore: '/explore', history: '/orders', profile: '/profile',
  tracking: '/tracking', login: '/login', location: '/location', onboarding: '/onboarding',
};

// ─── Shared store-products resolver (JSONB catalog OR relational table) ──
// Many merchant stores keep their entire catalog embedded in
// stores.data.products as JSONB and have ZERO rows in the relational
// products table (confirmed: e.g. store "Mee" — 115 products in JSONB,
// 0 rows in `products`). Anything that needs a store's products — not
// just the initial store-detail load — has to check both places the
// same way, or it silently sees an empty catalog for JSONB-only stores.
// This was previously duplicated inline in loadStoreDetails only;
// handleReorder queried the relational table directly and got nothing
// back for stores like this, so reorder always reported "none of the
// items are available" even when they were in stock.
async function resolveStoreProducts(storeData: any): Promise<any[]> {
  const storeUuid = storeData.id;
  let prods: any[] = [];

  const template = storeData?.data?.businessTemplate;
  const serviceTypes = new Set(['laundry','barber','salon','tailoring','repair','printing','cyber_cafe','car_wash','photography','cleaning','spa','games','gaming','restaurant']);
  const templateType = String(template?.type || storeData?.data?.storeType || storeData?.storeType || '').toLowerCase();
  const serviceBusiness = serviceTypes.has(templateType) || (Array.isArray(template?.modes) && template.modes.includes('services'));

  if (storeData.data && Array.isArray((storeData.data as any).products)) {
    prods = (storeData.data as any).products.map((p: any) => {
      const whPrice = p.sellingPrice ?? p.selling_price ?? 0;
      const isCartonSingle = p.isCartonSingleEnabled === true;
      const rtPrice = isCartonSingle ? (p.singleSellingPrice ?? (p.singlesPerCarton ? Math.round(whPrice / p.singlesPerCarton) : whPrice)) : whPrice;
      return {
        id: p.id || p.productId || Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        store_id: storeUuid,
        barcode: p.barcode || '',
        name: p.name || p.productName || 'Product',
        description: p.description || '',
        selling_price: whPrice,
        wholesale_price: whPrice,
        retail_price: rtPrice,
        quantity: p.quantity ?? 0,
        unit: p.unit || 'pcs',
        isService: p.isService || false,
        turnaround: p.turnaround || '',
        category: p.category || 'General',
        image: p.image || '',
        status: p.discontinued ? 'inactive' : 'active'
      };
    }).filter((p: any) => p.status === 'active' && (!serviceBusiness || p.isService === true));
  }

  if (prods.length === 0) {
  const { data: prodData, error: prodErr } = await supabase
      .from('products')
      .select('id, store_id, category_id, barcode, name, description, brand, selling_price, quantity, unit, image, status, is_service')
      .eq('store_id', storeUuid)
      .eq('status', 'active');
    if (prodErr) throw prodErr;
    prods = (prodData || []).map((p: any) => ({
      ...p,
      isService: Boolean(p.isService ?? p.is_service),
      wholesale_price: p.wholesale_price ?? p.selling_price ?? 0,
      retail_price: p.retail_price ?? p.selling_price ?? 0
    })).filter((p: any) => !serviceBusiness || p.isService === true);
  }

  // businessTemplate.offerings is the merchant's source of truth for services.
  // An offering is visible only while it is enabled (not discontinued/inactive).
  // Merge these with normal products so a service business can expose services
  // even when its relational product table also contains other rows.
  if (serviceBusiness && Array.isArray(template?.offerings)) {
    const existingIds = new Set(prods.map((p: any) => String(p.id)));
    const existingNames = new Set(prods.map((p: any) => String(p.name || '').trim().toLowerCase()));
    const enabledServices = template.offerings
      .filter((o: any) => o && o.discontinued !== true && o.enabled !== false && o.active !== false && o.status !== 'inactive')
      .map((o: any, index: number) => ({
        id: String(o.id || `service-${index}`),
        store_id: storeUuid,
        name: o.name || 'Service',
        description: o.description || '',
        selling_price: Number(o.price ?? o.sellingPrice ?? 0),
        wholesale_price: Number(o.price ?? o.sellingPrice ?? 0),
        retail_price: Number(o.price ?? o.sellingPrice ?? 0),
        quantity: 999999,
        unit: o.pricing === 'time' ? 'session' : 'service',
        isService: true,
        turnaround: o.turnaround || '',
        category: 'Services',
        image: o.image || '',
        status: 'active'
      }))
      .filter((o: any) => !existingIds.has(String(o.id)) && !existingNames.has(String(o.name).trim().toLowerCase()));
    prods = [...prods, ...enabledServices];
  }

  // A storefront must never inherit another store's cached or stale rows.
  // Service businesses are restricted to explicit service records so retail
  // inventory can never leak into a laundry page.
  return prods.filter((product: any) =>
    String(product.store_id || '') === String(storeUuid) &&
    (!serviceBusiness || product.isService === true)
  );
}

function App() {
  // Navigation & State Management
  const [screen, setScreen] = useState<'splash' | 'onboarding' | 'login' | 'location' | 'home' | 'explore' | 'store' | 'tracking' | 'profile' | 'history' | 'store_not_found'>(() => {
    const { storeId } = parseRoute();
    if (storeId) return 'store';

    const path = window.location.pathname;
    const pathToScreen = Object.entries(SCREEN_PATHS).find(([_, p]) => p === path)?.[0];
    if (pathToScreen) return pathToScreen as any;

    const onboarded = localStorage.getItem('storeflow_onboarded') === 'true';
    if (onboarded) return 'home';
    return 'onboarding';
  });
  const [_storeId, setStoreId] = useState<string | null>(null);
  const [store, setStore] = useState<any>(null);
  // Hydrate synchronously so an external camera deep link can use its exact
  // cached store during the very first routing effect. Hydrating later in a
  // separate effect left a startup window where a transient refresh could
  // replace an already displayed store with Store Not Found.
  const [allStores, setAllStores] = useState<Store[]>(readCachedStores);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [loading, setLoading] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const storeLoadRequestRef = useRef(0);
  /** When the store directory was last fetched, so it is not refetched on a timer. */
  const lastStoresLoadRef = useRef(0);
  /** True once the tracked order reaches a status it can never leave. */
  const settledRef = useRef(false);
  const activeStoreRef = useRef<any>(null);
  const initialRouteHandledRef = useRef(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [deepLinkedProductId, setDeepLinkedProductId] = useState<string | null>(null);

  // Redesign state management additions
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('storeflow_favorites') || '[]');
    } catch {
      return [];
    }
  });
  const [sortBy, setSortBy] = useState<'default' | 'price_asc' | 'price_desc' | 'name_asc'>('default');
  const [showInStockOnly, setShowInStockOnly] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [isStoreFavorited, setIsStoreFavorited] = useState(false);
  
  useEffect(() => {
    if (store?.id) {
      setIsStoreFavorited(localStorage.getItem('storeflow_fav_store_' + store.id) === 'true');
    }
  }, [store?.id]);

  useEffect(() => {
    activeStoreRef.current = store;
  }, [store]);

  // Proper SPA navigation history: every screen change gets its own browser
  // history entry with distinguishing state. Previously, screen changes
  // (Home → Explore → Cart → History, etc.) never touched browser history
  // at all — only entering a store did. That meant a swipe-back gesture had
  // no in-app history to return to, so the browser fell through to
  // reloading/exiting instead of going back one screen, which is exactly
  // the "swipe back reloads the page" bug. This also replaces a previous
  // effect that pushed '/' for every "root" screen with no state attached —
  // that collapsed Home/Explore/Onboarding/Login/Location onto the exact
  // same history entry, making them indistinguishable to the back button.

  const navigateToScreen = useCallback((newScreen: typeof screen, opts?: { replace?: boolean }) => {
    setScreen(newScreen);
    // A store route needs the resolved store identifier. loadStoreDetails owns
    // that history entry so callers cannot push an incomplete `screen: store`
    // entry at `/` while the resolver is still in flight.
    if (newScreen === 'store') return;
    const path = SCREEN_PATHS[newScreen] ?? window.location.pathname;
    const state = { screen: newScreen };
    if (opts?.replace) {
      window.history.replaceState(state, '', path);
    } else if (window.history.state?.screen !== newScreen) {
      window.history.pushState(state, '', path);
    }
  }, []);

  // For in-app "back" arrows: reuse the real browser history stack instead
  // of pushing a new forward entry. Pushing a new entry (as the Tracking
  // screen's back arrow used to, via navigateToScreen('store')) leaves the
  // back-stack with an extra synthetic entry that doesn't match what the
  // user just did, so a follow-up physical/gesture back-press can land
  // somewhere unexpected. Falls back to navigateToScreen if there's
  // nothing to go back to (e.g. this screen was opened as a direct link).
  const goBack = useCallback((fallbackScreen: typeof screen) => {
    if (window.history.state?.screen) {
      window.history.back();
    } else {
      navigateToScreen(fallbackScreen);
    }
  }, [navigateToScreen]);

  const toggleStoreFavorite = () => {
    if (!store?.id) return;
    const next = !isStoreFavorited;
    setIsStoreFavorited(next);
    localStorage.setItem('storeflow_fav_store_' + store.id, String(next));
  };
  
  // Pull-to-refresh touch tracker states
  const [touchStart, setTouchStart] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Dynamic Pricing Configuration
  const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail');

  const isStoreOpenState = useMemo(() => {
    return computeStoreOpen(store);
  }, [store]);

  const storeStatusText = useMemo(() => {
    if (!isStoreOpenState) return 'Closed';
    
    // Check if closing soon (e.g. within 30 minutes of closingTime)
    const ms = store?.data?.marketplaceSettings;
    if (ms?.closingTime) {
      try {
        const now = new Date();
        const [closeH, closeM] = ms.closingTime.split(':').map(Number);
        const closeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), closeH, closeM);
        const diffMs = closeDate.getTime() - now.getTime();
        const diffMin = diffMs / (1000 * 60);
        if (diffMin > 0 && diffMin <= 30) {
          return 'Closing Soon';
        }
      } catch (e) {
        // ignore parsing errors
      }
    }
    return 'Open';
  }, [isStoreOpenState, store]);

  /**
   * Whether this store is taking orders through the app at all.
   *
   * `onlineOrdersEnabled` is written by the merchant app onto every store and
   * was read nowhere here, so a merchant who switched online ordering off
   * still received orders. Being closed for the day is deliberately NOT part
   * of this: the storefront already tells customers "orders will be processed
   * when the store opens", so ordering ahead is intended.
   */
  const orderingBlockedReason = useMemo(() => {
    if (store?.subscription_status === 'inactive' || store?.subscription_status === 'cancelled') {
      return 'This store is not active on StoreFlow right now.';
    }
    if (store?.data?.marketplaceSettings?.onlineOrdersEnabled === false) {
      return 'This store has turned off online ordering. Contact them directly to place an order.';
    }
    return null;
  }, [store]);

  const paymentMethodsList = useMemo(() => {
    const ms = store?.data?.marketplaceSettings;
    const list = [];

    // Anything that would send the customer's money somewhere must come from
    // the merchant's own settings. These entries previously fell back to
    // placeholder details ("Access Bank: 1234567890", "08123456789") whenever
    // a store had not configured payment — a customer following those would
    // have transferred real money to an account that isn't the store's.
    // A payment route with no destination is now simply not offered.
    const walletNumber = ms?.walletNumber || ms?.opayNumber || store?.phone || '';
    // The merchant app shipped '1234567890' as a default account number, so
    // stores that saved their settings without editing published an account
    // belonging to nobody. It is a sequential dummy rather than a valid NUBAN,
    // so treating it as "not configured" is safe, and it stops a customer
    // transferring money into it before that merchant corrects their settings.
    const rawBankAccount = String(ms?.bankAccountNumber || '').trim();
    const bankAccountNumber = rawBankAccount === '1234567890' ? '' : rawBankAccount;

    if (!ms) {
      return [{ key: 'cash', icon: 'payments', label: 'Cash on Pickup / Delivery', sub: 'Pay in cash or POS on arrival' }];
    }

    if (ms.paymentWalletEnabled !== false && walletNumber) {
      list.push({ key: 'opay', icon: 'phone_android', label: 'Digital Wallet', sub: `Instant transfer to ${walletNumber}` });
    }
    if (ms.paymentTransferEnabled !== false && bankAccountNumber) {
      list.push({ key: 'transfer', icon: 'credit_card', label: 'Bank Transfer', sub: `${ms.bankName || 'Bank'}: ${bankAccountNumber}${ms.bankAccountName ? ` (${ms.bankAccountName})` : ''}` });
    }
    if (ms.paymentCashEnabled !== false) {
      list.push({ key: 'cash', icon: 'payments', label: 'Cash on Pickup / Delivery', sub: 'Pay in cash or POS on arrival' });
    }
    if (ms.paymentCardEnabled === true) {
      list.push({ key: 'card', icon: 'credit_card', label: 'Debit/Credit Card', sub: 'Pay securely online' });
    }
    if (ms.paymentPosEnabled === true) {
      list.push({ key: 'pos', icon: 'point_of_sale', label: 'POS Terminal', sub: 'Swipe card on delivery/pickup' });
    }

    if (list.length === 0) {
      list.push({ key: 'cash', icon: 'payments', label: 'Cash on Pickup / Delivery', sub: 'Pay in cash' });
    }
    return list;
  }, [store]);

  const isRetailEnabled = useMemo(() => {
    if (!store?.data || !store.data.managerSettings) return true;
    const settings = store.data.managerSettings;
    return settings.retailPricingEnabled !== false;
  }, [store]);

  const isWholesaleEnabled = useMemo(() => {
    if (store?.data?.managerSettings) {
      const settings = store.data.managerSettings;
      if (settings.wholesalePricingEnabled === false) return false;
      if (settings.wholesalePricingEnabled === true) return true;
    }
    if (store?.retailType === 'provision_wholesale') return true;
    return products.some(p => p.wholesale_price !== p.retail_price);
  }, [store, products]);

  // Sync pricing modes
  useEffect(() => {
    if (isWholesaleEnabled && !isRetailEnabled) {
      setPriceMode('wholesale');
    } else {
      setPriceMode('retail');
    }
  }, [isRetailEnabled, isWholesaleEnabled]);

  const getPrice = useCallback((p: Product) => {
    if (priceMode === 'wholesale') {
      return p.wholesale_price ?? p.selling_price;
    }
    return p.retail_price ?? p.selling_price;
  }, [priceMode]);

  // Connection/Offline state
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Cart & Modal
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Onboarding first launch detection
  const [_isOnboarded, setIsOnboarded] = useState(() => localStorage.getItem('storeflow_onboarded') === 'true');

  // Authentication State
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Location selector State
  const [selectedAddress, setSelectedAddress] = useState(() => localStorage.getItem('storeflow_address') || 'Select Location');
  // A new customer used to open the location picker and find four addresses
  // already "saved" for them — '23 Allen Avenue, Ikeja', 'Warri, Delta State'
  // and friends — sample data that was easy to pick by mistake and have an
  // order delivered to. Start empty; the list fills from what they add.
  const [savedAddresses, setSavedAddresses] = useState<string[]>(
    () => safeGetJSON<string[]>('storeflow_saved_addresses', [])
  );

  // Checkout & Order State
  const [checkoutStep, setCheckoutStep] = useState<'shopping' | 'checkout' | 'payment'>('shopping');
  const [customerName, setCustomerName] = useState(() => localStorage.getItem('storeflow_saved_checkout_name') || '');
  const [customerPhone, setCustomerPhone] = useState(() => localStorage.getItem('storeflow_saved_checkout_phone') || '');
  const [loyaltyBalance, setLoyaltyBalance] = useState<{ enabled: boolean; points: number; redeemThreshold: number; redeemValueNaira: number } | null>(null);
  const [redeemLoyalty, setRedeemLoyalty] = useState(false);
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'delivery'>(() => (localStorage.getItem('storeflow_pref_delivery_type') as any) || 'pickup');
  const [deliveryAddress, setDeliveryAddress] = useState(() => localStorage.getItem('storeflow_pref_address') || '');
  const [customerEmail, setCustomerEmail] = useState('');
  const [deliveryLandmark, setDeliveryLandmark] = useState(() => localStorage.getItem('storeflow_saved_checkout_landmark') || '');
  const [specialInstructions, setSpecialInstructions] = useState(() => localStorage.getItem('storeflow_saved_checkout_notes') || '');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'opay'>(() => (localStorage.getItem('storeflow_pref_payment_method') as any) || 'cash');
  const [orderId, setOrderId] = useState<string | null>(() => localStorage.getItem('storeflow_tracking_order_id'));
  const [orderNumber, setOrderNumber] = useState(() => localStorage.getItem('storeflow_tracking_order_number') || '');
  const [orderStatus, setOrderStatus] = useState(() => localStorage.getItem('storeflow_tracking_order_status') || 'Pending');

  // Guest order lookup — for someone tracking an order with no local history
  // on this device (fresh scan, borrowed phone, etc.)
  const [showTrackLookup, setShowTrackLookup] = useState(false);

  useEffect(() => {
    if (orderId) {
      localStorage.setItem('storeflow_tracking_order_id', orderId);
    } else {
      localStorage.removeItem('storeflow_tracking_order_id');
    }
  }, [orderId]);

  useEffect(() => {
    if (orderNumber) {
      localStorage.setItem('storeflow_tracking_order_number', orderNumber);
    } else {
      localStorage.removeItem('storeflow_tracking_order_number');
    }
  }, [orderNumber]);

  useEffect(() => {
    if (orderStatus) {
      localStorage.setItem('storeflow_tracking_order_status', orderStatus);
    } else {
      localStorage.removeItem('storeflow_tracking_order_status');
    }
  }, [orderStatus]);
  // Persisted so reopening the app on the tracking screen still shows the
  // order's contents rather than a bare status.
  const [trackedOrder, setTrackedOrder] = useState<TrackedOrder | null>(
    () => safeGetJSON<TrackedOrder | null>('storeflow_tracking_order_summary', null)
  );
  useEffect(() => {
    if (trackedOrder) safeSetJSON('storeflow_tracking_order_summary', trackedOrder);
  }, [trackedOrder]);

  const submitInFlightRef = useRef(false);
  const [orderCopied, setOrderCopied] = useState(false);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderSubmitError, setOrderSubmitError] = useState<string | null>(null);
  const [orderSubmitKind, setOrderSubmitKind] = useState<OrderFailureKind>('service');
  const [orderStatusHistory, setOrderStatusHistory] = useState<{ status: string; at: string }[]>([]);
  const [processingStage, setProcessingStage] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [storeToRemove, setStoreToRemove] = useState<{ id: string; name: string } | null>(null);
  const [cancelOrderError, setCancelOrderError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  // In-app replacement for the native browser alert() previously used to
  // report reorder outcomes — that showed the raw "storeflow-customer.vercel.app
  // says" browser dialog instead of the app's own styled UI.
  const [reorderNotice, setReorderNotice] = useState<{ tone: 'success' | 'warning' | 'error'; title: string; message: string } | null>(null);
  const CANCEL_REASONS = ['Ordered by mistake', 'Taking too long', 'Found it cheaper elsewhere', 'Changed my mind', 'Other'];
  const [scannedStoresVersion, setScannedStoresVersion] = useState(0);
  const [pendingCrossStoreAdd, setPendingCrossStoreAdd] = useState<{ product: Product; qty: number } | null>(null);
  const [ordersHistory, setOrdersHistory] = useState<Order[]>([]);
  const knownOrderStatusesRef = useRef<Map<string, string>>(new Map());
  const [orderStatusToast, setOrderStatusToast] = useState<{
    id: string;
    orderNumber: string;
    status: string;
    message: string;
    timestamp: number;
  } | null>(null);

  const [rejectionReason, setRejectionReason] = useState('');
  const [changeRequestMessage, setChangeRequestMessage] = useState('');

  // The tracking screen has always had a "Reason:" panel for a rejected order
  // and a quote box for a requested change, but nothing ever filled them in —
  // setRejectionReason was never called, so a customer whose order was turned
  // down only ever saw "The merchant rejected your order" with no explanation.
  // The status RPC already returns the merchant's message; this reads it from
  // wherever it is carried and leaves the panel hidden when there is none.
  const applyMerchantMessages = useCallback((data: any, parsedNotes: any) => {
    setRejectionReason(
      data?.rejection_reason || parsedNotes?.rejection_reason || parsedNotes?.rejectionReason || ''
    );
    setChangeRequestMessage(
      data?.change_request_message || parsedNotes?.change_request_message || parsedNotes?.changeRequestMessage || ''
    );
  }, []);

  const normalizeNigerianPhone = useCallback((num: string): string => {
    const cleaned = num.replace(/\D/g, '');
    if (cleaned.startsWith('234') && cleaned.length === 13) {
      return '+' + cleaned;
    } else if (cleaned.startsWith('0') && cleaned.length === 11) {
      return '+234' + cleaned.substring(1);
    } else if (cleaned.length === 10) {
      // A 10-digit number is already the national number without its leading
      // zero. The branch that used to follow this one re-tested `length === 10`
      // for numbers starting 7/8/9 and so could never be reached.
      return '+234' + cleaned;
    }
    return '';
  }, []);

  // const isCheckoutFormValid = ... (manual validation on click)

  // PWA Install trigger
  const [_showInstallPrompt, _setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // QR Scanner Modal State
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  // The rAF loop is created once per camera start, so reading the state
  // variable directly would capture the value it had at that moment.
  const scanSuccessRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  // Always points at the current render's loadOrdersHistory. Handlers that
  // were captured once (like the online/offline listener) would otherwise
  // call a stale mount-time version with outdated customerPhone/currentUser.
  const loadOrdersHistoryRef = useRef<() => void>(() => {});
  const [torchOn, setTorchOn] = useState(false);
  const [autoTorchTriggered, setAutoTorchTriggered] = useState(false);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualInputVal, setManualInputVal] = useState('');
  const [focusRing, setFocusRing] = useState<{ x: number; y: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  // Reused across frames so the motion check does not allocate a new
  // multi-megabyte buffer sixty times a second.
  const lastFrameSampleRef = useRef<Uint8Array | null>(null);
  const scanStartTimeRef = useRef<number>(0);
  const isProcessingFrameRef = useRef<boolean>(false);

  // Quick Order Modal
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [quickOrderInput, setQuickOrderInput] = useState('');

  // User Profile
  const [profileName, setProfileName] = useState(() => {
    const initialItsMe = loadItsMeProfile();
    return initialItsMe.displayName || localStorage.getItem('storeflow_profile_name') || '';
  });
  const [profileEmail, setProfileEmail] = useState('');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('storeflow_dark_mode') === 'true');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    // Persisting here rather than in the Profile screen's toggle handler: the
    // preference is read back on the next launch (by both this component and
    // the pre-paint script in index.html), so it has to be saved wherever the
    // preference changes, not only where one particular switch lives.
    safeSetItem('storeflow_dark_mode', String(darkMode));
    // Keeps the browser/PWA chrome (address bar, task switcher) matching the
    // theme instead of staying on the light colour baked into index.html.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', darkMode ? '#121315' : '#2F343A');
  }, [darkMode]);

  // ─── It'sMe Identity State ───────────────────────────────────────────────────
  const [itsMeProfile, setItsMeProfile] = useState<ItsMe>(() => loadItsMeProfile());
  const [showItsMeScreen, setShowItsMeScreen] = useState(false);
  const [showItsMeUpdatePrompt, setShowItsMeUpdatePrompt] = useState(false);
  const [pendingItsMeUpdate, setPendingItsMeUpdate] = useState<Partial<ItsMe> | null>(null);
  // It'sMe editable fields in profile screen
  const [itsMeEditName, setItsMeEditName] = useState('');
  const [itsMeEditPhone, setItsMeEditPhone] = useState('');
  const [itsMeEditEmail, setItsMeEditEmail] = useState('');
  const [itsMeEditInstructions, setItsMeEditInstructions] = useState('');
  const [itsMeAddressInput, setItsMeAddressInput] = useState('');
  const [itsMeLandmarkInput, setItsMeLandmarkInput] = useState('');

  // ─── Offline Support: Load Cached Data ──────────────────────────────────────

  useEffect(() => {
    const cachedStores = safeGetItem('storeflow_cached_all_stores');
    const cachedHistory = safeGetItem('storeflow_cached_orders_history');
    
    if (cachedStores) setAllStores(JSON.parse(cachedStores));
    if (cachedHistory) {
      try {
        const parsed = JSON.parse(cachedHistory);
        setOrdersHistory(parsed);
        parsed.forEach((o: any) => {
          if (o.id && o.status) {
            knownOrderStatusesRef.current.set(o.id, o.status);
          }
        });
      } catch {
        // ignore cached history parse failure
      }
    }

    // Cart loading from cache
    const cachedCart = localStorage.getItem('storeflow_cached_cart');
    if (cachedCart) setCart(JSON.parse(cachedCart));
  }, []);

  // Cache cart on updates
  useEffect(() => {
    localStorage.setItem('storeflow_cached_cart', JSON.stringify(cart));
  }, [cart]);

  // Reset checkout step to shopping when cart is opened
  useEffect(() => {
    if (isCartOpen) {
      setCheckoutStep('shopping');
    }
  }, [isCartOpen]);

  // Handle Online/Offline Status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineOrders();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Also try to sync any stuck offline orders on mount — not just when
    // transitioning from offline → online.  Previously, orders that failed
    // for transient server errors while the device was already online would
    // be queued but never retried until a full offline→online cycle happened.
    if (navigator.onLine) syncOfflineOrders();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync Offline Queue — previously used raw .insert() calls on orders/
  // order_items directly, bypassing place_order_atomic entirely. That RPC
  // is what the online path uses, and it handles the transaction atomically
  // (plus whatever else lives server-side, like inventory decrement) — a
  // raw insert here meant offline-synced orders took a completely different,
  // less safe path than online ones. Now both go through the same RPC.
  const syncOfflineOrders = async () => {
    const pending = localStorage.getItem('storeflow_pending_sync_orders');
    if (!pending) return;

    try {
      const ordersToSync: any[] = JSON.parse(pending);
      const stillFailed: any[] = [];
      for (const orderData of ordersToSync) {
        const { error } = await supabase.rpc('place_order_atomic', {
          p_store_id: orderData.order.store_id,
          p_customer_name: orderData.order.customer_name,
          p_customer_phone: orderData.order.customer_phone,
          p_order_number: orderData.order.order_number,
          p_status: orderData.order.status || 'Pending',
          p_subtotal: orderData.order.subtotal,
          p_total: orderData.order.total,
          p_notes: orderData.order.notes,
          p_items: orderData.items || []
        });
        if (error) {
          console.error('Failed to sync one offline order, will retry later:', error);
          stillFailed.push(orderData);
        }
      }
      if (stillFailed.length > 0) {
        localStorage.setItem('storeflow_pending_sync_orders', JSON.stringify(stillFailed));
      } else {
        localStorage.removeItem('storeflow_pending_sync_orders');
      }
      if (stillFailed.length < ordersToSync.length) {
        showLocalNotice('Your offline order(s) have been successfully synchronized! 🎉');
        loadOrdersHistoryRef.current();
      }
    } catch (e) {
      console.error('Failed to sync offline orders:', e);
    }
  };

  // A plain alert() for a background sync completing was jarring — use a
  // lightweight in-app notice instead when one is available, falling back
  // to alert() only if truly nothing else is wired up.
  const showLocalNotice = (msg: string) => {
    // In-app toast only — no system notification for self-initiated actions
    setOrderStatusToast({
      id: 'local-notice',
      orderNumber: '',
      status: 'info',
      message: msg,
      timestamp: Date.now(),
    });
    setTimeout(() => setOrderStatusToast(current => current?.id === 'local-notice' ? null : current), 5000);
    console.log('[StoreFlow]', msg);
  };

  // ─── PWA & Install Prompt ──────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const triggerInstall = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => {
        setDeferredPrompt(null);
        _setShowInstallPrompt(false);
      });
    } else {
      alert('Tap browser settings -> "Add to Home Screen" to install StoreFlow.');
      _setShowInstallPrompt(false);
    }
  };

  // Check user session on app mount
  useEffect(() => {
    checkSession();
  }, []);

  // Keep the full stores list fresh (Home "Your Stores" / Explore).
  //
  // This used to re-download the whole 100-store directory every 60 seconds,
  // in every open tab, whatever screen the customer was on — and separately on
  // every INSERT/UPDATE/DELETE anywhere in the `stores` table, so one merchant
  // saving a setting made every connected customer refetch all 100 records.
  // That was the single largest source of egress on the project, and none of it
  // was information a customer was waiting for: a shop directory does not
  // change minute to minute.
  //
  // It now refreshes when the app opens, and again when the customer comes back
  // to it after a while. Opening a store still fetches that store directly, so
  // nothing a customer actually looks at is staler than before.
  useEffect(() => {
    const REFRESH_AFTER_MS = 10 * 60 * 1000;

    const refreshIfStale = () => {
      if (!navigator.onLine || document.hidden) return;
      if (Date.now() - lastStoresLoadRef.current < REFRESH_AFTER_MS) return;
      loadStoresData();
    };

    // A slow tick rather than a fetch timer: it only reaches the network when
    // the list is actually old and the app is actually on screen.
    const pollId = setInterval(refreshIfStale, 60000);
    document.addEventListener('visibilitychange', refreshIfStale);

    return () => {
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, []);

  // Keep the customer's own order history fresh in the background so the
  // "Orders" nav badge and statuses (accepted/rejected/preparing) update on
  // their own, without the customer needing to open the Orders tab.
  //
  // Previously used a Supabase Realtime channel here. Guest customers have
  // no Supabase Auth session (no login required to check out), so once the
  // orders table's SELECT policy was locked down to store staff only (it
  // was previously public — any order from any customer at any store was
  // readable by anyone with just the app's public key), Realtime silently
  // stopped delivering anything to guest customers — no error, it just
  // never fires, since Realtime enforces the same RLS as normal reads.
  // Polling does the real work now; status-change notifications (which
  // used to fire off the Realtime UPDATE payload) are detected by diffing
  // inside loadOrdersHistory instead.
  useEffect(() => {
    const lookupPhone = currentUser?.phone || customerPhone || localStorage.getItem('storeflow_saved_checkout_phone');
    if (!lookupPhone) return;

    loadOrdersHistory();

    // Auto-subscribe for Web Push Notifications (allows notifications when app is closed)
    if ('Notification' in window && Notification.permission === 'granted') {
      const normalizedPhone = normalizeNigerianPhone(lookupPhone) || lookupPhone;
      subscribeUserToPush(normalizedPhone).catch(() => {});
    }

    // Order history was polled every 6 seconds, forever, for the entire life
    // of the app — even for a customer with nothing in flight, and even while
    // they sat on the Home screen. Nothing about a Completed order from last
    // week changes, so the fast cadence is now reserved for orders that are
    // genuinely still moving; everything else falls back to a slow refresh.
    // The Tracking screen keeps its own separate poll for the open order.
    //
    // Hidden means stopped, not slowed. A backgrounded tab kept fetching once
    // a minute for nobody, and the visibilitychange handler below already
    // re-fetches the moment the customer comes back, so that traffic bought
    // nothing.
    const FAST_MS = 15000;
    const IDLE_MS = 120000;

    let pollId: ReturnType<typeof setInterval> | null = null;
    let currentInterval = 0;

    const desiredInterval = () => {
      if (document.hidden) return 0;
      return hasActiveOrdersRef.current ? FAST_MS : IDLE_MS;
    };

    const startSmartPolling = () => {
      const interval = desiredInterval();
      if (pollId && interval === currentInterval) return;
      if (pollId) { clearInterval(pollId); pollId = null; }
      currentInterval = interval;
      // Zero means hidden: hold no timer at all until the app is looked at.
      if (interval === 0) return;
      pollId = setInterval(() => {
        if (navigator.onLine && !document.hidden) loadOrdersHistory();
        // Re-evaluate cadence as orders start and finish.
        if (desiredInterval() !== currentInterval) startSmartPolling();
      }, interval);
    };

    startSmartPolling();

    // When customer returns to app / tab: re-fetch AND clear stale system tray notifications
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clearAllStoreFlowNotifications();
        if (navigator.onLine) loadOrdersHistory();
      }
      startSmartPolling();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for foreground push messages from SW (shown as in-app toast instead of system notification)
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'STOREFLOW_PUSH_RECEIVED') {
        const { title, body, orderId: pushOrderId } = event.data;
        setOrderStatusToast({
          id: pushOrderId || 'push-' + Date.now(),
          orderNumber: '',
          status: title?.includes('Accepted') ? 'Accepted' : title?.includes('Ready') ? 'Ready' : 'info',
          message: `${title}: ${body}`,
          timestamp: Date.now(),
        });
        setTimeout(() => setOrderStatusToast(current => current?.timestamp === event.data.timestamp ? null : current), 6000);
        // Also refresh order data
        if (navigator.onLine) loadOrdersHistory();
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }

    return () => {
      if (pollId) clearInterval(pollId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
    };
  }, [currentUser?.phone, customerPhone, normalizeNigerianPhone]);

  // Orders still in progress — drives the badge on the bottom-nav "Orders" tab
  const activeOrdersCount = useMemo(
    () => ordersHistory.filter((o: any) => ACTIVE_ORDER_STATUSES.includes(o.status)).length,
    [ordersHistory]
  );

  // Read by the long-lived polling interval, which is set up once and must not
  // be torn down and rebuilt every time the order list changes.
  const hasActiveOrdersRef = useRef(false);
  useEffect(() => {
    hasActiveOrdersRef.current = activeOrdersCount > 0;
  }, [activeOrdersCount]);

  // Active orders first (Pending/Accepted/Preparing/Ready), finished orders
  // (Completed/Cancelled/Rejected) pushed below — so an order from last week
  // that's already done doesn't bury today's order that's still in progress.
  // Each group keeps its own most-recent-first order from the query.
  const sortedOrdersHistory = useMemo(() => {
    const active = ordersHistory.filter((o: any) => ACTIVE_ORDER_STATUSES.includes(o.status));
    const finished = ordersHistory.filter((o: any) => !ACTIVE_ORDER_STATUSES.includes(o.status));
    return [...active, ...finished];
  }, [ordersHistory]);

  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const searchFilteredOrdersHistory = useMemo(() => {
    const q = historySearchQuery.trim().toLowerCase();
    if (!q) return sortedOrdersHistory;
    return sortedOrdersHistory.filter((o: any) => {
      const cardStore = allStores.find((s: any) => s.id === o.store_id);
      let itemNames = '';
      let noteStoreName = '';
      if (o.notes) {
        try {
          const parsed = JSON.parse(o.notes);
          itemNames = (parsed.items_summary || []).map((it: any) => it.name).join(' ');
          noteStoreName = parsed.store_name || '';
        } catch { /* ignore */ }
      }
      if (itemNames === '' && o.order_items) {
        itemNames = o.order_items.map((oi: any) => oi.product?.name || '').join(' ');
      }
      const dateStr = new Date(o.created_at).toLocaleDateString();
      const haystack = [
        cardStore?.business_name, noteStoreName, o.order_number, itemNames, dateStr, o.status
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [sortedOrdersHistory, historySearchQuery, allStores]);

  const syncItsMeProfileWithCloud = async (user: any) => {
    if (!user) return;
    try {
      const local = loadItsMeProfile();
      const cloud = user.user_metadata?.itsme_profile;
      
      let merged: ItsMe;
      if (cloud) {
        merged = {
          customerId: cloud.customerId || local.customerId,
          displayName: cloud.displayName || local.displayName || user.user_metadata?.full_name || '',
          phone: cloud.phone || local.phone || user.phone || '',
          email: cloud.email || local.email || user.email || '',
          addresses: Array.from(new Set([...(cloud.addresses || []), ...(local.addresses || [])])),
          landmarks: Array.from(new Set([...(cloud.landmarks || []), ...(local.landmarks || [])])),
          deliveryInstructions: cloud.deliveryInstructions || local.deliveryInstructions || '',
          preferredPayment: cloud.preferredPayment || local.preferredPayment || 'cash',
          profilePhoto: cloud.profilePhoto || local.profilePhoto,
          dateJoined: cloud.dateJoined || local.dateJoined || new Date().toISOString(),
          lastUpdated: new Date().toISOString()
        };
      } else {
        merged = {
          ...local,
          displayName: local.displayName || user.user_metadata?.full_name || '',
          phone: local.phone || user.phone || '',
          email: local.email || user.email || '',
          lastUpdated: new Date().toISOString()
        };
      }
      
      const saved = saveItsMeProfile(merged);
      setItsMeProfile(saved);
      
      await supabase.auth.updateUser({
        data: { itsme_profile: saved }
      });
    } catch (e) {
      console.error('Failed to sync It\'sMe profile with cloud:', e);
    }
  };

  const checkSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      setCurrentUser(session.user);
      setProfileName(session.user.user_metadata?.full_name || '');
      setProfileEmail(session.user.email || '');
      setCustomerName(session.user.user_metadata?.full_name || '');
      setCustomerPhone(session.user.phone || '');
      syncItsMeProfileWithCloud(session.user);
    }
    loadStoresData();
  };

  // ─── Fetch Stores & Dynamic Products ────────────────────────────────────────

  const loadStoresData = async () => {
    // Stamped before the request, so a slow or failed call cannot let the
    // staleness check fire again immediately and pile up requests.
    lastStoresLoadRef.current = Date.now();
    try {
      const { stores: data, error } = await listPublicStorefronts();
      if (error) throw error;
      if (data) {
        setAllStores(data as unknown as Store[]);
        // A large multi-store catalog can exceed mobile localStorage. Cache
        // failures must not turn a successful Supabase response into the
        // app's offline/error path.
        safeSetJSON('storeflow_cached_all_stores', data);
      }
    } catch (e) {
      console.warn('Supabase loading error, running offline fallback:', e);
    }
  };

  const loadStoreDetails = async (sid: string) => {
    const requestId = ++storeLoadRequestRef.current;
    // Reset user rating state for new store
    setUserRating(null);
    // Never leave another merchant's catalog underneath a newly scanned name.
    setProducts([]);
    setCategories(['All']);
    setSelectedCategory('All');
    // 1. Log the exact Store ID extracted from the URL.
    console.log(`[StoreFlow QR] Exact Store ID extracted from URL: "${sid}"`);

    // INSTANT LOAD: if we've already visited this store before, show the
    // cached version immediately (no spinner) while we quietly refresh in
    // the background. This is what makes "already scanned" stores open
    // instantly instead of waiting on the network every time.
    const cachedMatch = allStores.find((s: any) => matchesPublicStoreReference(s, sid));
    let hasInstantData = false;
    if (cachedMatch) {
      setStore(cachedMatch);
      activeStoreRef.current = cachedMatch;
      setLoading(false); // don't block the UI — page renders immediately
      const cachedProducts = safeGetItem('storeflow_cached_products_' + cachedMatch.id);
      if (cachedProducts) {
        try {
          const cachedCatalog = JSON.parse(cachedProducts).filter((product: any) =>
            String(product?.store_id || '') === String(cachedMatch.id) &&
            (!isServiceStore(cachedMatch) || product?.isService === true)
          );
          setProducts(cachedCatalog);
          hasInstantData = cachedCatalog.length > 0;
        } catch { /* malformed cache is ignored */ }
      }
    } else {
      setLoading(true);
    }
    setProductsLoading(!hasInstantData);
    setErrorText(null);
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sid);
      
      // 2. Log the exact Supabase query description / structure used to find the store.
      // 3. Verify whether it searches by: store_id, id, qr_code, access_code
      console.log(`[StoreFlow QR] Constructing query for store ID "${sid}":`);
      console.log(` - Searching stores.store_id (text) for "${sid}"`);
      if (isUuid) {
        console.log(` - Searching stores.id (UUID) for "${sid}"`);
      }
      console.log(` - Searching stores.qr_code for matches containing "${sid}"`);
      console.log(` - Searching stores.access_code for "${sid}"`);

      const { store: storeData, error: storeErr } = await resolvePublicStore(sid);
      if (requestId !== storeLoadRequestRef.current) return;
      // 4. Return and log the full Supabase response and any errors.
      console.log(`[StoreFlow QR] Full Supabase response - Data:`, storeData);
      console.log(`[StoreFlow QR] Full Supabase response - Error:`, storeErr);

      if (storeErr) {
        console.error(`[StoreFlow QR] Database query error for store ID: "${sid}":`, storeErr);
        throw storeErr;
      }

      if (storeData) {
        setStore(storeData);
        activeStoreRef.current = storeData;
        // Clear cart items that belong to other stores
        setCart(prev => prev.filter(item => item.product.store_id === storeData.id));
        // Sync browser URL to represent the active store (so refreshes work)
        const storeSlug = storeData.store_id || storeData.access_code || storeData.id;
        const targetPath = `/s/${storeSlug}`;
        const historyState = { screen: 'store', storeId: storeData.id, storeRef: storeSlug };
        if (window.location.pathname === targetPath) {
          window.history.replaceState(historyState, '', targetPath);
        } else {
          window.history.pushState(historyState, '', targetPath);
        }

        try {
          const scanned = JSON.parse(localStorage.getItem('storeflow_scanned_stores') || '[]');
          if (!scanned.includes(storeData.id)) {
            scanned.push(storeData.id);
            localStorage.setItem('storeflow_scanned_stores', JSON.stringify(scanned));
          }
          // Track last-visit time per store so stores untouched for 3+ months
          // can be automatically tidied out of "My Stores" — only from this
          // customer's own device list, never touching the real store record.
          const visitMeta = JSON.parse(localStorage.getItem('storeflow_scanned_stores_meta') || '{}');
          visitMeta[storeData.id] = new Date().toISOString();
          localStorage.setItem('storeflow_scanned_stores_meta', JSON.stringify(visitMeta));
          // Re-derive "Your Stores" so a newly opened store moves to the front
          // of the list instead of waiting for some unrelated re-render.
          setScannedStoresVersion(v => v + 1);
        } catch (e) {
          console.error('[StoreFlow QR] Error saving scanned store history:', e);
        }
        // Store metadata loaded, turn off top-level spinner so header/info cards can render
        setLoading(false);

        const resolvedStoreUuid = storeData.id;
        console.log(`[StoreFlow QR] Store data loaded:`, storeData);

        const prods = await resolveStoreProducts(storeData);
        if (requestId !== storeLoadRequestRef.current) return;
        console.log(`[StoreFlow QR] Final products loaded successfully. Count: ${prods.length}`);
        setProducts(prods);
        safeSetJSON('storeflow_cached_products_' + resolvedStoreUuid, prods);

        // Dynamically compute categories list
        let cats = ['All'];
        const uniq = Array.from(new Set(prods.map(p => p.category).filter((c): c is string => !!c)));
        cats = ['All', ...uniq];
        setCategories(cats);
      } else {
        console.warn(`[StoreFlow QR] Store ID: "${sid}" not found in database.`);
        const retainedStore = cachedMatch || (
          matchesPublicStoreReference(activeStoreRef.current, sid) ? activeStoreRef.current : null
        );
        if (retainedStore) {
          // A verified/cached store must not disappear just because a later
          // background lookup returned an empty response. Keep the deep link
          // stable and let the next refresh repair the network state.
          setStore(retainedStore);
          activeStoreRef.current = retainedStore;
          setScreen('store');
          setErrorText('Showing the saved store while the connection refreshes.');
        } else {
          navigateToScreen('store_not_found');
        }
      }
    } catch (err: any) {
      console.error(`[StoreFlow QR] Critical error loading store detail for ID: "${sid}":`, err);
      setErrorText('Offline Mode: Displaying offline catalog.');
      // Attempt local storage fallback if we have a match
      if (requestId !== storeLoadRequestRef.current) return;
      const matched = allStores.find(s => matchesPublicStoreReference(s, sid)) || (
        matchesPublicStoreReference(activeStoreRef.current, sid) ? activeStoreRef.current : null
      );
      if (matched) {
        setStore(matched);
        activeStoreRef.current = matched;
        const cached = safeGetItem('storeflow_cached_products_' + matched.id);
        if (cached) {
          try { setProducts(JSON.parse(cached)); } catch { /* keep current catalog */ }
        }
        setLoading(false);
      } else {
        navigateToScreen('store_not_found');
      }
    } finally {
      if (requestId === storeLoadRequestRef.current) {
        setLoading(false);
        setProductsLoading(false);
        setRefreshing(false);
      }
    }
  };

  const statusLabelMap: Record<string, string> = useMemo(() => ({
    Accepted: 'was accepted! 🎉',
    Preparing: 'is being prepared 👨‍🍳',
    Ready: 'is ready for pickup/delivery 📦',
    Completed: 'has been completed ✅',
    Rejected: 'was declined by the store 😔',
    Cancelled: 'was cancelled ❌',
    'Changes Requested': 'requested changes on your order 📝',
  }), []);

  const checkAndNotifyOrderStatus = useCallback((orderIdToCheck: string, orderNumberStr: string, newStatus: string) => {
    if (!orderIdToCheck || !newStatus) return;
    const lastStatus = knownOrderStatusesRef.current.get(orderIdToCheck);
    knownOrderStatusesRef.current.set(orderIdToCheck, newStatus);

    if (lastStatus && lastStatus !== newStatus) {
      const label = statusLabelMap[newStatus];
      const orderNumStr = orderNumberStr ? `#${orderNumberStr}` : '';
      const message = label
        ? `Order ${orderNumStr} ${label}`.trim()
        : `Order ${orderNumStr} status updated to ${newStatus}`.trim();

      // NOTE: No showSystemNotification() here. Background push notifications
      // are handled entirely by the Edge Function + Service Worker pipeline.
      // This function only manages the IN-APP toast banner.

      const now = Date.now();
      setOrderStatusToast({
        id: orderIdToCheck,
        orderNumber: orderNumberStr,
        status: newStatus,
        message: message,
        timestamp: now,
      });

      setTimeout(() => {
        setOrderStatusToast(current => (current?.timestamp === now ? null : current));
      }, 6000);
    }
  }, [statusLabelMap]);

  const loadOrdersHistory = async () => {
    try {
      const credentials = getStoredOrderCredentials();
      let remoteOrders: any[] = [];
      if (credentials.length > 0) {
        const { data, error } = await supabase.rpc('get_customer_orders_by_tokens', { p_credentials: credentials });
        if (error) throw error;
        remoteOrders = Array.isArray(data) ? data : [];
      }

      // Keep offline/local snapshots visible while the private-token RPC
      // refreshes live statuses. The server response wins for matching rows.
      const localSnapshots = [
        ...safeGetJSON<any[]>('storeflow_orders_history', []),
        ...safeGetJSON<any[]>('storeflow_cached_orders_history', []),
      ];
      const merged = new Map<string, any>();
      for (const order of localSnapshots) {
        const key = String(order?.id || order?.order_number || '');
        if (key) merged.set(key, order);
      }
      for (const order of remoteOrders) {
        const existingKey = [...merged.entries()].find(([, cached]) => cached?.order_number === order?.order_number)?.[0];
        if (existingKey) merged.delete(existingKey);
        if (order?.id) merged.set(String(order.id), order);
      }
      const next = [...merged.values()].sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());

      // Check for status changes on any order and trigger notifications,
      // and cache each order's access token locally (covers the case where
      // this is a new device that never placed the order itself).
      for (const o of next) {
        if (o.id && o.status) {
          checkAndNotifyOrderStatus(o.id, o.order_number || '', o.status);
        }
      }

      setOrdersHistory(next);
      localStorage.setItem('storeflow_cached_orders_history', JSON.stringify(next));
    } catch (e) {
      console.warn('Orders history loading failed:', e);
    }
  };
  loadOrdersHistoryRef.current = loadOrdersHistory;

  const handleLaundryOrderPlaced = (placed: any) => {
    if (!placed?.id || !placed?.access_token) return;
    saveOrderAccessToken(String(placed.id), String(placed.access_token));
    knownOrderStatusesRef.current.set(String(placed.id), String(placed.status || 'Pending'));
    setOrdersHistory(previous => {
      const next = [placed, ...previous.filter(order => order.id !== placed.id && order.order_number !== placed.order_number)];
      safeSetJSON('storeflow_cached_orders_history', next);
      safeSetJSON('storeflow_orders_history', next);
      return next;
    });
  };

  // ─── Deep-link & Notification Click Handler ───────────────────────────────
  // Opens the exact order's tracking page when user clicks a notification
  useEffect(() => {
    const handleOpenOrder = async (targetOrderId: string, targetOrderNum?: string) => {
      if (!targetOrderId) return;
      
      // Clean up search params from URL bar
      const url = new URL(window.location.href);
      if (url.searchParams.has('tracking_order_id')) {
        url.searchParams.delete('tracking_order_id');
        window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
      }

      setOrderId(targetOrderId);
      if (targetOrderNum) setOrderNumber(targetOrderNum);

      // Clear system tray notifications for this specific order (WhatsApp-like behavior)
      clearNotificationsForOrder(targetOrderId);

      // Instantly load order status
      const accessToken = getOrderAccessToken(targetOrderId);
      const rawPhone = currentUser?.phone || customerPhone || localStorage.getItem('storeflow_saved_checkout_phone');
      if (accessToken || rawPhone) {
        const lookupPhone = normalizeNigerianPhone(rawPhone) || rawPhone;
        const statusRequest = accessToken
          ? supabase.rpc('get_customer_order_status_by_token', { p_order_id: targetOrderId, p_access_token: accessToken })
          : supabase.rpc('get_customer_order_status', { p_order_id: targetOrderId, p_customer_phone: lookupPhone });
        statusRequest
          .then(({ data }) => {
            if (data?.status) {
              setOrderStatus(data.status);
              setOrderStatusHistory(data.status_history || []);
              try {
                const parsedNotes = data.notes ? JSON.parse(data.notes) : null;
                setProcessingStage(parsedNotes?.processingStage || null);
                applyMerchantMessages(data, parsedNotes);
              } catch {
                setProcessingStage(null);
              }
            }
          });
      }

      localStorage.setItem('storeflow_tracking_order_id', targetOrderId);
      if (targetOrderNum) localStorage.setItem('storeflow_tracking_order_number', targetOrderNum);
      navigateToScreen('tracking');
    };

    // 1. Check URL parameters on mount / page load (e.g. ?tracking_order_id=uuid)
    const params = new URLSearchParams(window.location.search);
    const paramOrderId = params.get('tracking_order_id');
    if (paramOrderId) {
      handleOpenOrder(paramOrderId);
    }

    // 2. Listen for postMessage from Service Worker when tab is focused via notification tap
    const messageHandler = (event: MessageEvent) => {
      if (event.data && event.data.type === 'STOREFLOW_OPEN_ORDER' && event.data.orderId) {
        handleOpenOrder(event.data.orderId, event.data.orderNumber);
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', messageHandler);
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', messageHandler);
      }
    };
  }, [currentUser?.phone, customerPhone, normalizeNigerianPhone]);

  // ─── Order status tracking ──────────────────────────────────────────────
  //
  // Polls the open order while the Tracking screen is actually being watched,
  // and triggers notifications & history updates on status change (Accepted,
  // Preparing, Ready, Completed, Rejected, Changes Requested).
  //
  // This used to poll every 3 seconds unconditionally — 1,200 requests an hour,
  // continuing while the phone was in the customer's pocket, and continuing
  // after the order was already Completed or Cancelled and could not change
  // again. It now stops when the screen is hidden and stops for good once the
  // order reaches a final state.
  useEffect(() => {
    if (!orderId || screen !== 'tracking' || orderId.startsWith('pending-') || orderId.startsWith('offline-')) return;
    const accessToken = getOrderAccessToken(orderId);
    const rawPhone = currentUser?.phone || customerPhone || localStorage.getItem('storeflow_saved_checkout_phone');
    if (!accessToken && !rawPhone) return;
    const lookupPhone = normalizeNigerianPhone(rawPhone) || rawPhone;

    settledRef.current = false;

    const fetchStatus = () => {
      const statusRequest = accessToken
        ? supabase.rpc('get_customer_order_status_by_token', { p_order_id: orderId, p_access_token: accessToken })
        : supabase.rpc('get_customer_order_status', { p_order_id: orderId, p_customer_phone: lookupPhone });
      statusRequest
        .then(({ data, error }) => {
          if (!error && data?.status) {
            const newStatus = data.status;

            // Fire notification if merchant updated order status
            checkAndNotifyOrderStatus(orderId, orderNumber || '', newStatus);

            if (TERMINAL_ORDER_STATUSES.has(newStatus)) settledRef.current = true;

            setOrderStatus(newStatus);
            setOrderStatusHistory(data.status_history || []);
            try {
              const parsedNotes = data.notes ? JSON.parse(data.notes) : null;
              setProcessingStage(parsedNotes?.processingStage || null);
              applyMerchantMessages(data, parsedNotes);
            } catch {
              setProcessingStage(null);
            }
          }
        });
    };

    fetchStatus();

    let pollId: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (pollId) { clearInterval(pollId); pollId = null; } };
    const start = () => {
      if (pollId || document.hidden || settledRef.current) return;
      pollId = setInterval(() => {
        // A finished order cannot change again — stop asking.
        if (settledRef.current) { stop(); return; }
        if (navigator.onLine && !document.hidden) fetchStatus();
      }, TRACKING_POLL_MS);
    };

    const onVisibility = () => {
      if (document.hidden) { stop(); return; }
      // Catch up once on return, then resume the cadence.
      if (navigator.onLine && !settledRef.current) fetchStatus();
      start();
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [orderId, screen, currentUser?.phone, customerPhone, orderNumber, checkAndNotifyOrderStatus, normalizeNigerianPhone]);

  // Guest order lookup — "Track an Order" with no local history required.
  // Phone path reuses the existing get_customer_orders RPC (already
  // SECURITY DEFINER, already scoped to the phone number) and just filters
  // client-side to this store. Code path uses a new store-scoped RPC since
  // order_number alone isn't guaranteed globally unique.
  const openOrderFromLookup = (o: any) => {
    setOrderId(o.id);
    setOrderNumber(o.order_number || '');
    setOrderStatus(o.status || 'Pending');
    setOrderStatusHistory(o.status_history || []);
    try {
      const parsedNotes = o.notes ? JSON.parse(o.notes) : null;
      setProcessingStage(parsedNotes?.processingStage || null);
    } catch {
      setProcessingStage(null);
    }
    if (o.customer_phone) setCustomerPhone(o.customer_phone);
    localStorage.setItem('storeflow_tracking_order_id', o.id);
    localStorage.setItem('storeflow_tracking_order_number', o.order_number || '');
    localStorage.setItem('storeflow_tracking_order_status', o.status || 'Pending');
    setShowTrackLookup(false);
    navigateToScreen('tracking');
  };



  // Loyalty balance — fetched whenever we know both the store and a phone number
  useEffect(() => {
    if (!store?.id || !customerPhone) { setLoyaltyBalance(null); return; }
    const normalized = customerPhone.replace(/\D/g, '');
    if (!normalized) return;
    supabase
      .rpc('get_customer_loyalty_balance', { p_store_id: store.id, p_customer_phone: normalized })
      .then(({ data, error }) => {
        if (!error && data) setLoyaltyBalance(data);
      });
  }, [store?.id, customerPhone]);

  // Real-time store updates tracking
  useEffect(() => {
    if (!store?.id) return;

    const channelInstance = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(`store-updates-${store.id}-${channelInstance}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        filter: `id=eq.${store.id}`,
        schema: 'public',
        table: 'stores'
      }, (payload: any) => {
        console.log('[StoreFlow Realtime] Store updated payload received:', payload);
        if (payload.new && payload.new.id === store.id) {
          setStore(payload.new);
          void resolveStoreProducts(payload.new).then((prods: Product[]) => {
            setProducts(prods);
            const uniq = Array.from(new Set(prods.map((p: any) => p.category).filter((c: any) => !!c))) as string[];
            setCategories(['All', ...uniq]);
            safeSetJSON('storeflow_cached_products_' + payload.new.id, prods);
          }).catch(error => console.warn('[StoreFlow Realtime] Catalog refresh failed:', error));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [store?.id]);

  // ─── URL Routing / Deep Links ──────────────────────────────────────────────

  useEffect(() => {
    const handleRouting = (event?: PopStateEvent) => {
      // React StrictMode intentionally re-runs mount effects in development,
      // and a PWA handoff can also replay page startup. Resolve an external
      // camera route once; real back/forward events still run normally.
      if (!event && initialRouteHandledRef.current) return;
      if (!event) initialRouteHandledRef.current = true;
      // If this history entry carries screen state (pushed by navigateToScreen),
      // restore it instantly — no network call, no reload. This is what makes
      // swipe-back feel instant instead of reloading the page.
      const stateScreen = event?.state?.screen;
      if (stateScreen && stateScreen !== 'store') {
        setScreen(stateScreen);
        return;
      }
      // Otherwise this is a genuine store deep link (e.g. QR scan URL, or a
      // history entry from before this fix shipped) — resolve it the normal way.
      const route = parseRoute();
      const sid = event?.state?.storeId || event?.state?.storeRef || route.storeId;
      const pid = route.productId;
      if (sid) {
        setStoreId(sid);
        loadStoreDetails(sid);
        setScreen('store');
        if (pid) {
          setDeepLinkedProductId(pid);
        }
      } else {
        const path = window.location.pathname;
        const pathToScreen = Object.entries(SCREEN_PATHS).find(([_, p]) => p === path)?.[0];
        if (pathToScreen) {
          setScreen(pathToScreen as any);
        } else {
          setScreen('home');
        }
      }
    };
    window.addEventListener('popstate', handleRouting);
    handleRouting();
    return () => window.removeEventListener('popstate', handleRouting);
  }, []);

  useEffect(() => {
    if (deepLinkedProductId && products.length > 0) {
      const match = products.find(p => p.id === deepLinkedProductId);
      if (match) {
        setSelectedProduct(match);
        setDeepLinkedProductId(null);
      }
    }
  }, [deepLinkedProductId, products]);

  useEffect(() => {
    const isOverlayActive = isCartOpen || !!selectedProduct || showQuickOrder || showScanner;
    if (isOverlayActive) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [isCartOpen, selectedProduct, showQuickOrder, showScanner]);

  // ─── QR Scanner Logic ──────────────────────────────────────────────────────

  // ─── QR Scanner Logic ──────────────────────────────────────────────────────

  const applyTorchConstraint = async (enabled: boolean) => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        const capabilities = track.getCapabilities() as any;
        if (capabilities.torch) {
          await track.applyConstraints({
            advanced: [{ torch: enabled }] as any
          });
        }
      } catch (err) {
        console.log('Torch apply error', err);
      }
    }
  };

  const toggleTorch = () => {
    const next = !torchOn;
    setTorchOn(next);
    setAutoTorchTriggered(true); // Stop auto-triggering low light once manual switch happens
    applyTorchConstraint(next);
  };

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {
      console.log('Beep play error', e);
    }
  };

  const processScannedCode = async (codeValue: string) => {
    // 1. Audio and haptic feedback
    playBeep();
    if (navigator.vibrate) navigator.vibrate(120);

    setScanSuccess(true); scanSuccessRef.current = true;
    
    // Defer stop and actions slightly to show success feedback ring
    setTimeout(async () => {
      stopScanner();

      // 2. Local catalog matching if inside store screen
      if (screen === 'store' && store?.id) {
        const matched = products.find(p => p.barcode === codeValue || p.id === codeValue);
        if (matched) {
          setSelectedProduct(matched);
          return;
        }
      }

      // 3. StoreFlow secure QR / URL / store ID matching
      const { storeId: parsedStoreId, productId: parsedProductId } = parseQRCode(codeValue);
      if (parsedStoreId) {
        try {
          setLoading(true);
          const { store: storeData, error: storeErr } = await resolvePublicStore(parsedStoreId);
          if (storeErr && !storeData) {
            console.warn('[StoreFlow Scanner] Public store resolution failed:', storeErr);
          }

          if (storeData) {
            setStoreId(storeData.id);
            await loadStoreDetails(storeData.id);
            navigateToScreen('store');
            if (parsedProductId) {
              const { data: prodData } = await supabase
                .from('products')
                .select('id, store_id, category_id, barcode, sku, name, description, brand, selling_price, quantity, unit, image, status, is_service')
                .eq('id', parsedProductId)
                .maybeSingle();
              if (prodData) {
                setSelectedProduct(prodData);
              }
            }
            return;
          }
        } catch (err) {
          console.error('Store loading from scan error', err);
        } finally {
          setLoading(false);
        }
      }

      // 4. Global barcode database search
      try {
        setLoading(true);
        const { data: prodDb } = await supabase
          .from('products')
          .select('id, store_id, category_id, barcode, sku, name, description, brand, selling_price, quantity, unit, image, status, is_service')
          .eq('barcode', codeValue)
          .limit(1)
          .maybeSingle();

        if (prodDb && prodDb.store_id) {
          // Was a PostgREST `stores(*)` embed — that relied on anon having
          // direct SELECT on the raw stores table, which is now revoked
          // (cost_price/total_profit redaction fix). Fetch through the
          // redacted view instead.
          const { store: storeObj } = await resolvePublicStore(prodDb.store_id);
          if (storeObj) {
            setStore(storeObj);
            setStoreId(storeObj.id);
            await loadStoreDetails(storeObj.id);
            navigateToScreen('store');
            setSelectedProduct(prodDb);
            return;
          }
        }
      } catch (err) {
        console.error('Global barcode query error', err);
      } finally {
        setLoading(false);
      }

      // 5. Unrecognized code fallback
      setShowScanner(true);
      setScanError(`Code "${codeValue}" was detected, but no StoreFlow store or product matched it. You can enter the store code below.`);
      setShowManualInput(true);
    }, 700);
  };

  const handleTapToFocus = useCallback(async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        const capabilities = track.getCapabilities() as any;
        if (capabilities.focusMode && capabilities.focusMode.includes('auto')) {
          await track.applyConstraints({
            advanced: [{ focusMode: 'auto' }] as any
          });
          setTimeout(async () => {
            if (streamRef.current) {
              const activeTrack = streamRef.current.getVideoTracks()[0];
              if (activeTrack && capabilities.focusMode.includes('continuous')) {
                await activeTrack.applyConstraints({
                  advanced: [{ focusMode: 'continuous' }] as any
                });
              }
            }
          }, 1500);
        }
      } catch (err) {
        console.log('Tap to focus apply error', err);
      }
    }
  }, []);

  const handleViewfinderTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setFocusRing({ x, y });
    setTimeout(() => setFocusRing(null), 1000);
    handleTapToFocus();
  };

  const stopScanner = useCallback(() => {
    if (scanFrameRef.current) cancelAnimationFrame(scanFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setShowScanner(false);
    setScanError(null);
    setScanSuccess(false); scanSuccessRef.current = false;
    setTorchOn(false);
    setScanHint(null);
  }, []);

  const startScanner = useCallback(async () => {
    setScanError(null);
    setScanSuccess(false); scanSuccessRef.current = false;
    setShowScanner(true);
    setTorchOn(false);
    setAutoTorchTriggered(false);
    setScanHint(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment', 
          width: { ideal: 1920 },
          height: { ideal: 1080 } 
        }
      });
      streamRef.current = stream;
      
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities = track.getCapabilities() as any;
        if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
          try {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' }] as any
            });
          } catch (e) {
            console.log('Autofocus init fail', e);
          }
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: 'environment', 
            width: { ideal: 1280 }, 
            height: { ideal: 720 } 
          }
        });
        streamRef.current = fallbackStream;
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          videoRef.current.play();
        }
      } catch {
        setScanError('Camera access denied. Please grant permissions.');
        setShowManualInput(true);
      }
    }
  }, []);

  const handleVideoReady = useCallback(() => {
    scanStartTimeRef.current = Date.now();
    setAutoTorchTriggered(false);
    setScanHint(null);
    isProcessingFrameRef.current = false;
    lastFrameSampleRef.current = null;

    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('./workers/scanner.worker.ts', import.meta.url),
        { type: 'module' }
      );
    }

    workerRef.current.onmessage = (e) => {
      isProcessingFrameRef.current = false;
      const { result } = e.data;
      if (result) {
        processScannedCode(result);
      }
    };

    // One camera frame used to cost two full canvas read-backs, two pixel
    // loops, a fresh ~3 MB Uint8ClampedArray for the motion diff, another
    // ~3 MB copy for the worker, and a setState — sixty times a second. The
    // setState alone re-rendered the whole application on every frame while
    // the scanner was open, which is what made scanning feel laggy.
    //
    // Now: the frame is read once, analysis runs on a strided sample every
    // few frames, the previous frame is kept in a reused buffer, and the hint
    // only hits React state when it actually changes.
    const ANALYSE_EVERY = 4;
    let frameCounter = 0;
    let lastHint: string | null = null;

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || scanSuccessRef.current) {
        scanFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      // Cap the working resolution instead of processing full camera frames
      // (often 1920x1080) every tick. Decoding at full res is the main cost
      // behind slow/laggy scans - pixel loops and the ZXing/jsQR decode both
      // scale with pixel count. 900px on the long edge is still comfortably
      // above what's needed to resolve a QR/barcode held in-frame.
      const MAX_SCAN_DIM = 900;
      const scale = Math.min(1, MAX_SCAN_DIM / Math.max(video.videoWidth, video.videoHeight));
      const targetW = Math.round(video.videoWidth * scale);
      const targetH = Math.round(video.videoHeight * scale);
      // Assigning width/height reallocates and clears the backing store, so
      // only do it when the camera resolution actually changes.
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        scanFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      // A single draw, already contrast-enhanced and greyscaled, feeds both
      // the frame analysis and the decoder.
      ctx.filter = 'contrast(1.5) brightness(1.2) grayscale(1.0)';
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const pixelCount = data.length / 4;

      frameCounter++;
      if (frameCounter % ANALYSE_EVERY === 0) {
        const STRIDE = 16;
        let totalLuminance = 0;
        let samples = 0;
        let diffCount = 0;
        const previous = lastFrameSampleRef.current;
        const sampleCount = Math.ceil(pixelCount / STRIDE);
        const sample = previous && previous.length === sampleCount ? previous : new Uint8Array(sampleCount);

        for (let i = 0, n = 0; i < pixelCount; i += STRIDE, n++) {
          // The frame is already greyscale, so one channel is the luminance.
          const lum = data[i * 4];
          totalLuminance += lum;
          samples++;
          if (previous && previous.length === sampleCount && Math.abs(lum - previous[n]) > 30) diffCount++;
          sample[n] = lum;
        }

        const hadPrevious = previous && previous.length === sampleCount;
        lastFrameSampleRef.current = sample;

        const avgLuminance = samples ? totalLuminance / samples : 255;
        let hint: string | null = null;
        if (avgLuminance < 45) {
          hint = 'More light needed';
          if (!autoTorchTriggered) {
            setAutoTorchTriggered(true);
            setTorchOn(true);
            applyTorchConstraint(true);
          }
        }
        if (hadPrevious && diffCount / samples > 0.15) hint = 'Hold steady';
        if (!hint && Date.now() - scanStartTimeRef.current > 3000) hint = 'Move closer';

        // Only touch React state when the message the customer sees changes.
        if (hint !== lastHint) {
          lastHint = hint;
          setScanHint(hint);
        }
      }

      if (workerRef.current && !isProcessingFrameRef.current) {
        isProcessingFrameRef.current = true;
        const buf = data.buffer.slice(0);
        workerRef.current.postMessage({
          dataArray: buf,
          width: imageData.width,
          height: imageData.height
        }, [buf]);
      }

      scanFrameRef.current = requestAnimationFrame(tick);
    };

    scanFrameRef.current = requestAnimationFrame(tick);
  }, [autoTorchTriggered]);

  // ─── Authentication Flow ───────────────────────────────────────────────────

  // LoginScreen owns the sign-in forms and talks to Supabase itself; this is
  // the only thing the rest of the app needs to know about the result.
  const handleAuthenticated = (user: any) => {
    setCurrentUser(user);
    setProfileName(user.user_metadata?.full_name || '');
    setProfileEmail(user.email || '');
    setCustomerName(user.user_metadata?.full_name || '');
    if (user.phone) setCustomerPhone(user.phone);
    navigateToScreen('home');
    syncItsMeProfileWithCloud(user);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    navigateToScreen('home');
  };

  // ─── Location & Address Selector ───────────────────────────────────────────

  const selectAddressAndSave = (addr: string) => {
    setSelectedAddress(addr);
    localStorage.setItem('storeflow_address', addr);
    navigateToScreen('home');
  };

  const persistAddressList = (list: string[]) => {
    setSavedAddresses(list);
    safeSetJSON('storeflow_saved_addresses', list);
  };

  const saveAddressList = (list: string[], select: string) => {
    persistAddressList(list);
    selectAddressAndSave(select);
  };

  const deleteAddress = (addr: string) => {
    const remaining = savedAddresses.filter(a => a !== addr);
    persistAddressList(remaining);
    if (selectedAddress !== addr) return;
    // Deleting the address that was in use used to write the replacement to
    // 'storeflow_selected_address', a key nothing ever reads back — the app
    // reads 'storeflow_address' — so the change was lost on next launch. It
    // also fell back to a hard-coded 'Lagos, Nigeria' the customer had never
    // entered; with nothing left, ask them to choose instead of inventing one.
    const fallback = remaining[0] || 'Select Location';
    setSelectedAddress(fallback);
    safeSetItem('storeflow_address', fallback);
  };

  const requestGPSLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          // This used to prefix the real coordinates with "GRA Phase II" — a
          // specific Nigerian neighbourhood — no matter where the customer
          // actually was, so "Use Current Location" saved a delivery address
          // naming a place they had never been.
          selectAddressAndSave(`Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
        },
        () => {
          alert('GPS access denied. Please type address manually.');
        }
      );
    } else {
      alert('Geolocation not supported by this browser.');
    }
  };

  // ─── Cart & Checkout Calculations ──────────────────────────────────────────

  const addToCart = (product: Product, qty = 1) => {
    // Cap at available stock — previously the "+" button had no ceiling at
    // all and let a customer add more units than the store actually has.
    const stockCap = Math.max(0, product.quantity ?? Infinity);
    setCart(prev => {
      const idx = prev.findIndex(i => i.product.id === product.id);
      if (idx !== -1) {
        const next = [...prev];
        const nq = Math.min(next[idx].quantity + qty, stockCap);
        if (nq <= 0) next.splice(idx, 1); else next[idx].quantity = nq;
        return next;
      }
      const initialQty = Math.min(qty, stockCap);
      return initialQty > 0 ? [...prev, { product, quantity: initialQty }] : prev;
    });
  };

  // For unit-priced items (kg, liter) the customer types the amount they
  // want directly — e.g. "3.5" kg of gas — rather than tapping +1 repeatedly.
  // This sets the cart line to that exact amount instead of adding a delta.
  const setCartQuantity = (product: Product, qty: number) => {
    const stockCap = Math.max(0, product.quantity ?? Infinity);
    const clamped = Math.max(0, Math.min(qty, stockCap));
    setCart(prev => {
      const idx = prev.findIndex(i => i.product.id === product.id);
      if (idx !== -1) {
        const next = [...prev];
        if (clamped <= 0) next.splice(idx, 1); else next[idx].quantity = clamped;
        return next;
      }
      return clamped > 0 ? [...prev, { product, quantity: clamped }] : prev;
    });
  };

  // Smart add-to-cart used by "Recommended For You" (and anywhere adding a
  // product that might not belong to the store currently loaded in `store`
  // state). Previously addToCart had no cross-store guard at all — nothing
  // stopped items from two different stores silently mixing in one cart,
  // even though checkout only ever submits under a single store_id. This
  // also implements the spec: single store → add immediately; multiple
  // stores with a genuine conflict → ask.
  const handleSmartAddToCart = (product: Product, qty = 1) => {
    const productStore = allStores.find((s: any) => s.id === product.store_id);
    const cartStoreId = cart[0]?.product.store_id;

    if (!cartStoreId || cartStoreId === product.store_id) {
      // No conflict — cart is empty, or already the same store.
      if (productStore && store?.id !== productStore.id) setStore(productStore);
      addToCart(product, qty);
      if (scannedStores.length > 1) {
        localStorage.setItem('storeflow_last_selected_store', product.store_id);
      }
      return;
    }

    // Genuine conflict: cart has items from a different store already.
    setPendingCrossStoreAdd({ product, qty });
  };

  const confirmCrossStoreAdd = () => {
    if (!pendingCrossStoreAdd) return;
    const { product, qty } = pendingCrossStoreAdd;
    const productStore = allStores.find((s: any) => s.id === product.store_id);
    setCart([]);
    if (productStore) setStore(productStore);
    addToCart(product, qty);
    localStorage.setItem('storeflow_last_selected_store', product.store_id);
    setPendingCrossStoreAdd(null);
  };

  const getQty = (productId: string) => cart.find(i => i.product.id === productId)?.quantity ?? 0;

  const subtotal = useMemo(() => cart.reduce((s, i) => s + getPrice(i.product) * i.quantity, 0), [cart, getPrice]);

  // The store page advertises the merchant's own delivery fee, free-delivery
  // threshold and online discount. Checkout used to ignore all three and
  // charge a flat ₦500 (free over a hard-coded ₦5,000), so the total the
  // customer was billed disagreed with the terms they had just been shown.
  // Everything below now reads from the same marketplace settings the store
  // page renders.
  const marketplaceSettings = store?.data?.marketplaceSettings ?? null;

  const pricing = useMemo(
    () => computeOrderPricing(subtotal, marketplaceSettings, { deliveryType }),
    [subtotal, marketplaceSettings, deliveryType]
  );

  const deliveryFee = pricing.deliveryFee;
  // Advertised on the store page as "Applied automatically on checkout", but
  // it was never actually subtracted from anything.
  const onlineDiscount = pricing.discount;
  // The merchant app writes `deliveryMinOrder`; the customer app only ever
  // read `minimumOrder`, a key that appears on none of the live stores — so
  // a merchant's minimum order was silently ignored. Both are accepted.
  const minimumOrder = pricing.minimumOrder;

  // Fulfilment used to offer both Store Pickup and Home Delivery to everyone,
  // regardless of what the merchant enabled.
  const fulfilment = useMemo(() => {
    const ms = store?.data?.marketplaceSettings;
    const pickup = ms?.pickupEnabled !== false;
    const delivery = ms?.deliveryEnabled !== false;
    // If a merchant somehow disabled both, fall back to pickup rather than
    // leaving the customer with no way to complete an order.
    return pickup || delivery ? { pickup, delivery } : { pickup: true, delivery: false };
  }, [store]);

  useEffect(() => {
    if (deliveryType === 'delivery' && !fulfilment.delivery) setDeliveryType('pickup');
    if (deliveryType === 'pickup' && !fulfilment.pickup) setDeliveryType('delivery');
  }, [fulfilment, deliveryType]);

  const belowMinimumOrder = pricing.belowMinimum;

  const total = pricing.total;
  const totalItemsCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);

  // ─── Place Order / Checkout Sync ───────────────────────────────────────────

  const submitOrder = async (overrides?: {
    customerName?: string; customerPhone?: string; deliveryType?: 'pickup' | 'delivery';
    deliveryAddress?: string; deliveryLandmark?: string; paymentMethod?: 'cash' | 'transfer' | 'opay';
    specialInstructions?: string;
  }) => {
    // Re-entrancy guard. The Place Order button had no disabled state, and a
    // disabled attribute alone would not have been enough: three taps in the
    // same tick all run before React re-renders, so all three passed the
    // orderSubmitting check and three separate orders reached the merchant —
    // three orders to prepare, and stock decremented three times. A ref is
    // updated synchronously, so the second tap is stopped here regardless of
    // render timing. It guards every caller, not just the button.
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    try {
      return await runSubmitOrder(overrides);
    } finally {
      submitInFlightRef.current = false;
    }
  };

  const runSubmitOrder = async (overrides?: {
    customerName?: string; customerPhone?: string; deliveryType?: 'pickup' | 'delivery';
    deliveryAddress?: string; deliveryLandmark?: string; paymentMethod?: 'cash' | 'transfer' | 'opay';
    specialInstructions?: string;
  }) => {
    // Using local "final" values instead of reading straight from state means
    // callers (like "Same as Before") can pass overrides and submit
    // immediately, without waiting on a React re-render to commit first —
    // reading state directly here would silently submit stale/empty values
    // in that one-tap scenario since state updates don't apply synchronously.
    const finalCustomerName = overrides?.customerName ?? customerName;
    const finalCustomerPhone = overrides?.customerPhone ?? customerPhone;
    const finalDeliveryType = overrides?.deliveryType ?? deliveryType;
    const finalDeliveryAddress = overrides?.deliveryAddress ?? deliveryAddress;
    const finalDeliveryLandmark = overrides?.deliveryLandmark ?? deliveryLandmark;
    const finalPaymentMethod = overrides?.paymentMethod ?? paymentMethod;
    const finalSpecialInstructions = overrides?.specialInstructions ?? specialInstructions;
    const willRedeemLoyalty = redeemLoyalty && !!loyaltyBalance?.enabled && loyaltyBalance.points >= loyaltyBalance.redeemThreshold;
    const loyaltyDiscount = willRedeemLoyalty ? loyaltyBalance!.redeemValueNaira : 0;
    // Same function the cart totals come from, so what is submitted can never
    // drift from what the customer was shown.
    const finalPricing = computeOrderPricing(subtotal, marketplaceSettings, {
      deliveryType: finalDeliveryType,
      loyaltyDiscount,
    });
    const finalDeliveryFee = finalPricing.deliveryFee;
    const finalTotal = finalPricing.total;

    if (!finalCustomerName || !finalCustomerPhone) {
      alert('Please enter your details first.');
      return;
    }

    if (belowMinimumOrder) {
      setOrderSubmitError(`This store has a ₦${minimumOrder.toLocaleString()} minimum order.`);
      return;
    }
    if (cart.length === 0) {
      alert('Your cart is empty.');
      return;
    }

    // Reflect the final values in visible state too, so if the customer
    // navigates back to checkout afterward, the form matches what was sent.
    if (overrides) {
      setCustomerName(finalCustomerName);
      setCustomerPhone(finalCustomerPhone);
      setDeliveryType(finalDeliveryType);
      if (finalDeliveryAddress) setDeliveryAddress(finalDeliveryAddress);
      if (finalDeliveryLandmark) setDeliveryLandmark(finalDeliveryLandmark);
      setPaymentMethod(finalPaymentMethod);
      if (finalSpecialInstructions) setSpecialInstructions(finalSpecialInstructions);
    }

    const genOrderNo = `SF-${Math.floor(100000 + Math.random() * 900000)}`;
    const notes = JSON.stringify({
      customer_uuid: itsMeProfile?.customerId || null,
      is_guest: !currentUser,
      delivery_type: finalDeliveryType,
      address: finalDeliveryType === 'delivery' ? finalDeliveryAddress : '',
      payment_method: finalPaymentMethod,
      instructions: finalSpecialInstructions,
      pricing_mode: priceMode,
      loyalty_discount: loyaltyDiscount || undefined,
      delivery_fee: finalDeliveryFee || undefined,
      online_discount: onlineDiscount || undefined,
      // Previously omitted entirely — order history always fell back to
      // generic "Product" / "StoreFlow Partner" placeholder text because
      // there was nothing real to read. Embedding this at order time also
      // means order history still shows correct item names even if a
      // product is later renamed or deleted from the store's catalog.
      store_name: store?.business_name || store?.storeName || 'Partner Store',
      items_summary: cart.map(item => ({
        name: item.product.name,
        quantity: item.quantity,
        price: getPrice(item.product)
      }))
    });

    // Never let a stale discovery-list entry receive an order intended for
    // the store currently on screen.
    const targetStoreId = store?.id || '';

    const orderPayload = {
      store_id: targetStoreId,
      customer_name: finalCustomerName,
      customer_phone: finalCustomerPhone,
      order_number: genOrderNo,
      status: 'Pending',
      subtotal,
      total: finalTotal,
      notes
    };
    const itemsPayload = cart.map(item => ({
      product_id: item.product.id,
      quantity: item.quantity,
      price: getPrice(item.product),
      subtotal: getPrice(item.product) * item.quantity
    }));

    // OPTIMISTIC UI: show the order as placed immediately and take the
    // customer to the tracking screen right away, instead of making them
    // wait on the network round-trip. The actual save happens in the
    // background below. Previously this was one long blocking await chain
    // (place order → wait → insert notification → wait → THEN navigate),
    // which is why order submission felt slow even on a decent connection.
    // Snapshot of what was ordered, purely for the tracking screen. The
    // tracking screen previously showed no total and no item list at all, so a
    // customer could not see what they had ordered or what it would cost. This
    // does not touch the order payload sent to the merchant.
    setTrackedOrder({
      total: finalTotal,
      subtotal,
      discount: onlineDiscount,
      deliveryFee: finalDeliveryFee,
      loyaltyDiscount,
      deliveryType: finalDeliveryType,
      paymentMethod: finalPaymentMethod,
      items: cart.map(item => ({
        name: item.product.name,
        quantity: item.quantity,
        price: getPrice(item.product),
      })),
    });

    setOrderNumber(genOrderNo);
    setOrderStatus('Pending');
    setOrderId('pending-' + Date.now());
    setOrderSubmitting(true);
    setOrderSubmitError(null);
    setCheckoutStep('shopping');
    setIsCartOpen(false);
    setCart([]);
    navigateToScreen('tracking');

    // Save checkout preferences immediately too — no reason to wait on the network for this
    localStorage.setItem('storeflow_saved_checkout_name', finalCustomerName);
    localStorage.setItem('storeflow_saved_checkout_phone', finalCustomerPhone);
    if (finalDeliveryAddress) localStorage.setItem('storeflow_pref_address', finalDeliveryAddress);
    if (finalDeliveryLandmark) localStorage.setItem('storeflow_saved_checkout_landmark', finalDeliveryLandmark);
    if (finalSpecialInstructions) localStorage.setItem('storeflow_saved_checkout_notes', finalSpecialInstructions);
    localStorage.setItem('storeflow_pref_payment_method', finalPaymentMethod);
    localStorage.setItem('storeflow_pref_delivery_type', finalDeliveryType);

    const current = loadItsMeProfile();
    const changes: Partial<ItsMe> = {};
    if (finalCustomerName && finalCustomerName !== current.displayName) changes.displayName = finalCustomerName;
    if (finalCustomerPhone && finalCustomerPhone !== current.phone) changes.phone = finalCustomerPhone;
    if (customerEmail && customerEmail !== current.email) changes.email = customerEmail;
    if (finalDeliveryAddress && !current.addresses.includes(finalDeliveryAddress)) changes.addresses = [...current.addresses, finalDeliveryAddress];
    if (finalDeliveryLandmark && !current.landmarks.includes(finalDeliveryLandmark)) changes.landmarks = [...current.landmarks, finalDeliveryLandmark];
    if (finalSpecialInstructions && finalSpecialInstructions !== current.deliveryInstructions) changes.deliveryInstructions = finalSpecialInstructions;
    if (finalPaymentMethod !== current.preferredPayment) changes.preferredPayment = finalPaymentMethod;
    if (Object.keys(changes).length > 0) {
      setPendingItsMeUpdate(changes);
      setTimeout(() => setShowItsMeUpdatePrompt(true), 800);
    }

    // Save order snapshot locally immediately so it's always accessible in customer order history
    try {
      const localHistory = JSON.parse(localStorage.getItem('storeflow_orders_history') || '[]');
      if (Array.isArray(localHistory)) {
        const localOrderRecord = {
          id: 'local-' + genOrderNo,
          order_number: genOrderNo,
          created_at: new Date().toISOString(),
          status: 'Pending',
          subtotal: orderPayload.subtotal,
          total: orderPayload.total,
          notes: orderPayload.notes,
          store_id: orderPayload.store_id,
          customer_phone: orderPayload.customer_phone,
          customer_name: orderPayload.customer_name
        };
        const updatedHistory = [localOrderRecord, ...localHistory.filter(o => o.order_number !== genOrderNo)];
        localStorage.setItem('storeflow_orders_history', JSON.stringify(updatedHistory));
      }
    } catch (e) {
      console.warn('Failed to cache local order history record:', e);
    }

    // Now do the actual network save in the background
    if (!isOnline) {
      queueOrderForOfflineSync(orderPayload, itemsPayload);
      setOrderSubmitting(false);
      loadOrdersHistory();
      return;
    }

    try {
      const orderUuid = await placeOrderWithRetry(genOrderNo, orderPayload, itemsPayload, 2);
      setOrderId(orderUuid);
      setOrderSubmitting(false);

      // Fire-and-forget: cache this order's access token locally so later
      // cancel/approve actions can prove ownership without relying on the
      // phone number alone. Non-critical if it fails.
      Promise.resolve(supabase.rpc('get_order_access_token', { p_order_id: orderUuid, p_customer_phone: orderPayload.customer_phone }))
        .then(({ data: token }: any) => {
          if (token) saveOrderAccessToken(orderUuid, token);
        })
        .catch(() => {});

      if (willRedeemLoyalty && orderPayload.store_id) {
        const normalized = finalCustomerPhone.replace(/\D/g, '');
        supabase.rpc('redeem_customer_loyalty', { p_store_id: orderPayload.store_id, p_customer_phone: normalized, p_order_id: orderUuid })
          .then(({ data }) => {
            if (data?.success) {
              setLoyaltyBalance(prev => prev ? { ...prev, points: data.remainingPoints } : prev);
            }
          });
        setRedeemLoyalty(false);
      }

      // Register background Web Push subscription
      subscribeUserToPush(customerPhone || customerName).catch(() => {});

      // Merchant notification insert
      if (orderPayload.store_id) {
        supabase.from('notifications').insert({
          store_id: orderPayload.store_id,
          title: 'New Order',
          message: `${finalCustomerName} placed Order #${genOrderNo} containing ${totalItemsCount} items.`,
          type: 'new_order',
          is_read: false
        }).then(({ error }) => {
          if (error) console.warn('Failed to create order notification in db:', error);
        });
      }

      knownOrderStatusesRef.current.set(orderUuid, 'Pending');
      loadOrdersHistory();
    } catch (e: any) {
      console.error('Order placement failed:', e);
      setOrderSubmitting(false);

      // What the customer is told is decided in one place — see
      // describeOrderFailure. This used to print the server's message
      // verbatim, which meant a suspended Supabase project told shoppers to
      // "upgrade their plan or remove spend caps".
      const failure = describeOrderFailure(e);
      setOrderSubmitKind(failure.kind);
      setOrderSubmitError(failure.message);

      // Only an offline order is worth keeping: it is the only failure where
      // sending the same thing again later will succeed. A rejected order
      // would fail identically, and a service outage may last long enough
      // that quietly placing the order afterwards would surprise the
      // customer.
      if (failure.kind === 'offline') {
        queueOrderForOfflineSync(orderPayload, itemsPayload);
      }
      loadOrdersHistory();
    }
  };

  // Retries transient network failures a couple times before giving up.
  // Previously had a "Strategy 2" direct-insert fallback that could never
  // actually work: RLS blocks the post-INSERT SELECT for anonymous users,
  // so the .select('id').single() always returned an error, causing every
  // order to silently fall into the offline queue (which itself was never
  // drained while online). Now we rely solely on the atomic RPC, which is
  // SECURITY DEFINER and bypasses RLS properly.
  const placeOrderWithRetry = async (
    genOrderNo: string,
    orderPayload: { store_id: string; customer_name: string; customer_phone: string; order_number: string; status: string; subtotal: number; total: number; notes: string },
    itemsPayload: { product_id: string; quantity: number; price: number; subtotal: number }[],
    retriesLeft: number
  ): Promise<string> => {
    // 1. Resolve store ID fallback if missing
    const resolvedStoreId = orderPayload.store_id || store?.id;
    if (resolvedStoreId) {
      orderPayload.store_id = resolvedStoreId;
    }

    if (!orderPayload.store_id) {
      throw new Error('No store selected — please scan the store QR code and try again.');
    }

    try {
      const { data: orderUuid, error: orderErr } = await supabase.rpc('place_order_atomic', {
        p_store_id: orderPayload.store_id,
        p_customer_name: orderPayload.customer_name,
        p_customer_phone: orderPayload.customer_phone,
        p_order_number: genOrderNo,
        p_status: 'Pending',
        p_subtotal: orderPayload.subtotal,
        p_total: orderPayload.total,
        p_notes: orderPayload.notes,
        p_items: itemsPayload
      });

      if (!orderErr && orderUuid) {
        return orderUuid;
      }

      if (orderErr) {
        throw orderErr;
      }

      // RPC returned neither an error nor a UUID — should not happen, but
      // treat it as a failure so the caller can surface it to the customer.
      throw new Error('Order submission returned an unexpected empty response. Please try again.');
    } catch (e) {
      if (retriesLeft > 0) {
        await new Promise(res => setTimeout(res, 800));
        return placeOrderWithRetry(genOrderNo, orderPayload, itemsPayload, retriesLeft - 1);
      }
      throw e;
    }
  };

  const queueOrderForOfflineSync = (orderPayload: any, itemsPayload: any[]) => {
    let offlineQueue: any[] = [];
    try {
      offlineQueue = JSON.parse(localStorage.getItem('storeflow_pending_sync_orders') || '[]');
      if (!Array.isArray(offlineQueue)) offlineQueue = [];
    } catch (e) {
      // Corrupted queue data — start a fresh queue rather than throwing here
      // and losing the order this function exists to protect.
      console.error('Offline order queue was corrupted, resetting it:', e);
      offlineQueue = [];
    }
    offlineQueue.push({ order: orderPayload, items: itemsPayload });
    try {
      localStorage.setItem('storeflow_pending_sync_orders', JSON.stringify(offlineQueue));
    } catch (e) {
      // e.g. storage quota exceeded / private browsing — can't persist the
      // queue, but don't let that crash the checkout flow either.
      console.error('Failed to save offline order queue:', e);
    }
  };


  // ─── It'sMe Helpers ──────────────────────────────────────────────────────────

  const applyItsMeToCheckout = () => {
    const p = itsMeProfile;
    if (p.displayName) setCustomerName(p.displayName);
    if (p.phone) setCustomerPhone(p.phone);
    if (p.email) setCustomerEmail(p.email);
    if (p.addresses.length > 0) setDeliveryAddress(p.addresses[0]);
    if (p.landmarks.length > 0) setDeliveryLandmark(p.landmarks[0]);
    if (p.deliveryInstructions) setSpecialInstructions(p.deliveryInstructions);
    if (p.preferredPayment) setPaymentMethod(p.preferredPayment as any);
  };

  // "Same as Before" — reuses exactly what was used on the last order placed
  // on this device (address, phone, payment method, instructions, pickup/
  // delivery choice) and submits immediately in one tap, unlike "Fill with
  // It'sMe" which only prefills the form for the customer to review first.
  const hasSameAsBeforeData = () => !!localStorage.getItem('storeflow_saved_checkout_phone');

  const applySameAsBeforeAndSubmit = () => {
    const savedName = localStorage.getItem('storeflow_saved_checkout_name') || '';
    const savedPhone = localStorage.getItem('storeflow_saved_checkout_phone') || '';
    const savedAddress = localStorage.getItem('storeflow_pref_address') || '';
    const savedLandmark = localStorage.getItem('storeflow_saved_checkout_landmark') || '';
    const savedNotes = localStorage.getItem('storeflow_saved_checkout_notes') || '';
    const savedPaymentMethod = (localStorage.getItem('storeflow_pref_payment_method') as 'cash' | 'transfer' | 'opay' | null) || 'cash';
    const savedDeliveryType = (localStorage.getItem('storeflow_pref_delivery_type') as 'pickup' | 'delivery' | null) || 'pickup';

    if (!savedPhone) {
      alert("We don't have a previous order to reuse yet — please fill in your details this time.");
      return;
    }

    submitOrder({
      customerName: savedName,
      customerPhone: savedPhone,
      deliveryType: savedDeliveryType,
      deliveryAddress: savedAddress,
      deliveryLandmark: savedLandmark,
      paymentMethod: savedPaymentMethod,
      specialInstructions: savedNotes,
    });
  };

  const updateItsMeProfileAndSync = async (newProfile: ItsMe) => {
    const updated = saveItsMeProfile(newProfile);
    setItsMeProfile(updated);
    if (newProfile.displayName) {
      setProfileName(newProfile.displayName);
      localStorage.setItem('storeflow_profile_name', newProfile.displayName);
    }
    if (currentUser) {
      try {
        await supabase.auth.updateUser({
          data: { itsme_profile: updated }
        });
      } catch (e) {
        console.error('Failed to sync updated profile to cloud:', e);
      }
    }
  };

  const handleSaveDisplayName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      alert('Please enter a display name.');
      return;
    }
    setProfileName(trimmed);
    localStorage.setItem('storeflow_profile_name', trimmed);

    const updatedItsMe = {
      ...itsMeProfile,
      displayName: trimmed,
    };
    await updateItsMeProfileAndSync(updatedItsMe);
    alert('Display name updated and synchronized with your It\'sMe identity!');
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      updateItsMeProfileAndSync({ ...itsMeProfile, profilePhoto: base64String });
    };
    reader.readAsDataURL(file);
  };

  const acceptItsMeUpdate = () => {
    if (!pendingItsMeUpdate) return;
    updateItsMeProfileAndSync({ ...itsMeProfile, ...pendingItsMeUpdate });
    setPendingItsMeUpdate(null);
    setShowItsMeUpdatePrompt(false);
  };

  const dismissItsMeUpdate = () => {
    setPendingItsMeUpdate(null);
    setShowItsMeUpdatePrompt(false);
  };

  const tryBrowserAutofill = async () => {
    try {
      // Use Credential Management API (PasswordCredential) for basic identity import
      // Only standard name/email fields — no passwords
      if ('credentials' in navigator) {
        // For modern browsers — show a polite note since full autofill access is limited
        alert('To import your info, fill out the fields below and your browser\'s autofill will suggest saved values automatically when you tap each field.');
      }
    } catch {
      // ignore — autofill not supported
    }
  };

  const copyOrderNumber = () => {
    navigator.clipboard.writeText(orderNumber).then(() => {
      setOrderCopied(true);
      setTimeout(() => setOrderCopied(false), 2000);
    });
  };

  const handleCancelOrder = async (reason?: string) => {
    if (!orderId) return;
    setCancelOrderError(null);

    // Guard against optimistic/offline order IDs that don't exist as a real
    // row yet. Previously this wasn't checked, so cancelling right after
    // placing an order (before the background save finished) would silently
    // no-op against a nonexistent ID.
    if (orderId.startsWith('pending-') || orderId.startsWith('offline-')) {
      setCancelOrderError('This order is still syncing — please wait a few seconds and try again.');
      return;
    }

    const lookupPhone = currentUser?.phone || customerPhone || localStorage.getItem('storeflow_saved_checkout_phone');
    if (!lookupPhone) {
      setCancelOrderError('Unable to verify your order. Please try again.');
      return;
    }

    try {
      setLoading(true);
      // Customers have no Supabase Auth session tied to store_members, so a
      // direct .update() on orders is silently blocked by RLS (0 rows
      // affected, no error) — the previous code here had no way to detect
      // that and would show "Cancelled" even though nothing changed in the
      // database. This RPC runs server-side with elevated privilege but
      // only after verifying the caller's phone matches the order, and only
      // while the order is still Pending/Accepted.
      const { data, error } = await supabase.rpc('customer_cancel_order', {
        p_order_id: orderId,
        p_customer_phone: lookupPhone,
        p_reason: reason || null,
        p_access_token: getOrderAccessToken(orderId)
      });
      if (error) throw error;
      if (!data?.success) throw new Error('Order could not be cancelled.');

      setOrderStatus('Cancelled');
      setCancelReason('');

      // Notify merchant via Edge Function — initiated_by: "customer" ensures
      // the customer does NOT receive a push notification about their own action.
      supabase.functions.invoke('send-order-push', {
        body: {
          order_id: orderId,
          new_status: 'Cancelled',
          old_status: 'Pending',
          is_customer_update: true,
          initiated_by: 'customer'
        }
      }).catch(err => console.warn('[Push] Failed to invoke send-order-push for cancellation:', err));

      // In-app confirmation toast only (no system notification for self-action)
      setOrderStatusToast({
        id: orderId,
        orderNumber: orderNumber || '',
        status: 'Cancelled',
        message: `Order #${orderNumber || orderId.slice(0, 8)} has been cancelled.`,
        timestamp: Date.now(),
      });
      setTimeout(() => setOrderStatusToast(current => current?.id === orderId ? null : current), 6000);
      loadOrdersHistory();
    } catch (e: any) {
      // Inline banner instead of alert() — matches the style already used
      // for orderSubmitError, instead of blocking the whole screen.
      setCancelOrderError(e.message || 'Failed to cancel order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveChanges = async () => {
    if (!orderId) return;
    const lookupPhone = currentUser?.phone || customerPhone || localStorage.getItem('storeflow_saved_checkout_phone');
    if (!lookupPhone) {
      alert('Unable to verify your order. Please try again.');
      return;
    }
    try {
      setLoading(true);
      // Same class of bug as the original cancel-order issue: a guest
      // customer has no Supabase Auth session, so a direct read/update on
      // orders was silently blocked by RLS. Uses the same phone-verified
      // RPC pattern as customer_cancel_order.
      const { data, error } = await supabase.rpc('customer_approve_order_changes', {
        p_order_id: orderId,
        p_customer_phone: lookupPhone,
        p_access_token: getOrderAccessToken(orderId)
      });
      if (error) throw error;
      if (!data?.success) throw new Error('Proposal could not be approved.');

      setChangeRequestMessage(data.change_request_message || '');
      supabase.from('notifications').insert({
        store_id: store?.id || '',
        title: 'Order Changes Approved ✅',
        message: `${currentUser?.name || customerName || 'A customer'} approved changes for Order #${orderId.slice(0, 8)}.`,
        type: 'order_update',
        is_read: false
      }).then(({ error }) => {
        if (error) console.warn('Failed to create order approve notification in db:', error);
      });
      loadOrdersHistory();
      alert('Proposal approved! The merchant has been notified.');
    } catch (e: any) {
      alert(describeActionFailure(e, 'approve those changes'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Open a past order on the tracking screen.
   *
   * The three tracking fields used to be set inline from the history list,
   * which left the order summary showing whatever order was tracked last.
   * Everything the tracking screen needs is derived here, from the order's own
   * record, so the two can never disagree.
   */
  // Seeds the It'sMe editor fields from the saved profile. This was five
  // setters inlined into the Profile screen's onClick.
  // Opening a store from any list: Home cards, Explore, It'sMe favourites.
  // Opening a specific product from a recommendation card: load its store,
  // then show the product sheet on top of it.
  const openProductFromList = (product: Product) => {
    setStoreId(product.store_id);
    loadStoreDetails(product.store_id);
    setSelectedProduct(product);
    navigateToScreen('store');
  };

  const openStoreFromList = (id: string) => {
    setStoreId(id);
    loadStoreDetails(id);
    navigateToScreen('store');
  };

  const openItsMeEditor = () => {
    setItsMeEditName(itsMeProfile.displayName);
    setItsMeEditPhone(itsMeProfile.phone);
    setItsMeEditEmail(itsMeProfile.email);
    setItsMeEditInstructions(itsMeProfile.deliveryInstructions);
    setShowItsMeScreen(true);
  };

  const openOrderFromHistory = (o: any) => {
    setOrderId(o.id);
    setOrderNumber(o.order_number);
    setOrderStatus(o.status);
    setOrderSubmitting(false);
    setOrderSubmitError(null);

    let parsed: any = null;
    try { parsed = o.notes ? JSON.parse(o.notes) : null; } catch { parsed = null; }

    const items = Array.isArray(parsed?.items_summary) && parsed.items_summary.length
      ? parsed.items_summary.map((it: any) => ({
          name: String(it?.name || 'Item'),
          quantity: Number(it?.quantity) || 1,
          price: Number(it?.price) || 0,
        }))
      : (o.order_items || []).map((oi: any) => ({
          name: String(oi?.product?.name || 'Item'),
          quantity: Number(oi?.quantity) || 1,
          price: Number(oi?.price) || 0,
        }));

    const subtotalValue = Number(o.subtotal) || items.reduce((sum: number, it: any) => sum + it.price * it.quantity, 0);
    const totalValue = Number(o.total) || subtotalValue;
    setTrackedOrder({
      total: totalValue,
      subtotal: subtotalValue,
      discount: Number(parsed?.online_discount) || 0,
      deliveryFee: Number(parsed?.delivery_fee) || 0,
      loyaltyDiscount: Number(parsed?.loyalty_discount) || 0,
      deliveryType: parsed?.delivery_type === 'delivery' ? 'delivery' : 'pickup',
      paymentMethod: String(parsed?.payment_method || 'cash'),
      items,
    });

    navigateToScreen('tracking');
  };

  const handleReorder = async (order: Order) => {
    try {
      setLoading(true);

      // Always resolve the ORIGINAL order's store, never whatever store the
      // customer currently has open. This guarantees a reorder reconnects to
      // the exact same store the order was placed with.
      let targetStore = store;
      let targetProducts = products;
      if (store?.id !== order.store_id) {
        const { store: storeData, error: storeErr } = await resolvePublicStore(order.store_id);
        if (storeErr) throw storeErr;
        if (!storeData) throw new Error('The original store could not be found.');

        // Use the same JSONB-or-relational resolver store loading uses.
        // Querying the relational products table alone (as this used to)
        // returns nothing for stores whose entire catalog lives in
        // stores.data.products JSONB — which is why reorder was reporting
        // "none of the items are available" even for in-stock items.
        const resolvedProds = await resolveStoreProducts(storeData);

        targetStore = storeData;
        targetProducts = resolvedProds.filter((p: any) => p.status === 'active');
        setStore(storeData);
        setStoreId(order.store_id);
        setProducts(targetProducts);
      } else {
        targetProducts = products.filter(p => p.status === 'active');
      }

      // Don't let a customer reorder into a store that's since closed or
      // had its subscription cancelled — computeStoreOpen() is the same
      // check used to gate ordering everywhere else in the app.
      if (!computeStoreOpen(targetStore)) {
        setReorderNotice({ tone: 'warning', title: 'Store unavailable', message: "This store is currently unavailable, so we can't start a reorder from it right now." });
        return;
      }

      // Match by product_id first (from order_items — exact and immune to
      // a product later being renamed), falling back to matching by name
      // from notes.items_summary only for older orders that predate
      // order_items being reliably linked. Previously this matched by name
      // ONLY, and the order_items fallback path referenced oi.product?.name
      // even though the query that loads order history
      // (.select('*, order_items(*)')) never joins the product row — so
      // that fallback always produced the literal string "Product" and
      // could never match anything.
      const productById = new Map(targetProducts.map(p => [p.id, p]));
      const productByName = new Map(targetProducts.map(p => [p.name.trim().toLowerCase(), p]));

      const newCart: CartItem[] = [];
      const unavailable: string[] = [];

      if (order.order_items && order.order_items.length > 0) {
        for (const oi of order.order_items) {
          const match = productById.get(oi.product_id);
          if (match && match.quantity > 0) {
            newCart.push({ product: match, quantity: oi.quantity });
          } else {
            unavailable.push(match?.name || 'An item from this order');
          }
        }
      } else if (order.notes) {
        let itemsSummary: any[] = [];
        try {
          const parsed = JSON.parse(order.notes);
          itemsSummary = parsed.items_summary || [];
        } catch (e) {
          // ignore malformed notes
        }
        for (const item of itemsSummary) {
          const match = productByName.get(String(item.name || '').trim().toLowerCase());
          if (match && match.quantity > 0) {
            newCart.push({ product: match, quantity: item.quantity });
          } else {
            unavailable.push(item.name || 'An item from this order');
          }
        }
      }

      if (newCart.length > 0) {
        setCart(newCart);
        setIsCartOpen(true);
        navigateToScreen('store');
        if (unavailable.length > 0) {
          setReorderNotice({
            tone: 'warning',
            title: 'Some items were skipped',
            message: `Added ${newCart.length} item(s) back to your cart from ${targetStore?.business_name || 'this store'}. These items are no longer available: ${unavailable.join(', ')}.`,
          });
        }
      } else {
        setReorderNotice({ tone: 'error', title: 'Nothing to reorder', message: 'None of the items from this order are currently available in the store.' });
      }
    } catch (e: any) {
      setReorderNotice({ tone: 'error', title: 'Reorder failed', message: e.message || 'Something went wrong while reordering. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  function renderScanner() {
    return (
      <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center">
        {/* Manual Input Fallback Dialog */}
        {showManualInput && (
          <div className="absolute inset-0 z-[60] bg-black/90 flex items-center justify-center p-6 animate-fade-in" onClick={() => { setShowManualInput(false); setManualInputVal(''); }}>
            <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-left space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="font-extrabold text-[#1A1C1E] text-base">Find a Store or Product</h3>
              <p className="text-xs text-gray-400 font-semibold leading-relaxed">
                Enter the 6-character store code, SF store ID, StoreFlow link, or a product barcode.
              </p>
              <input
                type="text"
                value={manualInputVal}
                onChange={e => setManualInputVal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && manualInputVal.trim()) {
                    e.preventDefault();
                    setShowManualInput(false);
                    processScannedCode(manualInputVal.trim());
                    setManualInputVal('');
                  }
                }}
                className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:border-[#FFD23F] text-sm font-black tracking-wider text-[#1A1C1E]"
                placeholder="Enter store code, e.g. AMZXWE"
                autoFocus
              />
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowManualInput(false);
                    setManualInputVal('');
                  }}
                  className="flex-1 h-12 bg-gray-100 text-[#1A1C1E] font-black rounded-xl text-xs cursor-pointer hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (manualInputVal.trim()) {
                      setShowManualInput(false);
                      processScannedCode(manualInputVal.trim());
                      setManualInputVal('');
                    }
                  }}
                  className="flex-1 h-12 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-xl text-xs cursor-pointer hover:bg-black transition-colors"
                >
                  Find Store
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between z-10">
          <div>
            <div className="text-white font-extrabold text-lg tracking-tight">Smart Scanner</div>
            <div className="text-white/50 text-[11px] mt-0.5">Align QR code or barcode inside frame</div>
          </div>
          <button onClick={stopScanner} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white cursor-pointer hover:bg-white/20">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Viewfinder Guide Container */}
        <div 
          onClick={handleViewfinderTap}
          className="relative w-80 h-80 cursor-pointer overflow-hidden rounded-[32px] border border-white/5 shadow-2xl"
        >
          {/* Corner brackets */}
          {([
            { top: 12, left: 12 },
            { top: 12, right: 12 },
            { bottom: 12, left: 12 },
            { bottom: 12, right: 12 }
          ] as any[]).map((pos, i) => (
            <div key={i} style={{
              position: 'absolute', width: '32px', height: '32px',
              borderColor: scanSuccess ? '#22c55e' : '#FFD23F',
              borderStyle: 'solid', borderWidth: 0,
              ...(pos.top === 12 ? { borderTopWidth: '4px' } : { borderBottomWidth: '4px' }),
              ...(pos.left === 12 ? { borderLeftWidth: '4px' } : { borderRightWidth: '4px' }),
              borderRadius: pos.top === 12 && pos.left === 12 ? '8px 0 0 0' : pos.top === 12 ? '0 8px 0 0' : pos.left === 12 ? '0 0 8px 0' : '0 0 0 8px',
              transition: 'border-color 0.3s ease', ...pos,
              zIndex: 20
            }} />
          ))}

          {/* Tap-to-focus indicator ring */}
          {focusRing && (
            <div 
              className="absolute border-2 border-blue-400 rounded-full w-12 h-12 -translate-x-6 -translate-y-6 pointer-events-none animate-ping z-30"
              style={{ left: focusRing.x, top: focusRing.y }}
            />
          )}

          <video ref={videoRef} onCanPlay={handleVideoReady} playsInline muted
            className="w-full h-full object-cover rounded-[32px] transition-opacity duration-300"
            style={{ opacity: scanSuccess ? 0.3 : 1 }}
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Scan Success UI Overlay */}
          {scanSuccess && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 z-20">
              <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center shadow-lg animate-scale-in">
                <span className="material-symbols-outlined text-white text-3xl font-black">check</span>
              </div>
              <span className="text-green-400 font-extrabold text-sm uppercase tracking-wider">Detected!</span>
            </div>
          )}

          {/* Laser Scanner Line */}
          {!scanSuccess && !scanError && (
            <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-[#FFD23F] to-transparent animate-scan-line z-10" />
          )}

          {/* Scanning Real-time HUD Hints */}
          {scanHint && !scanSuccess && (
            <div className="absolute bottom-5 left-0 right-0 text-center z-20 animate-fade-in">
              <span className="bg-black/75 backdrop-blur-md border border-white/10 text-white text-[10px] font-black px-3.5 py-1.5 rounded-full uppercase tracking-widest shadow-lg">
                {scanHint}
              </span>
            </div>
          )}
        </div>

        {/* Camera Control Utilities */}
        <div className="flex gap-6 mt-8 items-center justify-center">
          <button 
            onClick={toggleTorch} 
            className={`w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-all shadow-lg active:scale-95 ${torchOn ? 'bg-[#FFD23F] text-[#1A1C1E]' : 'bg-white/10 text-white hover:bg-white/15'}`}
            title="Toggle Flashlight"
          >
            <span className="material-symbols-outlined text-xl">{torchOn ? 'flashlight_on' : 'flashlight_off'}</span>
          </button>
        </div>

        {scanError && (
          <div className="mt-6 mx-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 max-w-xs animate-fade-in">
            <span className="material-symbols-outlined text-red-500 text-lg shrink-0 mt-0.5">warning</span>
            <span className="text-red-300 text-xs leading-relaxed font-semibold">{scanError}</span>
          </div>
        )}

        {/* Manual Keyboard entry fallback button */}
        {!scanSuccess && (
          <button 
            onClick={() => setShowManualInput(true)} 
            className="mt-8 px-6 py-3.5 bg-white/10 hover:bg-white/15 active:scale-95 text-white font-extrabold text-[11px] uppercase tracking-wider rounded-full flex items-center gap-2 transition-all cursor-pointer shadow-md"
          >
            <span className="material-symbols-outlined text-sm">keyboard</span>
            <span>Enter Store Code Manually</span>
          </button>
        )}
      </div>
    );
  }

  // ─── ⚡ Quick Order Search & Voice ──────────────────────────────────────────

  const handleVoiceSearch = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.continuous = false;
    
    rec.onstart = () => setIsListening(true);
    rec.onend = () => setIsListening(false);
    
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setQuickOrderInput(transcript);
      setSearchQuery(transcript);
    };

    rec.start();
  };

  // ─── Search Filtering & Sorting logic ──────────────────────────────────────

  const serviceBusiness = isServiceStore(store);
const storefrontNoun = serviceBusiness ? 'Services' : 'Products';

  const filteredProducts = useMemo(() => {
    let result = products.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.brand?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
        (p.category?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      const matchStock = p.isService ? true : (!showInStockOnly || p.quantity > 0);
      return matchSearch && matchCat && matchStock;
    });

    if (sortBy === 'price_asc') {
      result = [...result].sort((a, b) => getPrice(a) - getPrice(b));
    } else if (sortBy === 'price_desc') {
      result = [...result].sort((a, b) => getPrice(b) - getPrice(a));
    } else if (sortBy === 'name_asc') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    }

    // Always sort sold-out items (quantity <= 0 or out_of_stock) to the very bottom
    result.sort((a, b) => {
      const aInStock = (a.quantity > 0 && a.status !== 'out_of_stock') ? 1 : 0;
      const bInStock = (b.quantity > 0 && b.status !== 'out_of_stock') ? 1 : 0;
      if (aInStock !== bInStock) return bInStock - aInStock;
      return 0;
    });

    return result;
  }, [products, searchQuery, selectedCategory, showInStockOnly, sortBy, getPrice]);

  const toggleFavorite = (productId: string) => {
    setFavorites(prev => {
      const next = prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId];
      localStorage.setItem('storeflow_favorites', JSON.stringify(next));
      return next;
    });
  };



  // Touch event handlers for pull-to-refresh
  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0 && !refreshing) {
      setTouchStart(e.touches[0].clientY);
    }
  };

  // Pull-to-refresh used to write React state on every touchmove event, which
  // re-rendered the entire application on every frame of the gesture and made
  // the pull itself stutter. Coalescing to one update per animation frame
  // keeps the indicator smooth without changing how it behaves.
  const pullRafRef = useRef<number | null>(null);
  const pendingPullRef = useRef(0);

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart > 0 && window.scrollY === 0 && !refreshing) {
      const currentY = e.touches[0].clientY;
      const dist = Math.max(0, currentY - touchStart);
      if (dist >= 100) return;
      pendingPullRef.current = dist;
      if (pullRafRef.current === null) {
        pullRafRef.current = requestAnimationFrame(() => {
          pullRafRef.current = null;
          setPullDistance(pendingPullRef.current);
        });
      }
    }
  };

  const handleTouchEnd = () => {
    if (pullRafRef.current !== null) {
      cancelAnimationFrame(pullRafRef.current);
      pullRafRef.current = null;
    }
    setTouchStart(0);
    if (pullDistance > 60) {
      setRefreshing(true);
      setPullDistance(30);
      if (store?.id) {
        loadStoreDetails(store.id);
      } else {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  };

  // Reset pull distance once refreshing stops
  useEffect(() => {
    if (!refreshing) {
      setPullDistance(0);
    }
  }, [refreshing]);

  const scannedStoreIds = useMemo<string[]>(() => {
    try {
      const ids: string[] = JSON.parse(localStorage.getItem('storeflow_scanned_stores') || '[]');
      const visitMeta: Record<string, string> = JSON.parse(localStorage.getItem('storeflow_scanned_stores_meta') || '{}');
      const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

      // Auto-cleanup: drop stores this customer hasn't opened in 3+ months.
      // This only ever touches this device's own local list — the store
      // itself is untouched in the database, and no other customer is
      // affected. Stores with no recorded visit time (legacy entries from
      // before this feature existed) are kept rather than assumed stale.
      const kept = ids.filter(id => {
        const lastVisit = visitMeta[id];
        if (!lastVisit) return true;
        return new Date(lastVisit).getTime() >= threeMonthsAgo;
      });
      if (kept.length !== ids.length) {
        localStorage.setItem('storeflow_scanned_stores', JSON.stringify(kept));
      }
      return kept;
    } catch {
      return [];
    }
  }, [allStores, scannedStoresVersion]); // re-derive when allStores loads or a store is manually removed

  const removeScannedStore = (storeId: string) => {
    try {
      const ids: string[] = JSON.parse(localStorage.getItem('storeflow_scanned_stores') || '[]');
      localStorage.setItem('storeflow_scanned_stores', JSON.stringify(ids.filter(id => id !== storeId)));
      const visitMeta: Record<string, string> = JSON.parse(localStorage.getItem('storeflow_scanned_stores_meta') || '{}');
      delete visitMeta[storeId];
      localStorage.setItem('storeflow_scanned_stores_meta', JSON.stringify(visitMeta));
      localStorage.removeItem('storeflow_fav_store_' + storeId);
      setScannedStoresVersion(v => v + 1);
    } catch (e) {
      console.error('Failed to remove store:', e);
    }
  };

  // Most recently opened store first. This used to be done by an external
  // script that re-appended the already-rendered cards directly into the DOM,
  // behind React's back — which both fought the reconciler and forced the
  // store name to a near-white colour on top of a white card, making it
  // invisible. Ordering the data instead keeps React the only thing that
  // writes to the DOM.
  const scannedStores = useMemo(() => {
    const visitMeta = safeGetJSON<Record<string, string>>('storeflow_scanned_stores_meta', {});
    return allStores
      .filter(s => scannedStoreIds.includes(s.id))
      .sort((a, b) => (Date.parse(visitMeta[b.id] || '') || 0) - (Date.parse(visitMeta[a.id] || '') || 0));
  }, [allStores, scannedStoreIds]);

  /**
   * Products matching what the customer typed into Quick Order, searched
   * across the stores they have actually scanned.
   *
   * The box used to have no results at all: typing filtered the Home screen
   * behind the overlay — which the overlay covers — and Enter did nothing, so
   * it read as broken. Searching the scanned stores' embedded catalogs keeps
   * this instant and offline.
   */
  const quickOrderMatches = useMemo(() => {
    const q = quickOrderInput.trim().toLowerCase();
    if (q.length < 2) return [];
    const found: Array<{ product: Product; storeName: string }> = [];
    for (const s of scannedStores) {
      const catalog = Array.isArray((s as any)?.data?.products) ? (s as any).data.products : [];
      for (const p of catalog) {
        if (found.length >= 8) return found;
        if (!p || p.discontinued === true) continue;
        const name = String(p.name || p.productName || '');
        if (!name.toLowerCase().includes(q)) continue;
        const price = Number(p.sellingPrice ?? p.selling_price ?? 0);
        found.push({
          storeName: s.business_name,
          product: {
            id: String(p.id || p.productId || name),
            store_id: s.id,
            name,
            selling_price: price,
            retail_price: price,
            wholesale_price: price,
            quantity: Number(p.quantity ?? 0),
            unit: p.unit || 'pcs',
            image: p.image || '',
            category: p.category || 'General',
            isService: p.isService === true,
            status: 'active',
          } as Product,
        });
      }
    }
    return found;
  }, [quickOrderInput, scannedStores]);

  const searchedStores = useMemo(() => {
    const base = scannedStores;
    if (!searchQuery) return base;
    return base.filter(s =>
      s.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.address?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
    );
  }, [scannedStores, searchQuery]);

  return (
    <div className={`w-full min-h-screen flex flex-col relative overflow-x-hidden antialiased ${darkMode ? 'dark bg-zinc-950 text-zinc-100' : 'bg-[#F8F9FA] text-[#1A1C1E]'}`}>


      
      {/* Offline Status Banner */}
      {!isOnline && (
        <div className="bg-rose-600 text-white text-xs py-2 px-4 text-center sticky top-0 z-[100] font-bold">
          ⚠️ You are offline. Showing cached catalog data. Sync when online.
        </div>
      )}

      {screen === 'onboarding' && (
        <OnboardingScreen
          onFinish={next => { setIsOnboarded(true); navigateToScreen(next); }}
        />
      )}

      {/* ─── 3. Login / Signup Screen ─── */}
      {screen === 'login' && (
        <LoginScreen
          initialName={profileName}
          errorText={errorText}
          onBack={() => navigateToScreen('home')}
          onAuthenticated={handleAuthenticated}
          onError={setErrorText}
        />
      )}

      {/* ─── 4. Location Selector Screen ─── */}
      {screen === 'location' && (
        <LocationScreen
          savedAddresses={savedAddresses}
          onBack={() => navigateToScreen('home')}
          onSelect={selectAddressAndSave}
          onDelete={deleteAddress}
          onSaveList={saveAddressList}
          onUseGPS={requestGPSLocation}
        />
      )}

      {/* ─── 5. Home / Discover Screen ─── */}
      {screen === 'home' && (
        <HomeScreen
          selectedAddress={selectedAddress}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          stores={searchedStores}
          products={filteredProducts}
          getPrice={getPrice}
          onScan={startScanner}
          onOpenStore={openStoreFromList}
          onRemoveStore={setStoreToRemove}
          onOpenProduct={openProductFromList}
          onAddToCart={handleSmartAddToCart}
          onOpenLocation={() => navigateToScreen('location')}
          onOpenProfile={() => navigateToScreen('profile')}
          onQuickOrder={() => setShowQuickOrder(true)}
          onInstall={deferredPrompt ? triggerInstall : null}
        />
      )}
      {/* ─── 5b. Explore Screen — All Partner Stores ─── */}
      {screen === 'explore' && (
        <ExploreScreen
          stores={allStores}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onOpenStore={openStoreFromList}
          onScan={startScanner}
        />
      )}
      {/* ─── 6. Store Details Page ─── */}
      {screen === 'store' && (
        <StoreScreen
          store={store}
          products={products}
          filteredProducts={filteredProducts}
          categories={categories}
          loading={loading}
          productsLoading={productsLoading}
          serviceBusiness={serviceBusiness}
          storefrontNoun={storefrontNoun}
          storeStatusText={storeStatusText}
          minimumOrder={minimumOrder}
          fulfilment={fulfilment}
          loyaltyBalance={loyaltyBalance}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          sortBy={sortBy}
          setSortBy={setSortBy}
          showInStockOnly={showInStockOnly}
          setShowInStockOnly={setShowInStockOnly}
          showFilterModal={showFilterModal}
          setShowFilterModal={setShowFilterModal}
          priceMode={priceMode}
          setPriceMode={setPriceMode}
          isRetailEnabled={isRetailEnabled}
          isWholesaleEnabled={isWholesaleEnabled}
          getPrice={getPrice}
          getQty={getQty}
          addToCart={addToCart}
          total={total}
          totalItemsCount={totalItemsCount}
          setIsCartOpen={setIsCartOpen}
          setSelectedProduct={setSelectedProduct}
          favorites={favorites}
          toggleFavorite={toggleFavorite}
          isStoreFavorited={isStoreFavorited}
          toggleStoreFavorite={toggleStoreFavorite}
          showReviewsModal={showReviewsModal}
          setShowReviewsModal={setShowReviewsModal}
          userRating={userRating}
          onRated={setUserRating}
          onStoreUpdated={setStore}
          customerIdentifier={customerPhone || currentUser?.phone || ''}
          showTrackLookup={showTrackLookup}
          setShowTrackLookup={setShowTrackLookup}
          onOpenLookedUpOrder={openOrderFromLookup}
          pullDistance={pullDistance}
          refreshing={refreshing}
          handleTouchStart={handleTouchStart}
          handleTouchMove={handleTouchMove}
          handleTouchEnd={handleTouchEnd}
          navigateToScreen={navigateToScreen}
          loadStoreDetails={loadStoreDetails}
          loadOrdersHistory={loadOrdersHistory}
          startScanner={startScanner}
          handleVoiceSearch={handleVoiceSearch}
          handleLaundryOrderPlaced={handleLaundryOrderPlaced}
        />
      )}
      {/* ─── 7. Order Tracking timeline ─── */}
      {screen === 'tracking' && (
        <TrackingScreen
          store={store}
          order={{
            number: orderNumber,
            status: orderStatus,
            submitting: orderSubmitting,
            submitError: orderSubmitError,
            submitErrorKind: orderSubmitKind,
            statusHistory: orderStatusHistory,
            processingStage,
            summary: trackedOrder,
          }}
          merchantMessage={{ rejectionReason, changeRequestMessage }}
          cancel={{
            error: cancelOrderError,
            clearError: () => setCancelOrderError(null),
            reason: cancelReason,
            setReason: setCancelReason,
            reasons: CANCEL_REASONS,
            showConfirm: showCancelConfirm,
            setShowConfirm: setShowCancelConfirm,
            onCancel: handleCancelOrder,
          }}
          busy={loading}
          onApproveChanges={handleApproveChanges}
          onBack={() => goBack('store')}
          onViewStore={() => navigateToScreen('store')}
          onViewOrders={() => { navigateToScreen('history'); loadOrdersHistory(); }}
          onCopyOrderNumber={copyOrderNumber}
          orderNumberCopied={orderCopied}
          onInstall={deferredPrompt ? triggerInstall : null}
          prepMinutes={getStorePrepMinutes(store)}
        />
      )}

      {/* ─── 8. Profile Hub Screen ─── */}
      {screen === 'profile' && (
        <ProfileScreen
          currentUser={currentUser}
          profileName={profileName}
          profileEmail={profileEmail}
          itsMeProfile={itsMeProfile}
          darkMode={darkMode}
          onToggleDarkMode={setDarkMode}
          onProfileNameChange={setProfileName}
          onSaveDisplayName={handleSaveDisplayName}
          onBack={() => navigateToScreen('home')}
          onOpenItsMe={openItsMeEditor}
          onOpenOrders={() => { navigateToScreen('history'); loadOrdersHistory(); }}
          onLogout={handleLogout}
          onInstall={deferredPrompt ? triggerInstall : null}
          onSignIn={() => navigateToScreen('login')}
          ordersCount={ordersHistory.length}
        />
      )}

      {/* ─── 9. Orders History Screen ─── */}
      {screen === 'history' && (
        <OrdersHistoryScreen
          orders={ordersHistory}
          visibleOrders={searchFilteredOrdersHistory}
          stores={allStores}
          activeStatuses={ACTIVE_ORDER_STATUSES}
          searchQuery={historySearchQuery}
          onSearchChange={setHistorySearchQuery}
          onBack={() => navigateToScreen('home')}
          onOpenOrder={openOrderFromHistory}
          onReorder={handleReorder}
        />
      )}
      {/* ─── 10. Store Not Found Screen ─── */}
      {screen === 'store_not_found' && (
        <StoreNotFoundScreen onGoHome={() => navigateToScreen('home')} />
      )}

      {selectedProduct && screen === 'store' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSelectedProduct(null)}>
          <div className="bg-surface w-full rounded-t-3xl overflow-hidden p-6" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-1 bg-outline-variant/30 rounded-full mx-auto mb-5"></div>
            <div className="flex justify-between items-start mb-4">
              <span className="text-xs font-bold text-secondary uppercase tracking-wider">{selectedProduct.category || 'Product Details'}</span>
              <button onClick={() => setSelectedProduct(null)} className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center cursor-pointer hover:bg-surface-container-high transition-colors">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-4 mb-6">
              <div className="w-full h-56 bg-surface-container-low rounded-2xl flex items-center justify-center overflow-hidden">
                <ProductImageWithFallback
                  src={selectedProduct.image}
                  alt={selectedProduct.name}
                  className="w-full h-full object-contain p-4"
                  productName={selectedProduct.name}
                  category={selectedProduct.category}
                  unit={selectedProduct.unit}
                  isService={selectedProduct.isService}
                />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-on-background font-headline-lg">{selectedProduct.name}</h2>
                {selectedProduct.isService && selectedProduct.turnaround && (
                  <span className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-1 rounded-full bg-secondary/10 text-secondary text-xs font-bold">
                    <span className="material-symbols-outlined text-sm">schedule</span> {selectedProduct.turnaround}
                  </span>
                )}
                <div className="flex justify-between items-center mt-2">
                  <span className="text-xl font-extrabold text-primary">
                    {store?.currency || '₦'}{getPrice(selectedProduct).toLocaleString()}
                    {selectedProduct.unit && selectedProduct.unit !== 'pcs' && (
                      <span className="text-xs font-semibold text-secondary"> / {selectedProduct.unit}</span>
                    )}
                  </span>
                  <span className={`text-xs font-semibold ${selectedProduct.quantity > 0 ? 'text-primary' : 'text-error'}`}>
                    {selectedProduct.quantity > 0 ? 'Available' : 'Out of Stock'}
                  </span>
                </div>
              </div>
              {selectedProduct.description && (
                <div>
                  <h4 className="text-xs font-bold text-secondary uppercase mb-1">Description</h4>
                  <p className="text-sm text-secondary leading-relaxed">{selectedProduct.description}</p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4 w-full">
              {getQty(selectedProduct.id) > 0 ? (
                <>
                  <div className="flex justify-between items-center bg-surface-container-low rounded-2xl p-2 border border-outline-variant/10">
                    <span className="text-xs font-bold text-secondary px-2">
                      {selectedProduct.unit && selectedProduct.unit !== 'pcs' ? `Amount (${selectedProduct.unit})` : 'Quantity in Cart'}
                    </span>
                    {selectedProduct.unit && selectedProduct.unit !== 'pcs' ? (
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={selectedProduct.unit === 'kg' || selectedProduct.unit === 'liter' ? 0.5 : 1}
                        value={getQty(selectedProduct.id)}
                        onChange={e => setCartQuantity(selectedProduct, Number(e.target.value) || 0)}
                        className="w-20 text-right font-extrabold text-base text-on-surface bg-white rounded-lg px-2 py-1.5 border border-outline-variant/20"
                      />
                    ) : (
                      <div className="flex items-center gap-4">
                        <button onClick={() => addToCart(selectedProduct, -1)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer border border-gray-100">
                          <span className="material-symbols-outlined text-lg">remove</span>
                        </button>
                        <span className="font-extrabold text-base text-on-surface">{getQty(selectedProduct.id)}</span>
                        <button onClick={() => addToCart(selectedProduct, 1)} className="w-10 h-10 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer">
                          <span className="material-symbols-outlined text-lg">add</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setSelectedProduct(null);
                      setIsCartOpen(true);
                    }}
                    className="w-full bg-black hover:bg-black/90 text-[#FFD23F] py-4 rounded-full font-black uppercase tracking-wider text-xs shadow-md active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm font-black">shopping_cart</span>
                    <span>Continue to Checkout</span>
                  </button>
                </>
              ) : (
                <button
                  disabled={selectedProduct.quantity <= 0 || store?.subscription_status === 'inactive' || store?.subscription_status === 'cancelled'}
                  onClick={() => { addToCart(selectedProduct, 1); setSelectedProduct(null); }}
                  className="flex-1 bg-primary text-on-primary py-4 rounded-full font-bold shadow-md hover:bg-primary/95 active:scale-98 transition-all cursor-pointer disabled:opacity-50"
                >
                  Add to Cart
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Cart Drawer Sheet ─── */}
      {isCartOpen && (
        <CartDrawer
          cart={cart}
          setCart={setCart}
          addToCart={addToCart}
          setCartQuantity={setCartQuantity}
          getPrice={getPrice}
          subtotal={subtotal}
          total={total}
          totalItemsCount={totalItemsCount}
          deliveryFee={deliveryFee}
          onlineDiscount={onlineDiscount}
          minimumOrder={minimumOrder}
          belowMinimumOrder={belowMinimumOrder}
          store={store}
          fulfilment={fulfilment}
          paymentMethodsList={paymentMethodsList}
          loyaltyBalance={loyaltyBalance}
          redeemLoyalty={redeemLoyalty}
          setRedeemLoyalty={setRedeemLoyalty}
          checkoutStep={checkoutStep}
          setCheckoutStep={setCheckoutStep}
          customerName={customerName}
          setCustomerName={setCustomerName}
          customerPhone={customerPhone}
          setCustomerPhone={setCustomerPhone}
          customerEmail={customerEmail}
          setCustomerEmail={setCustomerEmail}
          deliveryType={deliveryType}
          setDeliveryType={setDeliveryType}
          deliveryAddress={deliveryAddress}
          setDeliveryAddress={setDeliveryAddress}
          deliveryLandmark={deliveryLandmark}
          setDeliveryLandmark={setDeliveryLandmark}
          specialInstructions={specialInstructions}
          setSpecialInstructions={setSpecialInstructions}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          normalizeNigerianPhone={normalizeNigerianPhone}
          orderSubmitting={orderSubmitting}
          orderingBlockedReason={orderingBlockedReason}
          submitOrder={submitOrder}
          applyItsMeToCheckout={applyItsMeToCheckout}
          applySameAsBeforeAndSubmit={applySameAsBeforeAndSubmit}
          hasSameAsBeforeData={hasSameAsBeforeData}
          setIsCartOpen={setIsCartOpen}
        />
      )}
      {/* ─── Quick Order Overlay Sheet ─── */}
      {showQuickOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => { setShowQuickOrder(false); setQuickOrderInput(''); }}>
          <div className="bg-white dark:bg-zinc-900 w-full rounded-t-3xl p-6 animate-slide-up space-y-5 text-[#1A1C1E] dark:text-zinc-100 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-1 bg-gray-200 dark:bg-zinc-700 rounded-full mx-auto" />
            <div className="flex justify-between items-center text-left">
              {/* There used to be a bolt icon AND a lightning emoji in the
                  text, so this read as two lightning bolts side by side. */}
              <h3 className="font-black text-lg flex items-center gap-2">
                <span className="material-symbols-outlined text-[#FFD23F] font-black text-xl">bolt</span>
                <span>Quick Order</span>
              </h3>
              <button
                onClick={() => { setShowQuickOrder(false); setQuickOrderInput(''); }}
                aria-label="Close"
                className="w-8 h-8 rounded-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer hover:bg-gray-200 dark:hover:bg-zinc-700"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={quickOrderInput}
                onChange={e => setQuickOrderInput(e.target.value)}
                placeholder="Search your stores, or scan"
                aria-label="Search your stores"
                autoFocus
                className="flex-1 px-4 h-12 bg-white dark:bg-zinc-950 rounded-xl border border-gray-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-[#FFD23F]/50 text-sm font-semibold shadow-sm"
              />
              <button
                onClick={handleVoiceSearch}
                aria-label={isListening ? 'Listening' : 'Search by voice'}
                className={`w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer transition-colors active-scale ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700'}`}
              >
                <span className="material-symbols-outlined text-xl">{isListening ? 'mic' : 'mic_none'}</span>
              </button>
            </div>

            {/* Live results from the stores this customer has actually scanned.
                Typing used to filter the Home screen behind this overlay, which
                the overlay covers — so it looked like nothing happened, and
                Home was left filtered after closing. */}
            {quickOrderInput.trim().length >= 2 && (
              quickOrderMatches.length > 0 ? (
                <div className="space-y-1.5 text-left">
                  {quickOrderMatches.map(({ product, storeName }) => (
                    <button
                      key={product.store_id + product.id}
                      onClick={() => { setShowQuickOrder(false); setQuickOrderInput(''); openProductFromList(product); }}
                      className="w-full flex items-center justify-between gap-3 p-3 rounded-2xl border border-gray-100 dark:border-zinc-800 bg-[#F8F9FA] dark:bg-zinc-950/60 hover:border-gray-300 dark:hover:border-zinc-700 transition-colors cursor-pointer text-left"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-black truncate">{product.name}</span>
                        <span className="block text-[10px] font-semibold text-gray-400 dark:text-zinc-500 truncate">{storeName}</span>
                      </span>
                      <span className="text-xs font-black shrink-0">₦{product.selling_price.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-semibold text-gray-400 dark:text-zinc-500 text-left px-1">
                  Nothing matching that in your stores. Scan a store to add its catalog.
                </p>
              )
            )}

            <div className="grid grid-cols-2 gap-3 text-left">
              <button onClick={() => { setShowQuickOrder(false); startScanner(); }} className="p-4 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-2xl flex flex-col items-center gap-1.5 cursor-pointer active-scale shadow-sm">
                <span className="material-symbols-outlined text-[#FFD23F] text-2xl font-black">qr_code_scanner</span>
                <span className="text-xs font-black">Scan Barcode</span>
              </button>
              {/*
                This opened allStores[0] — the first entry of the global store
                discovery list, an arbitrary shop the customer had usually never
                visited — and never looked at order history at all, despite
                being labelled "Repeat Order". It now reorders the most recent
                order through the same handleReorder the Orders screen uses, and
                offers browsing instead when there is nothing to repeat.
              */}
              {sortedOrdersHistory[0] ? (
                <button
                  onClick={() => { setShowQuickOrder(false); handleReorder(sortedOrdersHistory[0]); }}
                  className="p-4 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-2xl flex flex-col items-center gap-1 cursor-pointer active-scale shadow-sm"
                >
                  <span className="material-symbols-outlined text-[#FFD23F] text-2xl font-black">history</span>
                  <span className="text-xs font-black">Repeat last order</span>
                  <span className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 truncate max-w-full">#{sortedOrdersHistory[0].order_number}</span>
                </button>
              ) : (
                <button
                  onClick={() => { setShowQuickOrder(false); navigateToScreen('explore'); }}
                  className="p-4 bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-2xl flex flex-col items-center gap-1.5 cursor-pointer active-scale shadow-sm"
                >
                  <span className="material-symbols-outlined text-[#FFD23F] text-2xl font-black">storefront</span>
                  <span className="text-xs font-black">Browse stores</span>
                </button>
              )}
            </div>

            {/*
              An "AI Smart Suggestions" card used to sit here with hard-coded
              text: "Indomie Chicken is 15% cheaper at FreshMart. Switch to save
              N120." There is no FreshMart, no such product, and no price
              comparison anywhere in this app — every customer saw that exact
              sentence forever. Removed rather than left claiming a capability
              that does not exist.
            */}
          </div>
        </div>
      )}

      {/* ─── It'sMe Identity Screen Overlay ─── */}
      {showItsMeScreen && (
        <ItsMeScreen
          profile={itsMeProfile}
          stores={allStores}
          orders={ordersHistory}
          draft={{
            name: itsMeEditName,
            phone: itsMeEditPhone,
            email: itsMeEditEmail,
            instructions: itsMeEditInstructions,
            address: itsMeAddressInput,
            landmark: itsMeLandmarkInput,
          }}
          onDraftChange={{
            name: setItsMeEditName,
            phone: setItsMeEditPhone,
            email: setItsMeEditEmail,
            instructions: setItsMeEditInstructions,
            address: setItsMeAddressInput,
            landmark: setItsMeLandmarkInput,
          }}
          onClose={() => setShowItsMeScreen(false)}
          onSaveProfile={updateItsMeProfileAndSync}
          onPhotoUpload={handlePhotoUpload}
          onAutofill={tryBrowserAutofill}
          onOpenStore={openStoreFromList}
          onOpenOrders={() => { setShowItsMeScreen(false); navigateToScreen('history'); loadOrdersHistory(); }}
          signedIn={!!currentUser}
        />
      )}
      {/* ─── Cross-Store Cart Conflict Bottom Sheet ─── */}
      {pendingCrossStoreAdd && (() => {
        const currentCartStore = allStores.find((s: any) => s.id === cart[0]?.product.store_id);
        const newProductStore = allStores.find((s: any) => s.id === pendingCrossStoreAdd.product.store_id);
        return (
          <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setPendingCrossStoreAdd(null)}>
            <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="text-center space-y-1.5">
                <span className="material-symbols-outlined text-3xl text-amber-500">storefront</span>
                <h3 className="font-black text-base text-[#1A1C1E]">Switch stores?</h3>
                <div className="flex items-center justify-center gap-3 py-2">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden">
                      <StoreBrandMark store={currentCartStore} />
                    </div>
                    <span className="text-[9px] font-bold text-gray-400 max-w-[70px] truncate">{currentCartStore?.business_name}</span>
                  </div>
                  <span className="material-symbols-outlined text-gray-300 text-lg">arrow_forward</span>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden">
                      <StoreBrandMark store={newProductStore} />
                    </div>
                    <span className="text-[9px] font-bold text-gray-400 max-w-[70px] truncate">{newProductStore?.business_name}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Your cart has items from <span className="font-bold text-[#1A1C1E]">{currentCartStore?.business_name || 'another store'}</span>.
                  Adding this item from <span className="font-bold text-[#1A1C1E]">{newProductStore?.business_name || 'this store'}</span> will start a new cart — your current items will be cleared.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPendingCrossStoreAdd(null)}
                  className="flex-1 py-3 bg-gray-100 text-[#1A1C1E] font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                >
                  Keep Current Cart
                </button>
                <button
                  onClick={confirmCrossStoreAdd}
                  className="flex-1 py-3 bg-[#1A1C1E] hover:bg-black text-[#FFD23F] font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                >
                  Switch & Add
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Reorder Notice Bottom Sheet ─── */}
      {/* Replaces the native browser alert() previously used here, which
          rendered as a raw "storeflow-customer.vercel.app says" system
          dialog instead of matching the app's own design. */}
      {reorderNotice && (() => {
        const toneStyles = {
          success: { icon: 'check_circle', iconColor: 'text-emerald-500' },
          warning: { icon: 'info', iconColor: 'text-amber-500' },
          error: { icon: 'error', iconColor: 'text-red-500' },
        }[reorderNotice.tone];
        return (
          <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setReorderNotice(null)}>
            <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm p-6 space-y-4 animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="text-center space-y-1.5">
                <span className={`material-symbols-outlined text-3xl ${toneStyles.iconColor}`}>{toneStyles.icon}</span>
                <h3 className="font-black text-base text-[#1A1C1E]">{reorderNotice.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{reorderNotice.message}</p>
              </div>
              <button
                onClick={() => setReorderNotice(null)}
                className="w-full py-3 bg-[#1A1C1E] hover:bg-black text-[#FFD23F] font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer active:scale-[0.98] transition-transform"
              >
                Got It
              </button>
            </div>
          </div>
        );
      })()}

      {/* ─── Order Status Update Floating In-App Notice ─── */}
      {orderStatusToast && (
        <div 
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] w-[92%] max-w-md bg-[#1A1C1E] text-white p-4 rounded-2xl shadow-2xl border border-white/10 flex items-center justify-between gap-3 animate-slide-down cursor-pointer"
          onClick={() => {
            openOrderFromLookup({ id: orderStatusToast.id, order_number: orderStatusToast.orderNumber, status: orderStatusToast.status });
            setOrderStatusToast(null);
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#FFD23F] text-[#1A1C1E] flex items-center justify-center font-black text-lg shrink-0">
              🔔
            </div>
            <div className="min-w-0">
              <p className="font-black text-[10px] text-[#FFD23F] uppercase tracking-wider">Order Status Update</p>
              <p className="text-xs text-gray-200 font-semibold truncate mt-0.5">{orderStatusToast.message}</p>
            </div>
          </div>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setOrderStatusToast(null);
            }}
            className="text-gray-400 hover:text-white p-1 shrink-0 cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}
      {showItsMeUpdatePrompt && pendingItsMeUpdate && (
        <div className="absolute inset-0 z-[300] flex items-end justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-t-3xl w-full p-6 space-y-4 animate-slide-up">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#1A1C1E] flex items-center justify-center shrink-0">
                <span className="text-[#FFD23F] font-black text-base">✦</span>
              </div>
              <div>
                <p className="font-black text-[#1A1C1E] text-sm">Update your It'sMe profile?</p>
                <p className="text-xs text-gray-400 font-semibold mt-0.5">You used different details for this order.</p>
              </div>
            </div>

            {/* Show what changed */}
            <div className="bg-[#F8F9FA] rounded-2xl p-4 border border-gray-100 space-y-2">
              {pendingItsMeUpdate.displayName && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400 font-semibold">Name</span>
                  <span className="font-black text-[#1A1C1E]">{pendingItsMeUpdate.displayName}</span>
                </div>
              )}
              {pendingItsMeUpdate.phone && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400 font-semibold">Phone</span>
                  <span className="font-black text-[#1A1C1E]">{pendingItsMeUpdate.phone}</span>
                </div>
              )}
              {pendingItsMeUpdate.addresses && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400 font-semibold">+ Address</span>
                  <span className="font-black text-[#1A1C1E] truncate max-w-[160px]">{pendingItsMeUpdate.addresses[pendingItsMeUpdate.addresses.length - 1]}</span>
                </div>
              )}
              {pendingItsMeUpdate.preferredPayment && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400 font-semibold">Payment</span>
                  <span className="font-black text-[#1A1C1E] capitalize">{pendingItsMeUpdate.preferredPayment}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={dismissItsMeUpdate}
                className="h-12 bg-gray-100 text-[#1A1C1E] font-black rounded-2xl text-sm cursor-pointer hover:bg-gray-200 active:scale-95 transition"
              >
                Not Now
              </button>
              <button
                onClick={acceptItsMeUpdate}
                className="h-12 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-2xl text-sm cursor-pointer hover:bg-black active:scale-95 transition"
              >
                Update ✦
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove store confirmation modal */}
      {storeToRemove && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-end sm:items-center justify-center p-4 animate-fade-in" onClick={() => setStoreToRemove(null)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-xl text-center animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center mx-auto text-2xl">
              <span className="material-symbols-outlined text-2xl">storefront</span>
            </div>
            <div className="space-y-1">
              <h3 className="font-black text-base text-[#1A1C1E]">Remove Store?</h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                Are you sure you want to remove <span className="font-bold text-gray-900">{storeToRemove.name}</span> from Your Stores? You can always re-scan it later.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStoreToRemove(null)}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-[#1A1C1E] font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  removeScannedStore(storeToRemove.id);
                  setStoreToRemove(null);
                }}
                className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition cursor-pointer shadow-md shadow-rose-500/20"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Scanner Modal */}
      {showScanner && renderScanner()}

      {/* ─── Global Bottom Navigation ─── */}
      {['home', 'explore', 'store', 'tracking', 'profile', 'history'].includes(screen) && !isCartOpen && (
        <nav className="fixed bottom-0 left-0 right-0 w-full z-40 flex justify-around items-center px-4 py-3 bg-white dark:bg-zinc-900 border-t border-gray-100 dark:border-zinc-800 shadow-[0px_-4px_20px_rgba(0,0,0,0.05)] text-[#1A1C1E] dark:text-zinc-100">
          <button onClick={() => navigateToScreen('home')} className={`flex flex-col items-center justify-center cursor-pointer ${screen === 'home' ? 'text-[#FFD23F] font-bold relative after:content-[\'\'] after:absolute after:-bottom-1 after:w-1 after:h-1 after:bg-[#FFD23F] after:rounded-full' : 'text-gray-400 dark:text-zinc-400 font-semibold hover:text-[#1A1C1E] dark:hover:text-zinc-100'}`}>
            <span className="material-symbols-outlined text-xl">home</span>
            <span className="text-[10px] mt-1">Home</span>
          </button>
          <button onClick={() => { setSearchQuery(''); navigateToScreen('explore'); }} className={`flex flex-col items-center justify-center cursor-pointer ${screen === 'explore' ? 'text-[#FFD23F] font-bold relative after:content-[\'\'] after:absolute after:-bottom-1 after:w-1 after:h-1 after:bg-[#FFD23F] after:rounded-full' : 'text-gray-400 dark:text-zinc-400 font-semibold hover:text-[#1A1C1E] dark:hover:text-zinc-100'}`}>
            <span className="material-symbols-outlined text-xl">grid_view</span>
            <span className="text-[10px] mt-1">Explore</span>
          </button>
          <button onClick={() => { navigateToScreen('history'); loadOrdersHistory(); }} className={`flex flex-col items-center justify-center cursor-pointer relative ${screen === 'history' ? 'text-[#FFD23F] font-bold relative after:content-[\'\'] after:absolute after:-bottom-1 after:w-1 after:h-1 after:bg-[#FFD23F] after:rounded-full' : 'text-gray-400 dark:text-zinc-400 font-semibold hover:text-[#1A1C1E] dark:hover:text-zinc-100'}`}>
            <span className="material-symbols-outlined text-xl">receipt_long</span>
            <span className="text-[10px] mt-1">Orders</span>
            {activeOrdersCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-[#FFD23F] text-slate-950 text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-black shadow-sm">{activeOrdersCount}</span>
            )}
          </button>
          <button onClick={() => setIsCartOpen(true)} className="flex flex-col items-center justify-center text-gray-400 dark:text-zinc-400 font-semibold hover:text-[#1A1C1E] dark:hover:text-zinc-100 relative cursor-pointer">
            <span className="material-symbols-outlined text-xl">shopping_cart</span>
            <span className="text-[10px] font-semibold mt-1">Cart</span>
            {totalItemsCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-[#FFD23F] text-slate-950 text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-black shadow-sm">{totalItemsCount}</span>
            )}
          </button>
        </nav>
      )}
    </div>
  );
}


export default App;
