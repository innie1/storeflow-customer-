import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import { parseRoute, parseQRCode } from './router';

// ─── Type Definitions ────────────────────────────────────────────────────────

interface Product {
  id: string;
  store_id: string;
  category_id?: string;
  barcode?: string;
  name: string;
  description?: string;
  brand?: string;
  cost_price?: number;
  selling_price: number;
  wholesale_price?: number;
  retail_price?: number;
  quantity: number;
  unit?: string;
  image?: string;
  status?: string;
  category?: string;
}

interface Store {
  id: string;
  business_name: string;
  phone?: string;
  address?: string;
  logo?: string;
  currency: string;
  status?: string; // 'active' | 'inactive'
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  price: number;
  subtotal: number;
  product?: Product;
}

interface Order {
  id: string;
  store_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  subtotal: number;
  total: number;
  notes?: string;
  created_at: string;
  order_items?: OrderItem[];
}

const STATUS_ORDER = ['Pending', 'Accepted', 'Preparing', 'Ready', 'Completed'];
const isStatusAtLeast = (current: string, target: string) => {
  const curIdx = STATUS_ORDER.indexOf(current);
  const tgtIdx = STATUS_ORDER.indexOf(target);
  const normCur = curIdx === -1 ? (current === 'Pending Approval' ? 0 : -1) : curIdx;
  const normTgt = tgtIdx === -1 ? (target === 'Pending Approval' ? 0 : -1) : tgtIdx;
  return normCur >= normTgt;
};

// ─── It'sMe Identity ─────────────────────────────────────────────────────────

interface ItsMe {
  customerId: string;
  displayName: string;
  phone: string;
  email: string;
  addresses: string[];
  landmarks: string[];
  deliveryInstructions: string;
  preferredPayment: string;
  profilePhoto?: string;
  dateJoined: string;
  lastUpdated: string;
}

function loadItsMeProfile(): ItsMe {
  try {
    const raw = localStorage.getItem('storeflow_itsme');
    if (raw) return JSON.parse(raw);
  } catch {}
  const id = localStorage.getItem('storeflow_customer_uuid') || crypto.randomUUID();
  localStorage.setItem('storeflow_customer_uuid', id);
  return {
    customerId: id,
    displayName: localStorage.getItem('storeflow_saved_checkout_name') || '',
    phone: localStorage.getItem('storeflow_saved_checkout_phone') || '',
    email: '',
    addresses: localStorage.getItem('storeflow_pref_address') ? [localStorage.getItem('storeflow_pref_address')!] : [],
    landmarks: localStorage.getItem('storeflow_saved_checkout_landmark') ? [localStorage.getItem('storeflow_saved_checkout_landmark')!] : [],
    deliveryInstructions: localStorage.getItem('storeflow_saved_checkout_notes') || '',
    preferredPayment: localStorage.getItem('storeflow_pref_payment_method') || 'cash',
    dateJoined: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveItsMeProfile(profile: ItsMe) {
  const updated = { ...profile, lastUpdated: new Date().toISOString() };
  localStorage.setItem('storeflow_itsme', JSON.stringify(updated));
  return updated;
}

// ─── Shared store-open logic (used by store cards AND the store detail page,
// so they never disagree the way "Closed" on Home vs "Open" on the store
// page used to) ────────────────────────────────────────────────────────────
// The merchant app's "logo" field is often a design STYLE NAME (e.g.
// "minimalist", "classic") from its built-in logo generator, not an actual
// uploaded image URL. Treating any truthy string as an <img src> silently
// fails to load and leaves a blank circle. Only real URLs should be rendered
// as an <img>; anything else should fall back to a generated initials badge.
function isLogoImageUrl(logo?: string | null): boolean {
  if (!logo) return false;
  return logo.startsWith('http://') || logo.startsWith('https://') || logo.startsWith('data:');
}

function computeStoreOpen(s: any): boolean {
  if (!s) return false;
  if (s.subscription_status === 'inactive' || s.subscription_status === 'cancelled') return false;
  const ms = s?.data?.marketplaceSettings;
  if (!ms) return true; // merchant never configured hours — default to open
  if (ms.storeOpen === false || ms.temporaryClosure === true || ms.temporarilyHidden === true) return false;
  const now = new Date();
  const dayOfWeek = now.getDay();
  if (Array.isArray(ms.businessDays) && !ms.businessDays.includes(dayOfWeek)) return false;
  if (ms.openingTime && ms.closingTime) {
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    if (timeStr < ms.openingTime || timeStr > ms.closingTime) return false;
  }
  return true;
}

function App() {
  // Navigation & State Management
  const [screen, setScreen] = useState<'splash' | 'onboarding' | 'login' | 'location' | 'home' | 'explore' | 'store' | 'tracking' | 'profile' | 'history' | 'store_not_found'>(() => {
    const { storeId } = parseRoute();
    if (storeId) return 'store';
    const onboarded = localStorage.getItem('storeflow_onboarded') === 'true';
    if (onboarded) return 'home';
    return 'onboarding';
  });
  const [_storeId, setStoreId] = useState<string | null>(null);
  const [store, setStore] = useState<any>(null);
  const [allStores, setAllStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [loading, setLoading] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
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
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [isStoreFavorited, setIsStoreFavorited] = useState(false);
  
  useEffect(() => {
    if (store?.id) {
      setIsStoreFavorited(localStorage.getItem('storeflow_fav_store_' + store.id) === 'true');
    }
  }, [store?.id]);

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
  const SCREEN_PATHS: Record<string, string> = {
    home: '/', explore: '/explore', history: '/orders', profile: '/profile',
    tracking: '/tracking', login: '/login', location: '/location', onboarding: '/onboarding',
  };
  const navigateToScreen = useCallback((newScreen: typeof screen, opts?: { replace?: boolean }) => {
    setScreen(newScreen);
    const path = SCREEN_PATHS[newScreen] ?? window.location.pathname;
    const state = { screen: newScreen };
    if (opts?.replace) {
      window.history.replaceState(state, '', path);
    } else if (window.history.state?.screen !== newScreen) {
      window.history.pushState(state, '', path);
    }
  }, []);

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
    // NOTE: the stores table has no "status" column — it's "subscription_status".
    // Using store?.status here always evaluated to undefined, which made every
    // store appear closed regardless of merchant settings.
    if (store?.subscription_status === 'inactive' || store?.subscription_status === 'cancelled') return false;
    if (!store?.data || !store.data.marketplaceSettings) {
      // No marketplace hours/toggle configured yet by the merchant — default to open
      // rather than defaulting to closed, since most merchants never touch this screen.
      return true;
    }
    const ms = store.data.marketplaceSettings;
    
    // 1. Manual switches
    if (ms.storeOpen === false || ms.temporaryClosure === true || ms.temporarilyHidden === true) {
      return false;
    }

    // 2. Business Days check
    const now = new Date();
    const dayOfWeek = now.getDay();
    if (Array.isArray(ms.businessDays) && !ms.businessDays.includes(dayOfWeek)) {
      return false;
    }

    // 3. Opening/Closing hours check
    if (ms.openingTime && ms.closingTime) {
      const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      if (timeStr < ms.openingTime || timeStr > ms.closingTime) {
        return false;
      }
    }

    return true;
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

  const paymentMethodsList = useMemo(() => {
    const ms = store?.data?.marketplaceSettings;
    const list = [];
    
    if (!ms) {
      return [
        { key: 'opay', icon: 'phone_android', label: 'OPay Wallet', sub: `Instant transfer via OPay (${store?.profile?.phone || '08123456789'})` },
        { key: 'transfer', icon: 'credit_card', label: 'Bank Transfer', sub: 'Access Bank: 1234567890 (StoreFlow)' },
        { key: 'cash', icon: 'payments', label: 'Cash on Pickup / Delivery', sub: 'Pay in cash' }
      ];
    }

    if (ms.paymentWalletEnabled !== false) {
      list.push({ key: 'opay', icon: 'phone_android', label: 'Digital Wallet', sub: `Instant transfer via OPay (${store?.profile?.phone || '08123456789'})` });
    }
    if (ms.paymentTransferEnabled !== false) {
      list.push({ key: 'transfer', icon: 'credit_card', label: 'Bank Transfer', sub: `${ms.bankName || 'Access Bank'}: ${ms.bankAccountNumber || '1234567890'} (${ms.bankAccountName || store.storeName})` });
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

  // Search bar typing placeholder animation state
  const [searchPlaceholder, setSearchPlaceholder] = useState('Search for products...');
  useEffect(() => {
    const phrases = [
      'Search for products...',
      'Search for stores...',
      'Search for brands...',
      'Search groceries near you...'
    ];
    let phraseIdx = 0;
    let charIdx = phrases[phraseIdx].length;
    let isDeleting = true;
    let timer: any = null;

    const tick = () => {
      const currentPhrase = phrases[phraseIdx];
      if (isDeleting) {
        setSearchPlaceholder(currentPhrase.substring(0, charIdx - 1));
        charIdx--;
      } else {
        setSearchPlaceholder(currentPhrase.substring(0, charIdx + 1));
        charIdx++;
      }

      let speed = isDeleting ? 40 : 100;

      if (!isDeleting && charIdx === currentPhrase.length) {
        speed = 2000; // Pause at end of phrase
        isDeleting = true;
      } else if (isDeleting && charIdx === 0) {
        isDeleting = false;
        phraseIdx = (phraseIdx + 1) % phrases.length;
        speed = 300; // Pause before typing next phrase
      }

      timer = setTimeout(tick, speed);
    };

    timer = setTimeout(tick, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Cart & Modal
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Onboarding first launch detection
  const [_isOnboarded, setIsOnboarded] = useState(() => localStorage.getItem('storeflow_onboarded') === 'true');

  // Authentication State
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authOTP, setAuthOTP] = useState('');
  const [showOTPField, setShowOTPField] = useState(false);

  // Location selector State
  const [selectedAddress, setSelectedAddress] = useState(() => localStorage.getItem('storeflow_address') || 'Select Location');
  const [savedAddresses, setSavedAddresses] = useState<string[]>(() => {
    const cached = localStorage.getItem('storeflow_saved_addresses');
    return cached ? JSON.parse(cached) : ['Warri, Delta State', '23 Allen Avenue, Ikeja', '5 GRA, Ikeja', 'Lagos, Nigeria'];
  });
  const [newAddressInput, setNewAddressInput] = useState('');
  const [editingAddress, setEditingAddress] = useState<string | null>(null);

  // Checkout & Order State
  const [checkoutStep, setCheckoutStep] = useState<'shopping' | 'checkout' | 'payment'>('shopping');
  const [customerName, setCustomerName] = useState(() => localStorage.getItem('storeflow_saved_checkout_name') || '');
  const [customerPhone, setCustomerPhone] = useState(() => localStorage.getItem('storeflow_saved_checkout_phone') || '');
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'delivery'>(() => (localStorage.getItem('storeflow_pref_delivery_type') as any) || 'pickup');
  const [deliveryAddress, setDeliveryAddress] = useState(() => localStorage.getItem('storeflow_pref_address') || '');
  const [customerEmail, setCustomerEmail] = useState('');
  const [deliveryLandmark, setDeliveryLandmark] = useState(() => localStorage.getItem('storeflow_saved_checkout_landmark') || '');
  const [specialInstructions, setSpecialInstructions] = useState(() => localStorage.getItem('storeflow_saved_checkout_notes') || '');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'opay'>(() => (localStorage.getItem('storeflow_pref_payment_method') as any) || 'cash');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState('');
  const [orderStatus, setOrderStatus] = useState('Pending');
  const [orderCopied, setOrderCopied] = useState(false);
  const [ordersHistory, setOrdersHistory] = useState<Order[]>([]);

  const [rejectionReason, setRejectionReason] = useState('');
  const [changeRequestMessage, setChangeRequestMessage] = useState('');
  if (false) console.log({ rejectionReason, setRejectionReason, changeRequestMessage, setChangeRequestMessage });

  const normalizeNigerianPhone = useCallback((num: string): string => {
    const cleaned = num.replace(/\D/g, '');
    if (cleaned.startsWith('234') && cleaned.length === 13) {
      return '+' + cleaned;
    } else if (cleaned.startsWith('0') && cleaned.length === 11) {
      return '+234' + cleaned.substring(1);
    } else if (cleaned.length === 10) {
      return '+234' + cleaned;
    } else if ((cleaned.startsWith('8') || cleaned.startsWith('7') || cleaned.startsWith('9')) && cleaned.length === 10) {
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [autoTorchTriggered, setAutoTorchTriggered] = useState(false);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualInputVal, setManualInputVal] = useState('');
  const [focusRing, setFocusRing] = useState<{ x: number; y: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const scanStartTimeRef = useRef<number>(0);
  const isProcessingFrameRef = useRef<boolean>(false);

  // Quick Order Modal
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [quickOrderInput, setQuickOrderInput] = useState('');

  // User Profile
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  if (false) console.log({ profilePhone, setProfilePhone });
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('storeflow_dark_mode') === 'true');

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
    const cachedStores = localStorage.getItem('storeflow_cached_all_stores');
    const cachedProducts = localStorage.getItem('storeflow_cached_products');
    const cachedCategories = localStorage.getItem('storeflow_cached_categories');
    const cachedHistory = localStorage.getItem('storeflow_cached_orders_history');
    
    if (cachedStores) setAllStores(JSON.parse(cachedStores));
    if (cachedProducts) setProducts(JSON.parse(cachedProducts));
    if (cachedCategories) setCategories(JSON.parse(cachedCategories));
    if (cachedHistory) setOrdersHistory(JSON.parse(cachedHistory));

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
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync Offline Queue
  const syncOfflineOrders = async () => {
    const pending = localStorage.getItem('storeflow_pending_sync_orders');
    if (!pending) return;

    try {
      const ordersToSync: any[] = JSON.parse(pending);
      for (const orderData of ordersToSync) {
        await supabase.from('orders').insert(orderData.order);
        if (orderData.items && orderData.items.length > 0) {
          await supabase.from('order_items').insert(orderData.items);
        }
      }
      localStorage.removeItem('storeflow_pending_sync_orders');
      alert('Your offline order(s) have been successfully synchronized! 🎉');
      loadOrdersHistory();
    } catch (e) {
      console.error('Failed to sync offline orders:', e);
    }
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

  // Keep the full stores list fresh in the background (Home "Your Stores" / Explore)
  // without interrupting whatever the user is doing.
  useEffect(() => {
    const storesChannel = supabase
      .channel('stores-list-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, () => {
        loadStoresData();
      })
      .subscribe();

    // Safety-net poll in case realtime is unavailable on the network
    const pollId = setInterval(() => {
      if (navigator.onLine) loadStoresData();
    }, 60000);

    return () => {
      supabase.removeChannel(storesChannel);
      clearInterval(pollId);
    };
  }, []);

  // Keep the customer's own order history fresh in the background so the
  // "Orders" nav badge and statuses (accepted/rejected/preparing) update on
  // their own, without the customer needing to open the Orders tab.
  useEffect(() => {
    const lookupPhone = currentUser?.phone || customerPhone || localStorage.getItem('storeflow_saved_checkout_phone');
    if (!lookupPhone) return;

    loadOrdersHistory();

    const ordersChannel = supabase
      .channel('customer-orders-updates-' + lookupPhone)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `customer_phone=eq.${lookupPhone}` }, (payload: any) => {
        loadOrdersHistory();
        // Notify the customer when their order's status actually changes
        if (payload.eventType === 'UPDATE' && payload.old?.status !== payload.new?.status) {
          const statusLabel: Record<string, string> = {
            Accepted: 'was accepted! 🎉',
            Preparing: 'is being prepared 👨‍🍳',
            Ready: 'is ready for pickup/delivery 📦',
            Completed: 'has been completed ✅',
            Rejected: 'was declined by the store 😔',
            Cancelled: 'was cancelled',
          };
          const label = statusLabel[payload.new?.status];
          if (label) {
            const orderNum = payload.new?.order_number || '';
            const message = `Order ${orderNum ? '#' + orderNum : ''} ${label}`.trim();
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try { new Notification('StoreFlow', { body: message, icon: '/icons/icon-192.png' }); } catch {}
            }
          }
        }
      })
      .subscribe();

    const pollId = setInterval(() => {
      if (navigator.onLine) loadOrdersHistory();
    }, 30000);

    return () => {
      supabase.removeChannel(ordersChannel);
      clearInterval(pollId);
    };
  }, [currentUser?.phone, customerPhone]);

  // Orders still in progress — drives the badge on the bottom-nav "Orders" tab
  const activeOrdersCount = useMemo(
    () => ordersHistory.filter((o: any) => ['Pending', 'Accepted', 'Preparing', 'Ready'].includes(o.status)).length,
    [ordersHistory]
  );

  // Active orders first (Pending/Accepted/Preparing/Ready), finished orders
  // (Completed/Cancelled/Rejected) pushed below — so an order from last week
  // that's already done doesn't bury today's order that's still in progress.
  // Each group keeps its own most-recent-first order from the query.
  const ACTIVE_STATUSES = ['Pending', 'Accepted', 'Preparing', 'Ready'];
  const sortedOrdersHistory = useMemo(() => {
    const active = ordersHistory.filter((o: any) => ACTIVE_STATUSES.includes(o.status));
    const finished = ordersHistory.filter((o: any) => !ACTIVE_STATUSES.includes(o.status));
    return [...active, ...finished];
  }, [ordersHistory]);

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
      setProfilePhone(session.user.phone || '');
      setCustomerName(session.user.user_metadata?.full_name || '');
      setCustomerPhone(session.user.phone || '');
      syncItsMeProfileWithCloud(session.user);
    }
    loadStoresData();
  };

  // ─── Fetch Stores & Dynamic Products ────────────────────────────────────────

  const loadStoresData = async () => {
    try {
      const { data, error } = await supabase.from('stores').select('*');
      if (error) throw error;
      if (data) {
        setAllStores(data);
        localStorage.setItem('storeflow_cached_all_stores', JSON.stringify(data));
      }
    } catch (e) {
      console.warn('Supabase loading error, running offline fallback:', e);
    }
  };

  const loadStoreDetails = async (sid: string) => {
    // Reset user rating state for new store
    setUserRating(null);
    // 1. Log the exact Store ID extracted from the URL.
    console.log(`[StoreFlow QR] Exact Store ID extracted from URL: "${sid}"`);

    // INSTANT LOAD: if we've already visited this store before, show the
    // cached version immediately (no spinner) while we quietly refresh in
    // the background. This is what makes "already scanned" stores open
    // instantly instead of waiting on the network every time.
    const cleanSidForCache = sid.replace(/^SF-/i, '').trim();
    const cachedMatch = allStores.find((s: any) =>
      s.id === sid ||
      s.store_id === sid ||
      s.access_code === sid ||
      s.store_id === cleanSidForCache ||
      s.access_code === cleanSidForCache ||
      (s.qr_code && typeof s.qr_code === 'string' && s.qr_code.includes(sid))
    );
    const hasInstantData = !!cachedMatch;
    if (cachedMatch) {
      setStore(cachedMatch);
      setLoading(false); // don't block the UI — page renders immediately
      const cachedProducts = localStorage.getItem('storeflow_cached_products_' + cachedMatch.id);
      if (cachedProducts) {
        try { setProducts(JSON.parse(cachedProducts)); } catch {}
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

      let storeData = null;
      let storeErr = null;
      let queryUsed = '';

      const cleanSid = sid.trim();

      // 5. If the URL contains SF-TTEC9S (or starts with SF-), the query must search the stores.store_id column first
      if (cleanSid.toUpperCase().startsWith('SF-')) {
        queryUsed = `supabase.from('stores').select('*').ilike('store_id', '${cleanSid}')`;
        console.log(`[StoreFlow QR] Prioritizing query on stores.store_id column first: ${queryUsed}`);
        const res = await supabase.from('stores').select('*').ilike('store_id', cleanSid).maybeSingle();
        storeData = res.data;
        storeErr = res.error;
      }

      // If not found or not prioritized, use fallback/full query searching store_id, id, access_code, and qr_code
      if (!storeData && !storeErr) {
        let orFilter = '';
        if (isUuid) {
          orFilter = `id.eq.${cleanSid},store_id.ilike.${cleanSid},store_id.ilike.SF-${cleanSid},access_code.ilike.${cleanSid},qr_code.ilike.%/store/${cleanSid},qr_code.ilike.%/s/${cleanSid}`;
        } else {
          orFilter = `store_id.ilike.${cleanSid},store_id.ilike.SF-${cleanSid},access_code.ilike.${cleanSid},qr_code.ilike.%/store/${cleanSid},qr_code.ilike.%/s/${cleanSid}`;
        }
        queryUsed = `supabase.from('stores').select('*').or('${orFilter}')`;
        console.log(`[StoreFlow QR] Running fallback OR query: ${queryUsed}`);
        const res = await supabase.from('stores').select('*').or(orFilter).maybeSingle();
        storeData = res.data;
        storeErr = res.error;
      }

      // 4. Return and log the full Supabase response and any errors.
      console.log(`[StoreFlow QR] Full Supabase response - Data:`, storeData);
      console.log(`[StoreFlow QR] Full Supabase response - Error:`, storeErr);

      if (storeErr) {
        console.error(`[StoreFlow QR] Database query error for store ID: "${sid}":`, storeErr);
        throw storeErr;
      }

      if (storeData) {
        setStore(storeData);
        // Clear cart items that belong to other stores
        setCart(prev => prev.filter(item => item.product.store_id === storeData.id));
        // Sync browser URL to represent the active store (so refreshes work)
        const storeSlug = storeData.store_id || storeData.access_code || storeData.id;
        const targetPath = `/s/${storeSlug}`;
        if (window.location.pathname !== targetPath) {
          window.history.pushState(null, '', targetPath);
        }

        try {
          const scanned = JSON.parse(localStorage.getItem('storeflow_scanned_stores') || '[]');
          if (!scanned.includes(storeData.id)) {
            scanned.push(storeData.id);
            localStorage.setItem('storeflow_scanned_stores', JSON.stringify(scanned));
          }
        } catch (e) {
          console.error('[StoreFlow QR] Error saving scanned store history:', e);
        }
        // Store metadata loaded, turn off top-level spinner so header/info cards can render
        setLoading(false);

        const resolvedStoreUuid = storeData.id;
        console.log(`[StoreFlow QR] Store data loaded:`, storeData);

        // Extract products from storeData.data.products (JSONB) or query public.products table
        let prods: any[] = [];
        if (storeData.data && Array.isArray((storeData.data as any).products)) {
          console.log(`[StoreFlow QR] Extracting products from store JSONB payload...`);
          prods = (storeData.data as any).products.map((p: any) => {
            const whPrice = p.sellingPrice ?? p.selling_price ?? 0;
            const isCartonSingle = p.isCartonSingleEnabled === true;
            const rtPrice = isCartonSingle ? (p.singleSellingPrice ?? (p.singlesPerCarton ? Math.round(whPrice / p.singlesPerCarton) : whPrice)) : whPrice;
            return {
              id: p.id || p.productId || Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
              store_id: resolvedStoreUuid,
              barcode: p.barcode || '',
              name: p.name || p.productName || 'Product',
              description: p.description || '',
              selling_price: whPrice,
              wholesale_price: whPrice,
              retail_price: rtPrice,
              quantity: p.quantity ?? 0,
              category: p.category || 'General',
              image: p.image || '',
              status: p.discontinued ? 'inactive' : 'active'
            };
          }).filter((p: any) => p.status === 'active');
          console.log(`[StoreFlow QR] Extracted ${prods.length} products from JSONB.`);
        }

        // If no products found in JSONB, attempt query on products table
        if (prods.length === 0) {
          console.log(`[StoreFlow QR] Querying public.products table for store UUID: "${resolvedStoreUuid}"...`);
          const { data: prodData, error: prodErr } = await supabase
            .from('products')
            .select('*')
            .eq('store_id', resolvedStoreUuid)
            .eq('status', 'active');

          if (prodErr) {
            console.error(`[StoreFlow QR] Error querying products for store UUID: "${resolvedStoreUuid}":`, prodErr);
            throw prodErr;
          }
          prods = (prodData || []).map((p: any) => ({
            ...p,
            wholesale_price: p.wholesale_price ?? p.selling_price ?? 0,
            retail_price: p.retail_price ?? p.selling_price ?? 0
          }));
          console.log(`[StoreFlow QR] Query response from products table:`, prods);
        }

        console.log(`[StoreFlow QR] Final products loaded successfully. Count: ${prods.length}`);
        setProducts(prods);
        localStorage.setItem('storeflow_cached_products', JSON.stringify(prods));
        localStorage.setItem('storeflow_cached_products_' + resolvedStoreUuid, JSON.stringify(prods));

        // Dynamically compute categories list
        let cats = ['All'];
        const uniq = Array.from(new Set(prods.map(p => p.category).filter((c): c is string => !!c)));
        cats = ['All', ...uniq];
        setCategories(cats);
        localStorage.setItem('storeflow_cached_categories', JSON.stringify(cats));
      } else {
        console.warn(`[StoreFlow QR] Store ID: "${sid}" not found in database.`);
        navigateToScreen('store_not_found');

        // 7. If no row is returned, print exactly why (wrong column, RLS, missing row, or filter mismatch)
        console.log(`[StoreFlow QR] Diagnostics - Why was no row returned?`);
        try {
          // A. Test connection & check if RLS or permissions blocked the request
          const { count, error: countErr } = await supabase
            .from('stores')
            .select('*', { count: 'exact', head: true });

          if (countErr) {
            console.log(` - Reason: RLS (Row Level Security) or Database Permission error. Cannot count stores. Error detail:`, countErr);
          } else {
            console.log(` - Table accessibility: Verified. We have access to the stores table. Total rows count: ${count}`);
            if (count === 0) {
              console.log(` - Reason: Missing row. The stores table in the database is completely empty.`);
            } else {
              // B. Check if it's a filter mismatch or a truly missing row by searching loosely
              const cleanSid = sid.replace(/^SF-/i, '');
              const { data: looseData, error: looseErr } = await supabase
                .from('stores')
                .select('id, store_id, access_code, qr_code')
                .or(`store_id.ilike.%${cleanSid}%,access_code.ilike.%${cleanSid}%,qr_code.ilike.%${cleanSid}%`);
              
              if (looseErr) {
                console.log(` - Loose search error:`, looseErr);
              }

              if (looseData && looseData.length > 0) {
                console.log(` - Reason: Filter mismatch. A similar row was found but did not match strict filters:`, looseData);
              } else {
                console.log(` - Reason: Missing row. No row exists in the database stores table matching the ID "${sid}" (searched store_id, access_code, qr_code).`);
              }
            }
          }
        } catch (diagErr) {
          console.error(`[StoreFlow QR] Diagnostic routine failed:`, diagErr);
        }
      }
    } catch (err: any) {
      console.error(`[StoreFlow QR] Critical error loading store detail for ID: "${sid}":`, err);
      setErrorText('Offline Mode: Displaying offline catalog.');
      // Attempt local storage fallback if we have a match
      const matched = allStores.find(s => s.id === sid);
      if (matched) {
        setStore(matched);
        setProducts([]);
        setLoading(false);
      } else {
        navigateToScreen('store_not_found');
      }
    } finally {
      setLoading(false);
      setProductsLoading(false);
      setRefreshing(false);
    }
  };

  const loadOrdersHistory = async () => {
    const lookupPhone = currentUser?.phone || customerPhone || localStorage.getItem('storeflow_saved_checkout_phone');
    if (!lookupPhone) return;
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('customer_phone', lookupPhone)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (data) {
        setOrdersHistory(data);
        localStorage.setItem('storeflow_cached_orders_history', JSON.stringify(data));
      }
    } catch (e) {
      console.warn('Orders history loading failed:', e);
    }
  };

  // ─── Real-time order status tracking ────────────────────────────────────────

  // Load order status initially when transitioning to tracking screen
  useEffect(() => {
    if (!orderId || screen !== 'tracking') return;

    supabase
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data?.status) {
          setOrderStatus(data.status);
        }
      });
  }, [orderId, screen]);

  useEffect(() => {
    if (!orderId || screen !== 'tracking') return;

    const channel = supabase
      .channel('order-updates')
      .on('postgres_changes', {
        event: 'UPDATE', filter: `id=eq.${orderId}`, schema: 'public', table: 'orders'
      }, (payload: any) => {
        if (payload.new?.status) setOrderStatus(payload.new.status);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, screen]);

  // Real-time store updates tracking
  useEffect(() => {
    if (!store?.id) return;

    const channel = supabase
      .channel(`store-updates-${store.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        filter: `id=eq.${store.id}`,
        schema: 'public',
        table: 'stores'
      }, (payload: any) => {
        console.log('[StoreFlow Realtime] Store updated payload received:', payload);
        if (payload.new) {
          setStore(payload.new);
          
          if (payload.new.data && Array.isArray(payload.new.data.products)) {
            const prods = payload.new.data.products.map((p: any) => {
              const whPrice = p.sellingPrice ?? p.selling_price ?? 0;
              const isCartonSingle = p.isCartonSingleEnabled === true;
              const rtPrice = isCartonSingle ? (p.singleSellingPrice ?? (p.singlesPerCarton ? Math.round(whPrice / p.singlesPerCarton) : whPrice)) : whPrice;
              return {
                id: p.id || p.productId || Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                store_id: payload.new.id,
                barcode: p.barcode || '',
                name: p.name || p.productName || 'Product',
                description: p.description || '',
                selling_price: whPrice,
                wholesale_price: whPrice,
                retail_price: rtPrice,
                quantity: p.quantity ?? 0,
                category: p.category || 'General',
                image: p.image || '',
                status: p.discontinued ? 'inactive' : 'active'
              };
            }).filter((p: any) => p.status === 'active');
            setProducts(prods);
            
            let cats = ['All'];
            const uniq = Array.from(new Set(prods.map((p: any) => p.category).filter((c: any) => !!c))) as string[];
            cats = ['All', ...uniq];
            setCategories(cats);
          }
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
      // If this history entry carries screen state (pushed by navigateToScreen),
      // restore it instantly — no network call, no reload. This is what makes
      // swipe-back feel instant instead of reloading the page.
      const stateScreen = event?.state?.screen;
      if (stateScreen) {
        setScreen(stateScreen);
        return;
      }
      // Otherwise this is a genuine store deep link (e.g. QR scan URL, or a
      // history entry from before this fix shipped) — resolve it the normal way.
      const { storeId: sid, productId: pid } = parseRoute();
      if (sid) {
        setStoreId(sid);
        loadStoreDetails(sid);
        setScreen('store');
        if (pid) {
          setDeepLinkedProductId(pid);
        }
      } else {
        setScreen('home');
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

    setScanSuccess(true);
    
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
          let storeData = null;
          let storeErr = null;

          if (parsedStoreId.toUpperCase().startsWith('SF-')) {
            console.log(`[StoreFlow QR] Scan/Manual: Prioritizing query on stores.store_id first for Store ID: "${parsedStoreId}"`);
            const res = await supabase
              .from('stores')
              .select('id')
              .eq('store_id', parsedStoreId)
              .maybeSingle();
            storeData = res.data;
            storeErr = res.error;
          }

          if (!storeData && !storeErr) {
            const res = await supabase
              .from('stores')
              .select('id')
              .or(`id.eq.${parsedStoreId},store_id.eq.${parsedStoreId},store_id.eq.SF-${parsedStoreId.toUpperCase()},access_code.eq.${parsedStoreId}`)
              .maybeSingle();
            storeData = res.data;
            storeErr = res.error;
          }

          if (storeData) {
            setStoreId(storeData.id);
            await loadStoreDetails(storeData.id);
            navigateToScreen('store');
            if (parsedProductId) {
              const { data: prodData } = await supabase
                .from('products')
                .select('*')
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
          .select('*, stores(*)')
          .eq('barcode', codeValue)
          .limit(1)
          .maybeSingle();

        if (prodDb) {
          const storeObj = prodDb.stores;
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
      setScanError(`Code "${codeValue}" not recognized in StoreFlow.`);
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
    setScanSuccess(false);
    setTorchOn(false);
    setScanHint(null);
  }, []);

  const startScanner = useCallback(async () => {
    setScanError(null);
    setScanSuccess(false);
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
    lastFrameDataRef.current = null;

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

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || scanSuccess) {
        scanFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        scanFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      // Draw original frame to read raw pixels for hints
      ctx.drawImage(video, 0, 0);
      const rawImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = rawImageData.data;

      // Frame analysis
      const len = data.length / 4;
      let totalLuminance = 0;
      for (let i = 0; i < len; i += 10) {
        totalLuminance += (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
      }
      const avgLuminance = totalLuminance / (len / 10);

      let hint: string | null = null;
      if (avgLuminance < 45) {
        hint = 'More light needed';
        if (!autoTorchTriggered) {
          setAutoTorchTriggered(true);
          setTorchOn(true);
          applyTorchConstraint(true);
        }
      }

      if (lastFrameDataRef.current && lastFrameDataRef.current.length === data.length) {
        let diffCount = 0;
        const totalSampled = len / 20;
        for (let i = 0; i < len; i += 20) {
          const idx = i * 4;
          const deltaR = Math.abs(data[idx] - lastFrameDataRef.current[idx]);
          const deltaG = Math.abs(data[idx + 1] - lastFrameDataRef.current[idx + 1]);
          const deltaB = Math.abs(data[idx + 2] - lastFrameDataRef.current[idx + 2]);
          if (deltaR + deltaG + deltaB > 90) {
            diffCount++;
          }
        }
        const motionPct = diffCount / totalSampled;
        if (motionPct > 0.15) {
          hint = 'Hold steady';
        }
      }
      lastFrameDataRef.current = new Uint8ClampedArray(data);

      if (!hint && Date.now() - scanStartTimeRef.current > 3000) {
        hint = 'Move closer';
      }
      setScanHint(hint);

      // Enhance brightness/contrast in-place on canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.filter = 'contrast(1.5) brightness(1.2) grayscale(1.0)';
      ctx.drawImage(video, 0, 0);
      ctx.restore();

      const enhancedImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (workerRef.current && !isProcessingFrameRef.current) {
        isProcessingFrameRef.current = true;
        const buf = enhancedImageData.data.buffer.slice(0);
        workerRef.current.postMessage({
          dataArray: buf,
          width: enhancedImageData.width,
          height: enhancedImageData.height
        }, [buf]);
      }

      scanFrameRef.current = requestAnimationFrame(tick);
    };

    scanFrameRef.current = requestAnimationFrame(tick);
  }, [scanSuccess, autoTorchTriggered]);

  // ─── Authentication Flow ───────────────────────────────────────────────────

  const handleEmailAuth = async () => {
    setLoading(true);
    setErrorText(null);
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
          options: {
            data: { full_name: profileName || 'Customer' }
          }
        });
        if (error) throw error;
        alert('Account created! Please log in.');
        setAuthMode('login');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword
        });
        if (error) throw error;
        if (data.user) {
          setCurrentUser(data.user);
          setProfileName(data.user.user_metadata?.full_name || '');
          setProfileEmail(data.user.email || '');
          setCustomerName(data.user.user_metadata?.full_name || '');
          navigateToScreen('home');
          syncItsMeProfileWithCloud(data.user);
        }
      }
    } catch (e: any) {
      setErrorText(e.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneOTPAuth = async () => {
    setLoading(true);
    setErrorText(null);
    try {
      if (!showOTPField) {
        const { error } = await supabase.auth.signInWithOtp({
          phone: authPhone
        });
        if (error) throw error;
        setShowOTPField(true);
        alert('OTP sent to phone!');
      } else {
        const { data, error } = await supabase.auth.verifyOtp({
          phone: authPhone,
          token: authOTP,
          type: 'sms'
        });
        if (error) throw error;
        if (data.user) {
          setCurrentUser(data.user);
          setProfilePhone(data.user.phone || '');
          setCustomerPhone(data.user.phone || '');
          navigateToScreen('home');
          syncItsMeProfileWithCloud(data.user);
        }
      }
    } catch (e: any) {
      setErrorText(e.message || 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
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

  const addNewAddress = () => {
    if (!newAddressInput.trim()) return;
    let list;
    if (editingAddress) {
      list = savedAddresses.map(addr => addr === editingAddress ? newAddressInput : addr);
      setEditingAddress(null);
    } else {
      list = [newAddressInput, ...savedAddresses];
    }
    setSavedAddresses(list);
    localStorage.setItem('storeflow_saved_addresses', JSON.stringify(list));
    selectAddressAndSave(newAddressInput);
    setNewAddressInput('');
  };

  const requestGPSLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const mockAddr = `GRA Phase II (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
          selectAddressAndSave(mockAddr);
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
    setCart(prev => {
      const idx = prev.findIndex(i => i.product.id === product.id);
      if (idx !== -1) {
        const next = [...prev];
        const nq = next[idx].quantity + qty;
        if (nq <= 0) next.splice(idx, 1); else next[idx].quantity = nq;
        return next;
      }
      return qty > 0 ? [...prev, { product, quantity: qty }] : prev;
    });
  };

  const getQty = (productId: string) => cart.find(i => i.product.id === productId)?.quantity ?? 0;

  const subtotal = useMemo(() => cart.reduce((s, i) => s + getPrice(i.product) * i.quantity, 0), [cart, getPrice]);
  const deliveryFee = useMemo(() => (deliveryType === 'pickup' || subtotal === 0) ? 0 : subtotal >= 5000 ? 0 : 500, [deliveryType, subtotal]);
  const total = subtotal + deliveryFee;
  const totalItemsCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);

  // ─── Place Order / Checkout Sync ───────────────────────────────────────────

  const submitOrder = async () => {
    if (!customerName || !customerPhone) {
      alert('Please enter your details first.');
      return;
    }
    setLoading(true);
    try {
      const genOrderNo = `SF-${Math.floor(100000 + Math.random() * 900000)}`;
      const notes = JSON.stringify({
        delivery_type: deliveryType,
        address: deliveryType === 'delivery' ? deliveryAddress : '',
        payment_method: paymentMethod,
        instructions: specialInstructions,
        pricing_mode: priceMode
      });

      const orderPayload = {
        store_id: store?.id || '',
        customer_name: customerName,
        customer_phone: customerPhone,
        order_number: genOrderNo,
        status: 'Pending',
        subtotal,
        total,
        notes
      };

      if (isOnline) {
        const itemsPayload = cart.map(item => ({
          product_id: item.product.id,
          quantity: item.quantity,
          price: getPrice(item.product),
          subtotal: getPrice(item.product) * item.quantity
        }));

        // Step 8: Atomic Transaction Order Placement
        const { data: orderUuid, error: orderErr } = await supabase
          .rpc('place_order_atomic', {
            p_store_id: store?.id || '',
            p_customer_name: customerName,
            p_customer_phone: customerPhone,
            p_order_number: genOrderNo,
            p_status: 'Pending',
            p_subtotal: subtotal,
            p_total: total,
            p_notes: notes,
            p_items: itemsPayload
          });

        if (orderErr) throw orderErr;
        if (!orderUuid) throw new Error("Database failed to return Order ID.");

        setOrderId(orderUuid);

        // Offer real-time order status alerts right when they'd matter most
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {});
        }

        // Step 3: Create Notification
        const notificationPayload = {
          store_id: store?.id || '',
          title: 'New Order',
          message: `${customerName} placed Order #${genOrderNo} containing ${totalItemsCount} items.`,
          type: 'new_order',
          is_read: false
        };

        const { error: notificationErr } = await supabase
          .from('notifications')
          .insert(notificationPayload);

        if (notificationErr) {
          console.warn("Failed to create order notification in db:", notificationErr);
        }
      } else {
        // Offline Order Caching Queue
        const offlineQueue = JSON.parse(localStorage.getItem('storeflow_pending_sync_orders') || '[]');
        offlineQueue.push({
          order: orderPayload,
          items: cart.map(item => ({
            product_id: item.product.id,
            quantity: item.quantity,
            price: getPrice(item.product),
            subtotal: getPrice(item.product) * item.quantity
          }))
        });
        localStorage.setItem('storeflow_pending_sync_orders', JSON.stringify(offlineQueue));
        setOrderId('offline-' + Date.now());
      }

      setOrderNumber(genOrderNo);
      setOrderStatus('Pending');
      setCheckoutStep('shopping');
      setIsCartOpen(false);
      setCart([]);
      navigateToScreen('tracking');
      loadOrdersHistory();

      // Auto-save to localStorage for "It's Me" Prefill button
      localStorage.setItem('storeflow_saved_checkout_name', customerName);
      localStorage.setItem('storeflow_saved_checkout_phone', customerPhone);
      if (deliveryAddress) localStorage.setItem('storeflow_pref_address', deliveryAddress);
      if (deliveryLandmark) localStorage.setItem('storeflow_saved_checkout_landmark', deliveryLandmark);
      if (specialInstructions) localStorage.setItem('storeflow_saved_checkout_notes', specialInstructions);
      localStorage.setItem('storeflow_pref_payment_method', paymentMethod);
      localStorage.setItem('storeflow_pref_delivery_type', deliveryType);

      // Check if fields differ from saved It'sMe profile → ask to update
      const current = loadItsMeProfile();
      const changes: Partial<ItsMe> = {};
      if (customerName && customerName !== current.displayName) changes.displayName = customerName;
      if (customerPhone && customerPhone !== current.phone) changes.phone = customerPhone;
      if (customerEmail && customerEmail !== current.email) changes.email = customerEmail;
      if (deliveryAddress && !current.addresses.includes(deliveryAddress)) changes.addresses = [...current.addresses, deliveryAddress];
      if (deliveryLandmark && !current.landmarks.includes(deliveryLandmark)) changes.landmarks = [...current.landmarks, deliveryLandmark];
      if (specialInstructions && specialInstructions !== current.deliveryInstructions) changes.deliveryInstructions = specialInstructions;
      if (paymentMethod !== current.preferredPayment) changes.preferredPayment = paymentMethod;

      if (Object.keys(changes).length > 0) {
        setPendingItsMeUpdate(changes);
        setTimeout(() => setShowItsMeUpdatePrompt(true), 800);
      }

    } catch (e: any) {
      alert('Order placement failed: ' + e.message);
    } finally {
      setLoading(false);
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

  const updateItsMeProfileAndSync = async (newProfile: ItsMe) => {
    const updated = saveItsMeProfile(newProfile);
    setItsMeProfile(updated);
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

  const handleCancelOrder = async () => {
    if (!orderId) return;
    try {
      setLoading(true);
      const { data, error: fetchErr } = await supabase
        .from('orders')
        .select('notes')
        .eq('id', orderId)
        .single();
      if (fetchErr) throw fetchErr;

      let parsedNotes: any = {};
      if (data?.notes) {
        try {
          parsedNotes = JSON.parse(data.notes);
        } catch {
          parsedNotes = { instructions: data.notes };
        }
      }

      parsedNotes.customer_cancelled = true;

      const { error: updateErr } = await supabase
        .from('orders')
        .update({
          status: 'Cancelled',
          notes: JSON.stringify(parsedNotes),
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);
      if (updateErr) throw updateErr;

      setOrderStatus('Cancelled');
      loadOrdersHistory();
      alert('Order cancelled successfully.');
    } catch (e: any) {
      alert('Failed to cancel order: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveChanges = async () => {
    if (!orderId) return;
    try {
      setLoading(true);
      const { data, error: fetchErr } = await supabase
        .from('orders')
        .select('notes')
        .eq('id', orderId)
        .single();
      if (fetchErr) throw fetchErr;

      let parsedNotes: any = {};
      if (data?.notes) {
        try {
          parsedNotes = JSON.parse(data.notes);
        } catch {
          parsedNotes = { instructions: data.notes };
        }
      }

      parsedNotes.customer_approved_changes = true;

      const { error: updateErr } = await supabase
        .from('orders')
        .update({ notes: JSON.stringify(parsedNotes), updated_at: new Date().toISOString() })
        .eq('id', orderId);
      if (updateErr) throw updateErr;

      setChangeRequestMessage(parsedNotes.change_request_message || '');
      loadOrdersHistory();
      alert('Proposal approved! The merchant has been notified.');
    } catch (e: any) {
      alert('Failed to approve proposal: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReorder = async (order: Order) => {
    try {
      setLoading(true);
      
      let targetProducts = products;
      if (store?.id !== order.store_id) {
        const { data: storeData, error: storeErr } = await supabase
          .from('stores')
          .select('*')
          .eq('id', order.store_id)
          .single();
        if (storeErr) throw storeErr;
        
        const { data: prodData, error: prodErr } = await supabase
          .from('products')
          .select('*')
          .eq('store_id', order.store_id);
        if (prodErr) throw prodErr;
        
        setStore(storeData);
        setStoreId(order.store_id);
        setProducts(prodData || []);
        targetProducts = prodData || [];
      }
      
      let itemsSummary = [];
      if (order.notes) {
        try {
          const parsed = JSON.parse(order.notes);
          itemsSummary = parsed.items_summary || [];
        } catch (e) {
          // ignore
        }
      }
      
      if (itemsSummary.length === 0 && order.order_items) {
        itemsSummary = order.order_items.map((oi: any) => ({
          name: oi.product?.name || 'Product',
          quantity: oi.quantity,
          price: oi.price
        }));
      }

      const newCart: CartItem[] = [];
      for (const item of itemsSummary) {
        const match = targetProducts.find(p => p.name.toLowerCase() === item.name.toLowerCase());
        if (match) {
          newCart.push({
            product: match,
            quantity: item.quantity
          });
        }
      }

      if (newCart.length > 0) {
        setCart(newCart);
        setIsCartOpen(true);
        navigateToScreen('store');
      } else {
        alert('Could not find the products from this order in the store catalog.');
      }
    } catch (e: any) {
      alert('Failed to reorder: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  function renderScanner() {
    return (
      <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center">
        {/* Manual Input Fallback Dialog */}
        {showManualInput && (
          <div className="absolute inset-0 z-[60] bg-black/90 flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-left space-y-4 shadow-2xl">
              <h3 className="font-extrabold text-[#1A1C1E] text-base">Enter Store ID or Barcode</h3>
              <p className="text-xs text-gray-400 font-semibold leading-relaxed">
                Type the Store ID/slug name or a product barcode to open it manually.
              </p>
              <input
                type="text"
                value={manualInputVal}
                onChange={e => setManualInputVal(e.target.value)}
                className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:border-gray-400 text-xs font-bold text-[#1A1C1E]"
                placeholder="e.g. freshmart or 5012345678"
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
                  Submit
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
            <span>Enter Barcode or ID Manually</span>
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

  const filteredProducts = useMemo(() => {
    let result = products.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.brand?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
        (p.category?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      const matchStock = !showInStockOnly || p.quantity > 0;
      return matchSearch && matchCat && matchStock;
    });

    if (sortBy === 'price_asc') {
      result = [...result].sort((a, b) => getPrice(a) - getPrice(b));
    } else if (sortBy === 'price_desc') {
      result = [...result].sort((a, b) => getPrice(b) - getPrice(a));
    } else if (sortBy === 'name_asc') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    }

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

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart > 0 && window.scrollY === 0 && !refreshing) {
      const currentY = e.touches[0].clientY;
      const dist = Math.max(0, currentY - touchStart);
      if (dist < 100) {
        setPullDistance(dist);
      }
    }
  };

  const handleTouchEnd = () => {
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

  // ─── Storefront Redesign Sub-Renderers ─────────────────────────────────────

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

      <div className="mt-6 px-4 max-w-lg md:max-w-2xl mx-auto space-y-6">
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
          <img 
            className="w-full h-full object-cover opacity-50 mix-blend-luminosity animate-fade-in" 
            src="https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1200&q=80" 
            alt="" 
          />
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
        <div className="relative bg-white rounded-t-[28px] -mt-8 pt-20 pb-4 px-4 md:px-6 text-center flex flex-col items-center max-w-lg md:max-w-2xl mx-auto">
          <div className="absolute -top-16 w-32 h-32 rounded-full border-4 border-white bg-white shadow-xl overflow-hidden flex items-center justify-center shrink-0 animate-fade-in">
            {isLogoImageUrl(store?.logo) ? (
              <img src={store!.logo} className="w-full h-full object-cover" alt="" />
            ) : (
              <div className="w-full h-full bg-[#1A1C1E] flex flex-col items-center justify-center text-white">
                <span className="material-symbols-outlined text-[#FFD23F] text-3xl font-bold">shopping_cart</span>
                <span className="text-xs font-black tracking-wider uppercase mt-1">{store?.business_name?.slice(0, 3)}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-[#1A1C1E] flex items-center justify-center gap-1.5 font-headline-xl">
              {store?.business_name || 'StoreFlow Store'}
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

            <p className="text-sm text-gray-500 font-medium max-w-sm mx-auto leading-relaxed pt-1">
              {store?.data?.marketplaceSettings?.description || 'Your trusted neighborhood store.'}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderStoreInfoCard = () => {
    const ms = store?.data?.marketplaceSettings;
    const address = store?.address;
    const phone = store?.phone;
    const email = store?.email;
    const website = ms?.website;
    const openingTime = ms?.openingTime;
    const closingTime = ms?.closingTime;
    const deliveryTime = ms?.deliveryTime || '15-25 min';
    const deliveryFee = ms?.deliveryFee !== undefined ? ms.deliveryFee : 1500;
    const minimumOrder = ms?.minimumOrder || 0;
    const storeType = store?.category || 'Grocery Store';
    const numProducts = products.length;
    const distance = ms?.distance || '0.8 km';

    const hasAddress = !!address;
    const hasPhone = !!phone;
    const hasEmail = !!email;
    const hasWebsite = !!website;
    const hasHours = !!(openingTime && closingTime);
    const hasDelivery = !!(deliveryTime || deliveryFee !== undefined);
    const hasMinOrder = minimumOrder !== undefined;
    const hasStoreType = !!storeType;
    const hasProducts = numProducts > 0;
    const hasDistance = !!distance;

    return (
      <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm text-left space-y-5 animate-fade-in">
        <h3 className="font-extrabold text-sm uppercase tracking-wider text-gray-400">Store Information</h3>

        <div className="space-y-4 text-xs">
          {hasAddress && (
            <div className="flex gap-3 items-start py-0.5 border-b border-gray-50 pb-3">
              <span className="material-symbols-outlined text-gray-400 text-lg shrink-0">location_on</span>
              <div className="min-w-0">
                <p className="font-bold text-gray-400 uppercase text-[9px] tracking-wider">Full Address</p>
                <p className="mt-0.5 leading-relaxed font-semibold text-gray-800 break-words">{address}</p>
              </div>
            </div>
          )}

          {hasPhone && (
            <div className="flex gap-3 items-start py-0.5 border-b border-gray-50 pb-3">
              <span className="material-symbols-outlined text-gray-400 text-lg shrink-0">call</span>
              <div>
                <p className="font-bold text-gray-400 uppercase text-[9px] tracking-wider">Phone Number</p>
                <p className="mt-0.5 font-semibold text-gray-800">{phone}</p>
              </div>
            </div>
          )}

          {hasEmail && (
            <div className="flex gap-3 items-start py-0.5 border-b border-gray-50 pb-3">
              <span className="material-symbols-outlined text-gray-400 text-lg shrink-0">mail</span>
              <div>
                <p className="font-bold text-gray-400 uppercase text-[9px] tracking-wider">Email Address</p>
                <p className="mt-0.5 font-semibold text-gray-800 break-all">{email}</p>
              </div>
            </div>
          )}

          {hasWebsite && (
            <div className="flex gap-3 items-start py-0.5 border-b border-gray-50 pb-3">
              <span className="material-symbols-outlined text-gray-400 text-lg shrink-0">language</span>
              <div className="min-w-0">
                <p className="font-bold text-gray-400 uppercase text-[9px] tracking-wider">Website</p>
                <a 
                  href={website.startsWith('http') ? website : 'https://' + website}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 font-semibold text-[#1A1C1E] hover:underline cursor-pointer block truncate"
                >
                  {website}
                </a>
              </div>
            </div>
          )}

          {hasHours && (
            <div className="flex gap-3 items-start py-0.5 border-b border-gray-50 pb-3">
              <span className="material-symbols-outlined text-gray-400 text-lg shrink-0">schedule</span>
              <div>
                <p className="font-bold text-gray-400 uppercase text-[9px] tracking-wider">Opening Hours</p>
                <p className="mt-0.5 font-semibold text-[#1A1C1E]">
                  {openingTime} – {closingTime}
                </p>
              </div>
            </div>
          )}

          {hasDelivery && (
            <div className="flex gap-3 items-start py-0.5 border-b border-gray-50 pb-3">
              <span className="material-symbols-outlined text-gray-400 text-lg shrink-0">local_shipping</span>
              <div>
                <p className="font-bold text-gray-400 uppercase text-[9px] tracking-wider">Delivery Details</p>
                <p className="mt-0.5 font-semibold text-gray-800">
                  Time: {deliveryTime} | Fee: {deliveryFee === 0 ? 'Free' : '₦' + deliveryFee.toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {hasMinOrder && (
            <div className="flex gap-3 items-start py-0.5 border-b border-gray-50 pb-3">
              <span className="material-symbols-outlined text-gray-400 text-lg shrink-0">payments</span>
              <div>
                <p className="font-bold text-gray-400 uppercase text-[9px] tracking-wider">Minimum Order</p>
                <p className="mt-0.5 font-semibold text-gray-800">
                  {minimumOrder === 0 ? 'No Minimum' : '₦' + minimumOrder.toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {hasStoreType && (
            <div className="flex gap-3 items-start py-0.5 border-b border-gray-50 pb-3">
              <span className="material-symbols-outlined text-gray-400 text-lg shrink-0">storefront</span>
              <div>
                <p className="font-bold text-gray-400 uppercase text-[9px] tracking-wider">Store Type</p>
                <p className="mt-0.5 font-semibold text-gray-800 capitalize">{storeType}</p>
              </div>
            </div>
          )}

          {hasProducts && (
            <div className="flex gap-3 items-start py-0.5 border-b border-gray-50 pb-3">
              <span className="material-symbols-outlined text-gray-400 text-lg shrink-0">inventory_2</span>
              <div>
                <p className="font-bold text-gray-400 uppercase text-[9px] tracking-wider">Catalog Size</p>
                <p className="mt-0.5 font-semibold text-gray-800">{numProducts} products listed</p>
              </div>
            </div>
          )}

          {hasDistance && (
            <div className="flex gap-3 items-start py-0.5">
              <span className="material-symbols-outlined text-gray-400 text-lg shrink-0">near_me</span>
              <div>
                <p className="font-bold text-gray-400 uppercase text-[9px] tracking-wider">Distance</p>
                <p className="mt-0.5 font-semibold text-gray-800">{distance} away from your location</p>
              </div>
            </div>
          )}
        </div>

        {/* Quick Action Buttons */}
        <div className="grid grid-cols-4 gap-2 text-[10px] font-bold text-center pt-2">
          {hasPhone && (
            <a 
              href={'tel:' + phone}
              className="bg-[#F8F9FA] border border-gray-100 py-3 rounded-[16px] flex flex-col items-center gap-1 cursor-pointer text-[#1A1C1E] active-scale transition-colors hover:bg-gray-100"
            >
              <span className="material-symbols-outlined text-lg text-[#FFD23F] font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>call</span>
              <span>Call</span>
            </a>
          )}
          {hasPhone && (
            <a 
              href={'https://wa.me/' + phone.replace(/\D/g, '')}
              target="_blank"
              rel="noreferrer"
              className="bg-[#F8F9FA] border border-gray-100 py-3 rounded-[16px] flex flex-col items-center gap-1 cursor-pointer text-[#1A1C1E] active-scale transition-colors hover:bg-gray-100"
            >
              <span className="material-symbols-outlined text-lg text-emerald-500 font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>chat</span>
              <span>WhatsApp</span>
            </a>
          )}
          {hasAddress && (
            <a 
              href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address)}
              target="_blank"
              rel="noreferrer"
              className="bg-[#F8F9FA] border border-gray-100 py-3 rounded-[16px] flex flex-col items-center gap-1 cursor-pointer text-[#1A1C1E] active-scale transition-colors hover:bg-gray-100"
            >
              <span className="material-symbols-outlined text-lg text-sky-500 font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>directions</span>
              <span>Directions</span>
            </a>
          )}
          <button 
            onClick={() => {
              if (navigator.share) {
                navigator.share({
                  title: store?.business_name || 'StoreFlow Store',
                  text: 'Shop online at ' + (store?.business_name || 'StoreFlow') + '!',
                  url: window.location.href
                }).catch(() => {});
              } else {
                navigator.clipboard.writeText(window.location.href);
                alert('Link copied to clipboard!');
              }
            }}
            className="bg-[#F8F9FA] border border-gray-100 py-3 rounded-[16px] flex flex-col items-center gap-1 cursor-pointer text-[#1A1C1E] active-scale transition-colors hover:bg-gray-100"
          >
            <span className="material-symbols-outlined text-lg text-amber-500 font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>share</span>
            <span>Share Store</span>
          </button>
        </div>
      </div>
    );
  };

  const renderStoreStatus = () => {
    const status = storeStatusText; // 'Open' | 'Closed' | 'Closing Soon'
    const colorClass = status === 'Open' 
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
      : status === 'Closing Soon' 
        ? 'bg-amber-50 text-amber-800 border-amber-100' 
        : 'bg-rose-50 text-rose-700 border-rose-100';

    const dotColor = status === 'Open' 
      ? 'bg-emerald-500' 
      : status === 'Closing Soon' 
        ? 'bg-amber-500' 
        : 'bg-rose-500';

    return (
      <div className="space-y-3">
        {/* Status Badge */}
        <div className={`border px-4 py-2.5 rounded-[20px] flex items-center justify-between shadow-sm text-xs font-bold ${colorClass}`}>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${dotColor} animate-pulse`} />
            <span className="uppercase tracking-wider font-extrabold text-[10px]">{status === 'Closed' ? 'Closed' : status === 'Closing Soon' ? 'Closing Soon' : 'Open'}</span>
          </div>
          <span className="text-[10px] text-gray-500 font-semibold">
            {status === 'Closed' ? 'Accepting orders when open' : status === 'Closing Soon' ? 'Closing shortly' : 'Accepting orders now'}
          </span>
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

  const renderReviewsModal = () => {
    if (!showReviewsModal) return null;
    const rating = store?.data?.marketplaceSettings?.rating;
    const reviewsCount = store?.data?.marketplaceSettings?.reviewsCount || 0;

    const handleRateStore = async (stars: number) => {
      if (isSubmittingRating || !store) return;
      setIsSubmittingRating(true);
      try {
        const prevRating = store.data?.marketplaceSettings?.rating || 0;
        const prevCount = store.data?.marketplaceSettings?.reviewsCount || 0;
        const newCount = prevCount + 1;
        const newRating = prevRating > 0 ? (prevRating * prevCount + stars) / newCount : stars;

        const updatedData = {
          ...store.data,
          marketplaceSettings: {
            ...store.data?.marketplaceSettings,
            rating: parseFloat(newRating.toFixed(2)),
            reviewsCount: newCount
          }
        };

        const updatedStore = {
          ...store,
          data: updatedData
        };

        // Update database
        const { error } = await supabase
          .from('stores')
          .update({ data: updatedData })
          .eq('id', store.id);

        if (error) throw error;

        setStore(updatedStore);
        setUserRating(stars);
        alert(`Thank you for rating this store ${stars} stars!`);
      } catch (err: any) {
        console.error('Failed to submit rating:', err);
        alert('Failed to submit rating: ' + (err.message || err));
      } finally {
        setIsSubmittingRating(false);
      }
    };

    return (
      <div 
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center animate-fade-in" 
        onClick={() => setShowReviewsModal(false)}
      >
        <div 
          className="bg-white w-full rounded-t-3xl overflow-hidden p-6 animate-slide-up max-h-[80vh] flex flex-col text-left" 
          onClick={e => e.stopPropagation()}
        >
          <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-5 shrink-0" />
          <div className="flex justify-between items-center mb-4 shrink-0">
            <h3 className="font-extrabold text-lg text-[#1A1C1E]">Store Ratings & Reviews</h3>
            <button 
              onClick={() => setShowReviewsModal(false)} 
              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-6 pb-6">
            {rating ? (
              <div className="bg-gray-50 rounded-[20px] p-5 flex items-center gap-6 border border-gray-100/50">
                <div className="text-center shrink-0">
                  <h1 className="text-4xl font-black text-[#1A1C1E]">{rating.toFixed(1)}</h1>
                  <p className="text-[9px] text-gray-400 font-extrabold mt-1 uppercase tracking-wider">Out of 5.0</p>
                  <p className="text-[8px] text-gray-400 font-bold mt-0.5">({reviewsCount} {reviewsCount === 1 ? 'review' : 'reviews'})</p>
                </div>
                
                <div className="flex-1 space-y-1">
                  {[
                    { stars: 5, pct: '85%' },
                    { stars: 4, pct: '10%' },
                    { stars: 3, pct: '3%' },
                    { stars: 2, pct: '1%' },
                    { stars: 1, pct: '1%' }
                  ].map(item => (
                    <div key={item.stars} className="flex items-center gap-2 text-xs">
                      <span className="w-3 text-right font-bold text-gray-500">{item.stars}</span>
                      <span className="text-amber-400 font-bold">★</span>
                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-[#1A1C1E] rounded-full" style={{ width: item.pct }} />
                      </div>
                      <span className="w-8 text-right font-medium text-gray-400">{item.pct}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-[20px] p-6 text-center border border-gray-100/50 space-y-2">
                <div className="text-4xl">⭐</div>
                <p className="text-sm font-extrabold text-[#1A1C1E]">No Ratings Yet</p>
                <p className="text-xs text-gray-400 max-w-[240px] mx-auto leading-relaxed">
                  Be the first to rate this store and help others in the community discover it!
                </p>
              </div>
            )}

            {/* Interactive Rating Selector */}
            <div className="border-t border-gray-100 pt-5 text-center space-y-3">
              <p className="text-xs font-black text-[#1A1C1E] uppercase tracking-wider">
                {userRating ? 'Your Rating' : 'Rate this Store'}
              </p>
              <div className="flex justify-center gap-2">
                {Array.from({ length: 5 }).map((_, s) => {
                  const starVal = s + 1;
                  const active = userRating ? userRating >= starVal : false;
                  return (
                    <button
                      key={s}
                      disabled={userRating !== null || isSubmittingRating}
                      onClick={() => handleRateStore(starVal)}
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                        active 
                          ? 'bg-amber-400 text-white shadow-md' 
                          : 'bg-gray-50 text-gray-400 hover:text-amber-400 hover:bg-amber-50'
                      } cursor-pointer disabled:cursor-default`}
                    >
                      <span 
                        className={`material-symbols-outlined text-2xl font-bold ${active ? 'font-variation-fill' : ''}`}
                        style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                      >
                        star
                      </span>
                    </button>
                  );
                })}
              </div>
              {userRating && (
                <p className="text-xs text-emerald-600 font-bold">
                  Submitted! Thank you for your feedback.
                </p>
              )}
            </div>

            <div className="text-xs text-gray-500 leading-relaxed space-y-2 border-t border-gray-100 pt-4">
              <p className="font-extrabold text-[#1A1C1E] text-sm">Verified Ratings Policy</p>
              <p>
                Ratings are dynamically aggregated based on checkout feedback from registered StoreFlow shoppers who placed completed orders at this storefront. Detailed customer reviews will be rendered once approved by our moderation team.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const scannedStoreIds = useMemo<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('storeflow_scanned_stores') || '[]');
    } catch {
      return [];
    }
  }, [allStores]); // re-derive when allStores loads

  const scannedStores = useMemo(() => {
    return allStores.filter(s => scannedStoreIds.includes(s.id));
  }, [allStores, scannedStoreIds]);

  const searchedStores = useMemo(() => {
    const base = scannedStores;
    if (!searchQuery) return base;
    return base.filter(s =>
      s.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.address?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
    );
  }, [scannedStores, searchQuery]);

  return (
    <div className="min-h-screen w-full flex justify-center bg-[#121315] text-[#1A1C1E] antialiased">
      <div className={`w-full max-w-screen-xl min-h-screen flex flex-col relative shadow-[0_0_60px_rgba(0,0,0,0.2)] border-x border-zinc-850/10 overflow-x-hidden ${darkMode ? 'dark bg-zinc-950 text-zinc-100' : 'bg-[#F8F9FA] text-[#1A1C1E]'}`}>


      
      {/* Offline Status Banner */}
      {!isOnline && (
        <div className="bg-rose-600 text-white text-xs py-2 px-4 text-center sticky top-0 z-[100] font-bold">
          ⚠️ You are offline. Showing cached catalog data. Sync when online.
        </div>
      )}

      {/* ─── 2. Onboarding Screen ─── */}
      {screen === 'onboarding' && (
        <div className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] flex flex-col justify-between p-6 max-w-md mx-auto">
          <div className="flex justify-end pt-4">
            <button onClick={() => { localStorage.setItem('storeflow_onboarded', 'true'); setIsOnboarded(true); navigateToScreen('home'); }} className="text-sm font-bold text-gray-400 hover:text-black cursor-pointer">Skip</button>
          </div>
          <main className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl font-black text-[#1A1C1E] font-headline-xl">Welcome to StoreFlow</h1>
              <p className="text-sm text-gray-500 max-w-xs mx-auto leading-relaxed font-semibold">
                Connect to nearby stores, select products, and check out in under a minute.
              </p>
            </div>
            <div className="relative w-72 h-72 bg-white border border-gray-100 rounded-[40px] shadow-sm overflow-hidden flex items-center justify-center p-6">
              <img className="w-full h-full object-cover rounded-3xl" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDqOVy4Qz9h-3rrA4QjtMif0NFdiQx8MP6W-YhT_kpIfRfOGfci_B4Xc9XLeWSafM-YqlExuIeOPtgv4axxkmJPWtOydIXtAo86zx5AnnoGPt0yViyi2oCJAS4daz9Mh07eaV4aJPzZz7WZnjp_7l5oDmOSOJstc_mvowOIXnl5L-vSjdmi1GbTe36GnOgDJZDBewq7CAYcn2Y9bJlUnFmSrNbwRXfmqYHrhMyJIfbPz8kHRI6SS8t1eg" alt="" />
            </div>
            <div className="flex justify-center space-x-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-gray-200"></div>
              <div className="h-1.5 w-6 rounded-full bg-[#1A1C1E]"></div>
              <div className="h-1.5 w-1.5 rounded-full bg-gray-200"></div>
            </div>
          </main>
          <footer className="space-y-4 pb-8">
            <button onClick={() => { localStorage.setItem('storeflow_onboarded', 'true'); setIsOnboarded(true); navigateToScreen('login'); }} className="w-full h-14 bg-[#1A1C1E] text-white font-bold rounded-xl active-scale cursor-pointer hover:bg-black transition-colors shadow-sm">
              Get Started
            </button>
            <button onClick={() => { localStorage.setItem('storeflow_onboarded', 'true'); setIsOnboarded(true); navigateToScreen('home'); }} className="w-full h-14 bg-white border border-gray-200 text-[#1A1C1E] font-bold rounded-xl active-scale cursor-pointer hover:bg-gray-50 transition-colors shadow-sm">
              Explore as Guest
            </button>
          </footer>
        </div>
      )}

      {/* ─── 3. Login / Signup Screen ─── */}
      {screen === 'login' && (
        <div className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] p-6 flex flex-col justify-between max-w-md mx-auto relative z-10">
          <header className="h-14 flex items-center">
            <button onClick={() => navigateToScreen('home')} className="w-10 h-10 rounded-full bg-white border border-gray-100 flex items-center justify-center cursor-pointer active-scale text-[#1A1C1E] shadow-sm">
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
          </header>

          <main className="flex-1 flex flex-col justify-center space-y-6 pt-6">
            <div className="text-center md:text-left">
              <h1 className="text-3xl font-extrabold text-[#1A1C1E] font-headline-xl">
                {authMode === 'login' ? 'Welcome back 👋' : 'Create Account 🚀'}
              </h1>
              <p className="text-sm text-gray-500 mt-1 font-semibold">
                {authMode === 'login' ? 'Log in to your StoreFlow account' : 'Register to save addresses and track orders'}
              </p>
            </div>

            {errorText && (
              <div className="p-3.5 bg-red-50 text-red-700 text-xs rounded-xl font-bold border border-red-200">
                {errorText}
              </div>
            )}

            <form className="space-y-4" onSubmit={e => e.preventDefault()}>
              {authMode === 'signup' && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase px-1 tracking-wider">Full Name</label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={e => setProfileName(e.target.value)}
                    className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold shadow-sm"
                    placeholder="Enter full name"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase px-1 tracking-wider">Email Address</label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={e => setAuthEmail(e.target.value)}
                  className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold shadow-sm"
                  placeholder="name@example.com"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase px-1 tracking-wider">Password</label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold shadow-sm"
                  placeholder="••••••••••••"
                />
              </div>

              <button onClick={handleEmailAuth} className="w-full h-14 bg-[#1A1C1E] hover:bg-black text-white font-bold rounded-xl active-scale cursor-pointer transition-colors shadow-sm">
                {authMode === 'login' ? 'Log In' : 'Sign Up'}
              </button>
            </form>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-[1px] bg-gray-200" />
              <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">or phone OTP</span>
              <div className="flex-1 h-[1px] bg-gray-200" />
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase px-1 tracking-wider">Phone Number</label>
                <input
                  type="tel"
                  value={authPhone}
                  onChange={e => setAuthPhone(e.target.value)}
                  className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold shadow-sm"
                  placeholder="+2348012345678"
                />
              </div>

              {showOTPField && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase px-1 tracking-wider">6-digit OTP Code</label>
                  <input
                    type="text"
                    value={authOTP}
                    onChange={e => setAuthOTP(e.target.value)}
                    className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold text-center tracking-widest shadow-sm"
                    placeholder="000000"
                  />
                </div>
              )}

              <button onClick={handlePhoneOTPAuth} className="w-full h-12 bg-[#FFD23F] text-slate-950 font-bold rounded-xl active-scale cursor-pointer flex items-center justify-center gap-2 shadow-sm transition-colors">
                <span className="material-symbols-outlined text-lg font-bold">sms</span>
                {showOTPField ? 'Verify OTP' : 'Send Phone OTP'}
              </button>
            </div>
          </main>

          <footer className="py-6 text-center">
            <button onClick={() => setAuthMode(m => m === 'login' ? 'signup' : 'login')} className="text-sm font-bold text-[#1A1C1E] cursor-pointer hover:underline">
              {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
            </button>
          </footer>
        </div>
      )}

      {/* ─── 4. Location Selector Screen ─── */}
      {screen === 'location' && (
        <div className="flex-1 p-6 flex flex-col justify-between">
          <header className="flex items-center gap-3 mb-6">
            <button onClick={() => navigateToScreen('home')} className="w-10 h-10 rounded-full bg-white border border-gray-100 flex items-center justify-center cursor-pointer active-scale text-[#1A1C1E] shadow-sm">
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <h1 className="text-base font-black text-[#1A1C1E] tracking-tight">Delivery Address</h1>
          </header>

          <main className="flex-1 space-y-6">
            {/* Search Input - almost invisible/native design */}
            <div className="relative w-full h-13 bg-gray-100 dark:bg-zinc-900 border border-transparent dark:border-zinc-850 rounded-2xl flex items-center px-4 transition-all">
              <span className="material-symbols-outlined text-gray-400 dark:text-gray-500 mr-2.5 text-lg">search</span>
              <input
                type="text"
                value={newAddressInput}
                onChange={e => setNewAddressInput(e.target.value)}
                className="bg-transparent border-none focus:ring-0 focus:outline-none w-full text-xs outline-none text-[#1A1C1E] dark:text-gray-100 placeholder:text-gray-450 dark:placeholder:text-gray-500 py-3 font-semibold"
                placeholder={editingAddress ? "Edit address..." : "Enter new address..."}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newAddressInput.trim()) {
                    addNewAddress();
                  }
                }}
              />
              {newAddressInput.trim() && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {editingAddress && (
                    <button
                      onClick={() => {
                        setNewAddressInput('');
                        setEditingAddress(null);
                      }}
                      className="px-2.5 py-1.5 text-gray-400 hover:text-gray-650 font-bold text-xs cursor-pointer transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={addNewAddress}
                    className="px-3.5 py-1.5 bg-[#1A1C1E] dark:bg-[#FFD23F] text-[#FFD23F] dark:text-[#1A1C1E] font-black rounded-lg text-xs cursor-pointer active:scale-95 transition"
                  >
                    {editingAddress ? 'Save' : 'Add'}
                  </button>
                </div>
              )}
            </div>

            {/* GPS inline row */}
            <button 
              onClick={requestGPSLocation} 
              className="w-full py-3.5 bg-white dark:bg-[#18191b] border border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/30 rounded-2xl flex items-center justify-center gap-2 text-xs font-black cursor-pointer active-scale text-[#1A1C1E] dark:text-gray-200 shadow-sm transition-colors"
            >
              <span className="material-symbols-outlined text-[#FFD23F] text-lg font-bold">my_location</span>
              <span>Use Current Location (GPS)</span>
            </button>

            {/* Saved Addresses list - unified divide list */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-wider px-1">Saved Addresses</h3>
              <div className="bg-white dark:bg-[#18191b] border border-gray-100 dark:border-zinc-800 rounded-3xl overflow-hidden divide-y divide-gray-100/50 dark:divide-zinc-800/50 shadow-sm">
                {savedAddresses.map(addr => (
                  <div
                    key={addr}
                    className="w-full flex items-center justify-between transition-colors hover:bg-gray-50/50 dark:hover:bg-zinc-800/20 group"
                  >
                    {/* Selectable click area */}
                    <div
                      onClick={() => selectAddressAndSave(addr)}
                      className="flex-1 flex items-center gap-3 py-4 px-5 cursor-pointer min-w-0"
                    >
                      <span className="material-symbols-outlined text-gray-400 dark:text-gray-550 text-lg">place</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-[#1A1C1E] dark:text-gray-200 truncate">{addr}</p>
                      </div>
                    </div>

                    {/* Edit & Delete Action Buttons */}
                    <div className="flex items-center gap-1 pr-3 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setNewAddressInput(addr);
                          setEditingAddress(addr);
                        }}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-[#1A1C1E] dark:hover:text-[#FFD23F] cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Edit Address"
                      >
                        <span className="material-symbols-outlined text-base">edit</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const updated = savedAddresses.filter(a => a !== addr);
                          setSavedAddresses(updated);
                          localStorage.setItem('storeflow_saved_addresses', JSON.stringify(updated));
                          if (selectedAddress === addr) {
                            const fallback = updated[0] || 'Lagos, Nigeria';
                            setSelectedAddress(fallback);
                            localStorage.setItem('storeflow_selected_address', fallback);
                          }
                        }}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-red-650 dark:hover:text-red-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Delete Address"
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
      )}

      {/* ─── 5. Home / Discover Screen ─── */}
      {screen === 'home' && (
        <div className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] pb-24">
          <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md h-16 flex justify-between items-center border-b border-gray-100 px-4 md:px-gutter text-[#1A1C1E]">
            <div className="flex items-center gap-3">
              <button onClick={() => navigateToScreen('profile')} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 transition-colors rounded-full cursor-pointer text-[#1A1C1E]">
                <span className="material-symbols-outlined text-xl">menu</span>
              </button>
              <div onClick={() => navigateToScreen('location')} className="flex flex-col cursor-pointer hover:opacity-85 select-none">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Deliver to</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-black text-[#1A1C1E]">{selectedAddress}</span>
                  <span className="material-symbols-outlined text-gray-400 text-base">expand_more</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Left blank or for other menu actions */}
            </div>
          </header>

          <main className="px-4 md:px-gutter mt-4 space-y-8">
            {/* Search Bar */}
            <div className="relative w-full h-14 bg-white rounded-full flex items-center px-4 border border-gray-200 focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 transition-all shadow-sm">
              <span className="material-symbols-outlined text-gray-400 mr-3">search</span>
              <input
                className="bg-transparent border-none focus:ring-0 focus:outline-none w-full text-sm outline-none text-[#1A1C1E] placeholder:text-gray-400"
                placeholder={searchPlaceholder}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="mr-2 cursor-pointer text-gray-400 hover:text-black">
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              )}
              <button 
                onClick={startScanner} 
                className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:text-[#1A1C1E] active:scale-95 transition-all shrink-0 cursor-pointer"
                title="Scan Barcode"
              >
                <span className="material-symbols-outlined text-lg">qr_code_scanner</span>
              </button>
            </div>

            {deferredPrompt && (
              <div className="bg-[#1A1C1E] text-white p-4 rounded-[24px] flex items-center justify-between border border-white/5 shadow-sm">
                <div>
                  <h4 className="font-extrabold text-sm text-white">Install StoreFlow App</h4>
                  <p className="text-xs text-gray-400 mt-0.5 font-semibold">Access offline shopping directly from your home screen.</p>
                </div>
                <button onClick={triggerInstall} className="px-4 py-2 bg-[#FFD23F] text-slate-950 text-xs font-black rounded-full active-scale cursor-pointer">
                  Install
                </button>
              </div>
            )}

            {/* Banner Carousel */}
            <section className="relative w-full aspect-[21/9] rounded-[24px] overflow-hidden shadow-sm bg-[#1A1C1E] text-white p-6 flex flex-col justify-between">
              <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent z-10" />
              <img className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-luminosity" src="https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1200&q=80" alt="" />
              <div className="relative z-20 space-y-1.5 max-w-xs text-left">
                <span className="bg-[#FFD23F] text-slate-950 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded">Promo</span>
                <h2 className="text-lg md:text-xl font-extrabold text-white">Nigeria Grocery Deals</h2>
                <p className="text-[10px] text-gray-300 font-medium">Get free delivery and up to 25% off StoreFlow partner orders today.</p>
              </div>
            </section>

            {/* Categories */}
            <section className="text-left">
              <h3 className="text-xs font-black text-gray-400 uppercase px-1 mb-3 tracking-wider">Browse Categories</h3>
              <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 py-1">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
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
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-black text-[#1A1C1E] font-headline-md tracking-tight">Your Stores</h2>
                {searchedStores.length > 0 && (
                  <button
                    onClick={startScanner}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1C1E] text-[#FFD23F] rounded-full text-[10px] font-black cursor-pointer hover:bg-black shadow-sm"
                  >
                    <span className="material-symbols-outlined text-sm">qr_code_scanner</span>
                    <span>Scan New</span>
                  </button>
                )}
              </div>

              {searchedStores.length === 0 ? (
                /* Empty state — no stores scanned yet */
                <div className="flex flex-col items-center justify-center py-14 text-center space-y-5">
                  <div className="w-24 h-24 bg-white border border-gray-100 rounded-[28px] flex items-center justify-center shadow-sm">
                    <span className="material-symbols-outlined text-5xl text-gray-300">qr_code_2</span>
                  </div>
                  <div className="space-y-1.5 max-w-[220px]">
                    <h3 className="text-base font-black text-[#1A1C1E]">No stores yet</h3>
                    <p className="text-xs text-gray-400 font-semibold leading-relaxed">Scan a store's QR code or barcode to instantly open their store profile and start shopping.</p>
                  </div>
                  <button
                    onClick={startScanner}
                    className="flex items-center gap-2 px-6 py-3.5 bg-[#1A1C1E] text-[#FFD23F] rounded-full font-black text-sm cursor-pointer hover:bg-black shadow-md active:scale-95 transition-transform"
                  >
                    <span className="material-symbols-outlined text-lg">qr_code_scanner</span>
                    <span>Scan a Store QR Code</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {searchedStores.map(s => (
                    <div
                      key={s.id}
                      onClick={() => {
                        setStoreId(s.id);
                        loadStoreDetails(s.id);
                        navigateToScreen('store');
                      }}
                      className="p-4 bg-white border border-gray-100 hover:border-gray-200 rounded-[24px] flex gap-4 cursor-pointer active-scale transition-all shadow-sm"
                    >
                      <div className="w-16 h-16 bg-[#F8F9FA] border border-gray-50 rounded-xl overflow-hidden shrink-0 flex items-center justify-center shadow-sm">
                        {isLogoImageUrl(s.logo) ? (
                          <img className="w-full h-full object-cover" src={s.logo} alt="" />
                        ) : (
                          <span className="text-3xl">🏪</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <h4 className="font-extrabold text-base text-[#1A1C1E] truncate">{s.business_name}</h4>
                        <p className="text-xs text-gray-400 mt-0.5 truncate font-semibold">{s.address || 'Partner Store'}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${computeStoreOpen(s) ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                            {computeStoreOpen(s) ? 'Open' : 'Closed'}
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
                {filteredProducts.slice(0, 4).map(p => (
                  <div
                    key={p.id}
                    onClick={() => {
                      setStoreId(p.store_id);
                      loadStoreDetails(p.store_id);
                      setSelectedProduct(p);
                      navigateToScreen('store');
                    }}
                    className="bg-white border border-gray-100 rounded-[24px] p-3 cursor-pointer hover:border-gray-200 transition-all flex flex-col justify-between active-scale shadow-sm"
                  >
                    <div className="relative w-full aspect-square bg-[#F8F9FA] rounded-xl mb-3 overflow-hidden flex items-center justify-center">
                      {p.image ? (
                        <img src={p.image} className="w-full h-full object-contain p-2" alt="" />
                      ) : (
                        <span className="text-2xl">📦</span>
                      )}
                    </div>
                    <div className="space-y-1 text-left">
                      <p className="font-bold text-xs text-[#1A1C1E] truncate">{p.name}</p>
                      <p className="font-black text-sm text-[#1A1C1E]">₦{getPrice(p).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </main>

          {/* ⚡ Quick Order FAB */}
          <div className="fixed bottom-24 left-0 right-0 w-full max-w-screen-xl mx-auto px-4 z-40 pointer-events-none">
            <div className="flex justify-end pointer-events-auto">
              <button
                onClick={() => setShowQuickOrder(true)}
                className="w-14 h-14 bg-[#1A1C1E] text-[#FFD23F] rounded-full flex items-center justify-center shadow-lg cursor-pointer hover:scale-105 active:scale-95 transition-transform"
                title="Quick Order"
              >
                <span className="material-symbols-outlined text-2xl font-bold">bolt</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ─── 5b. Explore Screen — All Partner Stores ─── */}
      {screen === 'explore' && (
        <div className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] pb-28">
          <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md h-16 flex items-center justify-between border-b border-gray-100 px-4 text-[#1A1C1E]">
            <h1 className="text-base font-black tracking-tight text-[#1A1C1E]">Explore Stores</h1>
            <button onClick={startScanner} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 transition-colors rounded-full cursor-pointer text-[#1A1C1E]">
              <span className="material-symbols-outlined text-xl">qr_code_scanner</span>
            </button>
          </header>

          <main className="px-4 mt-4 space-y-5">
            {/* Search */}
            <div className="relative w-full h-13 bg-white rounded-full flex items-center px-4 border border-gray-200 focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 transition-all shadow-sm">
              <span className="material-symbols-outlined text-gray-400 mr-3">search</span>
              <input
                className="bg-transparent border-none focus:ring-0 focus:outline-none w-full text-sm outline-none text-[#1A1C1E] placeholder:text-gray-400 py-3"
                placeholder="Search stores near you..."
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="mr-2 cursor-pointer text-gray-400 hover:text-black">
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              )}
            </div>

            {/* Nearby stores label */}
            <div className="flex items-center gap-2 text-left">
              <span className="material-symbols-outlined text-sm text-[#FFD23F] font-black">location_on</span>
              <span className="text-xs font-black text-gray-400 uppercase tracking-wider">Stores near you</span>
            </div>

            {/* Stores grid */}
            {allStores.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                <span className="material-symbols-outlined text-5xl text-gray-200">store</span>
                <p className="text-sm text-gray-400 font-semibold">No partner stores found in your area yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {allStores
                  .filter(s => !searchQuery || s.business_name.toLowerCase().includes(searchQuery.toLowerCase()) || (s.address?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false))
                  .map(s => (
                    <div
                      key={s.id}
                      onClick={() => {
                        setStoreId(s.id);
                        loadStoreDetails(s.id);
                        navigateToScreen('store');
                      }}
                      className="p-4 bg-white border border-gray-100 hover:border-gray-200 rounded-[24px] flex gap-4 cursor-pointer active-scale transition-all shadow-sm"
                    >
                      <div className="w-16 h-16 bg-[#F8F9FA] border border-gray-50 rounded-xl overflow-hidden shrink-0 flex items-center justify-center shadow-sm">
                        {isLogoImageUrl(s.logo) ? (
                          <img className="w-full h-full object-cover" src={s.logo} alt="" />
                        ) : (
                          <span className="text-3xl">🏪</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <h4 className="font-extrabold text-base text-[#1A1C1E] truncate">{s.business_name}</h4>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="material-symbols-outlined text-gray-300 text-sm">location_on</span>
                          <p className="text-xs text-gray-400 truncate font-semibold">{s.address || 'Partner Store'}</p>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${computeStoreOpen(s) ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                            {computeStoreOpen(s) ? 'Open' : 'Closed'}
                          </span>
                          <span className="text-[10px] font-semibold text-gray-400">• Tap to browse</span>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center">
                        <span className="material-symbols-outlined text-gray-300 text-lg">chevron_right</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </main>
        </div>
      )}

      {/* ─── 6. Store Details Page ─── */}
      {screen === 'store' && (
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
                <div className="px-4 max-w-lg md:max-w-2xl mx-auto space-y-6">
                  {/* 2. Store Status badge & Closed Warning */}
                  {renderStoreStatus()}

                  {/* 3. Store Information Card */}
                  {renderStoreInfoCard()}

                  {/* 4. Store Promotions */}
                  {renderStorePromotions()}

                  {/* 5. Product Search & Sort / Filter */}
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <div className="relative flex-1 h-13 bg-white rounded-full flex items-center px-4 border border-gray-200 focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 transition-all shadow-sm">
                        <span className="material-symbols-outlined text-gray-400 mr-2.5">search</span>
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          placeholder="Search products..."
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
                        <span className="material-symbols-outlined">filter_list</span>
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
                        <span className="material-symbols-outlined text-4xl">shopping_basket</span>
                      </div>
                      <div className="space-y-1">
                        <p className="font-extrabold text-[#1A1C1E] text-base">No Products Found</p>
                        <p className="text-xs text-gray-400 font-medium">This store hasn't added products yet or matches your query.</p>
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-5 gap-y-7">
                      {filteredProducts.map(p => {
                        const qtyInCart = getQty(p.id);
                        const isOutOfStock = p.quantity <= 0;
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

                              <div className="relative w-full aspect-square bg-[#F8F9FA] rounded-2xl mb-4 overflow-hidden flex items-center justify-center">
                                {p.image ? (
                                  <img src={p.image} className="w-full h-full object-contain p-2" alt="" />
                                ) : (
                                  <span className="material-symbols-outlined text-gray-300 text-3xl">image</span>
                                )}
                              </div>

                              <div className="space-y-0.5">
                                <h4 className="font-extrabold text-xs text-[#1A1C1E] truncate">{p.name}</h4>
                                <p className="text-[10px] text-gray-400 truncate">{p.unit || p.brand || p.category || 'Product'}</p>
                              </div>
                            </div>

                            <div className="mt-4 flex items-center justify-between">
                              <div className="flex flex-col">
                                <span className="font-black text-sm text-[#1A1C1E]">₦{getPrice(p).toLocaleString()}</span>
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

                </div>
              </div>
            )}
          </div>

          {/* 10. Bottom Cart Bar */}
          {totalItemsCount > 0 && (
            <div className="fixed bottom-20 left-0 right-0 z-40 w-full max-w-screen-xl mx-auto px-4">
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

          {showFilterModal && (
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
                      onClick={() => setShowInStockOnly(prev => !prev)}
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
          {renderReviewsModal()}

        </div>
      )}

      {/* ─── 7. Order Tracking timeline ─── */}
      {screen === 'tracking' && (
        <div className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] pb-32">
          {/* Header */}
          <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md flex justify-between items-center w-full h-16 border-b border-gray-100 px-4 text-[#1A1C1E]">
            <button 
              onClick={() => {
                navigateToScreen('store');
              }} 
              className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-[#1A1C1E] active:scale-95 transition cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <span className="text-sm font-black tracking-wider uppercase">Track Order</span>
            <div className="w-10 h-10" />
          </header>

          <main className="mt-6 px-4 max-w-md mx-auto space-y-6 text-left">
            {/* Status Header Hero */}
            <div className="text-center flex flex-col items-center gap-2.5 py-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-1 ${
                orderStatus === 'Rejected' || orderStatus === 'Cancelled' 
                  ? 'bg-rose-100 text-rose-600 border border-rose-200' 
                  : 'bg-[#FFD23F]/20 text-[#1A1C1E] border border-[#FFD23F]/40'
              }`}>
                <span className="material-symbols-outlined text-3xl font-black">
                  {orderStatus === 'Rejected' ? 'block' : orderStatus === 'Cancelled' ? 'close' : 'receipt_long'}
                </span>
              </div>
              <h1 className="text-2xl font-black text-[#1A1C1E] font-display uppercase tracking-tight">
                {orderStatus === 'Rejected' ? 'Order Rejected' : orderStatus === 'Cancelled' ? 'Order Cancelled' : 'Order Placed! 🎉'}
              </h1>
              <p className="text-xs text-gray-500 font-semibold max-w-xs leading-relaxed">
                {orderStatus === 'Pending Approval' && 'The store is currently reviewing your order details.'}
                {orderStatus === 'Accepted' && 'Your order was accepted! Awaiting packaging.'}
                {orderStatus === 'Preparing' && 'Staff are preparing and packing your order.'}
                {orderStatus === 'Ready' && 'Your order is ready! Awaiting pickup/delivery.'}
                {orderStatus === 'Out for Delivery' && 'Your package is on its way to you.'}
                {orderStatus === 'Delivered' && 'Order marked as delivered. Enjoy!'}
                {orderStatus === 'Completed' && 'Thank you for shopping with StoreFlow!'}
                {orderStatus === 'Changes Requested' && 'The merchant requested changes to your order.'}
              </p>
            </div>

            {/* Rejection Notice Banner */}
            {orderStatus === 'Rejected' && (
              <div className="bg-rose-50 border border-rose-150 text-rose-800 p-4 rounded-[20px] text-xs space-y-1.5 shadow-sm">
                <h4 className="font-extrabold text-sm flex items-center gap-1.5 text-rose-900">
                  <span className="material-symbols-outlined text-sm font-bold">warning</span>
                  <span>Cancellation details</span>
                </h4>
                <p className="text-rose-700 font-semibold leading-relaxed">
                  The merchant rejected your order.
                </p>
                {rejectionReason && (
                  <p className="mt-2 bg-white p-3 rounded-xl border border-rose-100 text-rose-800 font-bold font-mono">
                    Reason: {rejectionReason}
                  </p>
                )}
              </div>
            )}

            {/* Changes Requested Interactive Box */}
            {orderStatus === 'Changes Requested' && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-[20px] text-xs space-y-3.5 shadow-sm">
                <h4 className="font-extrabold text-sm flex items-center gap-1.5 text-amber-950">
                  <span className="material-symbols-outlined text-sm font-bold">info</span>
                  <span>Review Proposal</span>
                </h4>
                {changeRequestMessage && (
                  <div className="bg-white p-3 rounded-xl border border-amber-100 text-[#1A1C1E] leading-relaxed font-bold shadow-sm">
                    "{changeRequestMessage}"
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleCancelOrder}
                    disabled={loading}
                    className="flex-1 py-3 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600 font-extrabold rounded-xl transition cursor-pointer text-center uppercase tracking-wider text-xs shadow-sm"
                  >
                    Cancel Order
                  </button>
                  <button
                    onClick={handleApproveChanges}
                    disabled={loading}
                    className="flex-1 py-3 bg-[#1A1C1E] hover:bg-black text-[#FFD23F] font-black rounded-xl transition cursor-pointer text-center uppercase tracking-wider text-xs shadow-sm"
                  >
                    {loading ? 'Approving...' : 'Approve Proposal'}
                  </button>
                </div>
              </div>
            )}

            {/* Reference Badge Card */}
            <div className="bg-white border border-gray-100 rounded-[20px] p-5 flex items-center justify-between shadow-sm">
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Order Number</div>
                <div className="text-xl font-black mt-0.5 tracking-wider text-[#1A1C1E] font-mono">#{orderNumber}</div>
              </div>
              <button 
                onClick={copyOrderNumber} 
                className="px-4 py-2 rounded-xl bg-gray-50 border border-gray-100 text-xs font-black flex items-center gap-2 cursor-pointer hover:bg-gray-100 active:scale-95 transition-all text-[#1A1C1E]"
              >
                <span className="material-symbols-outlined text-sm">{orderCopied ? 'check' : 'content_copy'}</span>
                <span>{orderCopied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-3 gap-3 text-[#1A1C1E] text-xs">
              <div className="p-3 bg-white border border-gray-100 rounded-[20px] flex flex-col items-center text-center gap-1 shadow-sm">
                <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">schedule</span>
                <span className="font-black text-[11px] mt-1 truncate">{deliveryType === 'delivery' ? '30–45 min' : '15–20 min'}</span>
                <span className="text-[9px] text-gray-400 font-bold">Estimated Time</span>
              </div>
              <div className="p-3 bg-white border border-gray-100 rounded-[20px] flex flex-col items-center text-center gap-1 shadow-sm">
                <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">{deliveryType === 'delivery' ? 'local_shipping' : 'storefront'}</span>
                <span className="font-black text-[11px] mt-1 capitalize truncate">{deliveryType}</span>
                <span className="text-[9px] text-gray-400 font-bold">Order Mode</span>
              </div>
              <div className="p-3 bg-white border border-gray-100 rounded-[20px] flex flex-col items-center text-center gap-1 shadow-sm">
                <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">credit_card</span>
                <span className="font-black text-[11px] mt-1 capitalize truncate">{paymentMethod}</span>
                <span className="text-[9px] text-gray-400 font-bold">Payment</span>
              </div>
            </div>

            {/* Timeline Steps Tracker */}
            <div className="bg-white border border-gray-100 rounded-[24px] p-5 shadow-sm space-y-6">
              <h3 className="font-black text-sm uppercase tracking-wider text-[#1A1C1E] border-b border-gray-100 pb-2.5">Live Timeline</h3>
              
              <div className="relative border-l border-gray-200 ml-3.5 pl-6 space-y-6">
                {[
                  { key: 'Pending Approval', label: 'Order Sent & Awaiting Approval', desc: 'The merchant is verifying item stocks and pricing.' },
                  { key: 'Preparing', label: 'Order Accepted & Packing', desc: 'Staff are packaging your items at the store counter.' },
                  { key: 'Ready', label: deliveryType === 'delivery' ? 'Out for Delivery' : 'Ready at Counter', desc: deliveryType === 'delivery' ? 'Delivery dispatch agent is carrying your order.' : 'Visit the counter to pick up your package.' },
                  { key: 'Completed', label: 'Completed', desc: 'Thank you for shopping with StoreFlow!' },
                ].map((step) => {
                  const completed = isStatusAtLeast(orderStatus, step.key);
                  const active = orderStatus === step.key;
                  return (
                    <div key={step.key} className="relative">
                      <div className={`absolute -left-[30px] top-0.5 w-4 h-4 rounded-full border-2 transition-all duration-300 ${
                        active 
                          ? 'bg-[#FFD23F] border-[#1A1C1E] scale-110 shadow-lg' 
                          : completed 
                            ? 'bg-[#1A1C1E] border-[#1A1C1E]' 
                            : 'bg-white border-gray-200'
                      }`} />
                      <div className="space-y-1">
                        <div className={`text-xs font-black ${active ? 'text-[#FFD23F]' : completed ? 'text-[#1A1C1E]' : 'text-gray-400'}`}>{step.label}</div>
                        <div className="text-[10px] text-gray-400 leading-relaxed font-semibold">{step.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Navigation Actions */}
            <div className="space-y-3 pt-2">
              <button
                onClick={() => {
                  navigateToScreen('store');
                }}
                className="w-full py-4 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-2xl flex items-center justify-center gap-2 active:scale-98 transition shadow-lg text-sm uppercase tracking-wider cursor-pointer hover:bg-black"
              >
                <span className="material-symbols-outlined text-base font-bold">arrow_back</span>
                <span>Back to Storefront</span>
              </button>

              <button
                onClick={() => {
                  navigateToScreen('history');
                  loadOrdersHistory();
                }}
                className="w-full py-4 bg-white border border-gray-100 text-[#1A1C1E] font-extrabold rounded-2xl flex items-center justify-between px-5 hover:bg-gray-50 cursor-pointer shadow-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">receipt_long</span>
                  <span>View All Past Orders</span>
                </span>
                <span className="material-symbols-outlined text-gray-400 text-lg">chevron_right</span>
              </button>

              {/* PWA Installer banner */}
              {deferredPrompt && (
                <button 
                  onClick={triggerInstall} 
                  className="w-full py-4 bg-[#FFD23F]/10 border border-[#FFD23F]/20 text-[#1A1C1E] font-extrabold rounded-2xl flex items-center justify-between px-5 hover:bg-[#FFD23F]/15 cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">download</span>
                    <span>Install PWA Web App</span>
                  </span>
                  <span className="material-symbols-outlined text-gray-400 text-lg">chevron_right</span>
                </button>
              )}
            </div>
          </main>
        </div>
      )}

      {/* ─── 8. Profile Hub Screen ─── */}
      {screen === 'profile' && (
        <div className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] pb-32">
          {/* Header */}
          <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md flex justify-between items-center w-full h-16 border-b border-gray-100 px-4 text-[#1A1C1E]">
            <button 
              onClick={() => navigateToScreen('home')} 
              className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-[#1A1C1E] active:scale-95 transition cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <span className="text-sm font-black tracking-wider uppercase">Profile Hub</span>
            <div className="w-10 h-10" />
          </header>

          <main className="mt-6 px-4 max-w-md mx-auto space-y-6 text-left">
            {/* User credentials details */}
            <div className="p-5 bg-white border border-gray-100 rounded-3xl flex items-center gap-4 shadow-sm">
              <div className="w-14 h-14 bg-[#FFD23F] rounded-full flex items-center justify-center font-black text-slate-950 text-xl uppercase shadow-sm">
                {profileName ? profileName.slice(0, 2) : 'GS'}
              </div>
              <div className="space-y-0.5 text-left">
                <h4 className="font-extrabold text-base text-[#1A1C1E]">{profileName || 'Guest Shopper'}</h4>
                <p className="text-xs text-gray-400 font-semibold">{profileEmail || 'Shopping anonymously'}</p>
                {currentUser ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100 mt-1">
                    Registered Member
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-105 mt-1">
                    Guest Account
                  </span>
                )}
              </div>
            </div>

            {/* ─── It'sMe Identity Card ─── */}
            <button
              onClick={() => {
                setItsMeEditName(itsMeProfile.displayName);
                setItsMeEditPhone(itsMeProfile.phone);
                setItsMeEditEmail(itsMeProfile.email);
                setItsMeEditInstructions(itsMeProfile.deliveryInstructions);
                setShowItsMeScreen(true);
              }}
              className="w-full text-left"
            >
              <div className="relative overflow-hidden bg-[#1A1C1E] border border-white/10 rounded-3xl p-5 shadow-lg group cursor-pointer">
                {/* Decorative glow */}
                <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-[#FFD23F]/10 blur-2xl pointer-events-none" />
                <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-[#FFD23F]/5 blur-xl pointer-events-none" />

                <div className="relative z-10 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="w-14 h-14 rounded-2xl bg-[#FFD23F]/20 border border-[#FFD23F]/30 flex items-center justify-center shrink-0 text-xl font-black text-[#FFD23F]">
                      {itsMeProfile.displayName ? itsMeProfile.displayName.charAt(0).toUpperCase() : '✦'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[#FFD23F] font-black text-base tracking-tight">It'sMe</span>
                        <span className="text-[9px] bg-[#FFD23F]/15 text-[#FFD23F] border border-[#FFD23F]/25 px-2 py-0.5 rounded-full font-black uppercase tracking-wider">Identity</span>
                      </div>
                      <p className="text-white/80 text-xs font-semibold">
                        {itsMeProfile.displayName || 'Tap to set up your identity'}
                      </p>
                      <p className="text-white/40 text-[10px] font-mono mt-0.5">
                        ···{itsMeProfile.customerId.slice(-8)}
                      </p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-white/30 group-hover:text-[#FFD23F]/60 transition-colors text-xl">chevron_right</span>
                </div>

                <div className="relative z-10 mt-4 pt-4 border-t border-white/10 grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold">Phone</p>
                    <p className="text-[11px] text-white/70 font-bold mt-0.5 truncate">{itsMeProfile.phone || '—'}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold">Addresses</p>
                    <p className="text-[11px] text-white/70 font-bold mt-0.5">{itsMeProfile.addresses.length || '—'}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold">Payment</p>
                    <p className="text-[11px] text-[#FFD23F] font-bold mt-0.5 capitalize">{itsMeProfile.preferredPayment || '—'}</p>
                  </div>
                </div>

                <p className="relative z-10 text-center text-[10px] text-white/30 font-semibold mt-3">Your secure StoreFlow identity · Tap to open</p>
              </div>
            </button>

            {/* Form actions */}
            <div className="space-y-4 text-left">
              <div className="space-y-1 px-1">
                <label className="text-xs font-black text-gray-400 uppercase tracking-wider">Display Name</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-2xl border border-gray-200 focus:outline-none focus:border-gray-400 text-xs font-bold shadow-sm"
                />
              </div>

              {/* Dark mode toggler */}
              <div className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">dark_mode</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Dark Mode Accent</span>
                </div>
                <button
                  onClick={() => {
                    const newVal = !darkMode;
                    setDarkMode(newVal);
                    localStorage.setItem('storeflow_dark_mode', String(newVal));
                  }}
                  className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-200 ease-out focus:outline-none cursor-pointer ${darkMode ? 'bg-[#FFD23F]' : 'bg-gray-200'}`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-out ${darkMode ? 'translate-x-6' : 'translate-x-0'}`}
                  />
                </button>
              </div>

              {/* Saved list options */}
              <button 
                onClick={() => { navigateToScreen('history'); loadOrdersHistory(); }} 
                className="w-full p-4 bg-white border border-gray-100 rounded-2xl text-left font-extrabold text-xs uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-gray-50 active:scale-98 transition text-[#1A1C1E] shadow-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">receipt_long</span>
                  <span>My Orders History</span>
                </span>
                <span className="material-symbols-outlined text-gray-400 text-lg">chevron_right</span>
              </button>

              {/* PWA Installer */}
              {deferredPrompt && (
                <button 
                  onClick={triggerInstall} 
                  className="w-full p-4 bg-[#FFD23F]/10 border border-[#FFD23F]/20 rounded-2xl text-left font-extrabold text-xs uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-[#FFD23F]/15 active:scale-98 transition text-[#1A1C1E]"
                >
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">download</span>
                    <span>Install PWA App</span>
                  </span>
                  <span className="material-symbols-outlined text-gray-400 text-lg">chevron_right</span>
                </button>
              )}
            </div>
          </main>

          <footer className="py-6 px-4 max-w-md mx-auto">
            {currentUser ? (
              <button onClick={handleLogout} className="w-full h-14 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-2xl active-scale transition cursor-pointer uppercase tracking-wider text-xs">
                Log Out Account
              </button>
            ) : (
              <button onClick={() => navigateToScreen('login')} className="w-full h-14 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-2xl active-scale transition cursor-pointer uppercase tracking-wider text-xs hover:bg-black">
                Sign In / Register
              </button>
            )}
          </footer>
        </div>
      )}

      {/* ─── 9. Orders History Screen ─── */}
      {screen === 'history' && (
        <div className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] pb-32">
          {/* Header */}
          <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md flex justify-between items-center w-full h-16 border-b border-gray-100 px-4 text-[#1A1C1E]">
            <button 
              onClick={() => navigateToScreen('home')} 
              className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-[#1A1C1E] active:scale-95 transition cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <span className="text-sm font-black tracking-wider uppercase">Orders History</span>
            <div className="w-10 h-10" />
          </header>

          <main className="mt-6 px-4 max-w-md mx-auto space-y-4 text-left">
            {ordersHistory.length === 0 ? (
              <div className="text-center py-16 text-gray-400 flex flex-col items-center justify-center gap-3">
                <span className="material-symbols-outlined text-5xl text-gray-300">receipt_long</span>
                <p className="text-sm font-black uppercase tracking-wider text-[#1A1C1E]">No orders placed yet</p>
                <p className="text-xs text-gray-500 font-medium max-w-xs leading-relaxed">
                  When you place an order, it will appear here instantly with live tracking updates.
                </p>
              </div>
            ) : (
              sortedOrdersHistory.map((o: any, idx: number) => {
                // Section divider right where active orders end and finished ones begin
                const isFirstFinished = ACTIVE_STATUSES.includes(o.status) === false &&
                  idx > 0 && ACTIVE_STATUSES.includes(sortedOrdersHistory[idx - 1]?.status);
                let itemsSummary: any[] = [];
                let paymentMethodText = 'Cash';
                let storeNameText = 'Partner Store';
                
                if (o.notes) {
                  try {
                    const parsed = JSON.parse(o.notes);
                    itemsSummary = parsed.items_summary || [];
                    paymentMethodText = parsed.payment_method || 'Cash';
                    storeNameText = parsed.store_name || 'StoreFlow Partner';
                  } catch (e) {
                    // ignore
                  }
                }

                // If itemsSummary is empty, fallback to order_items relation
                if (itemsSummary.length === 0 && o.order_items) {
                  itemsSummary = o.order_items.map((oi: any) => ({
                    name: oi.product?.name || 'Product',
                    quantity: oi.quantity,
                    price: oi.price
                  }));
                }

                const totalQty = itemsSummary.reduce((sum: number, item: any) => sum + Number(item.quantity || 1), 0);

                return (
                  <div key={o.id} className="space-y-4">
                  {isFirstFinished && (
                    <div className="flex items-center gap-3 pt-2 pb-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Order History</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>
                  )}
                  <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-4 text-left">
                    {/* Header: Store Name & Date */}
                    <div className="flex justify-between items-start border-b border-gray-100 pb-3">
                      <div className="text-left">
                        <h4 className="font-extrabold text-sm text-[#1A1C1E] truncate max-w-[200px]">{storeNameText}</h4>
                        <p className="text-[10px] text-gray-400 font-mono mt-0.5">#{o.order_number}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-gray-400 font-bold block">{new Date(o.created_at).toLocaleDateString()}</span>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider mt-1 ${
                          o.status === 'Completed' || o.status === 'Delivered' ? 'bg-emerald-55 text-emerald-700 border border-emerald-100' :
                          o.status === 'Rejected' || o.status === 'Cancelled' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                          'bg-[#FFD23F]/20 text-[#1A1C1E] border border-[#FFD23F]/30'
                        }`}>
                          {o.status}
                        </span>
                      </div>
                    </div>

                    {/* Receipt Items list */}
                    <div className="space-y-2 text-xs text-left">
                      <p className="font-bold text-[10px] text-gray-400 uppercase tracking-wider">Order Items</p>
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {itemsSummary.map((item: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center text-gray-600">
                            <span className="font-semibold text-gray-800 text-left">
                              {item.name} <span className="text-gray-400 font-mono text-[10px]">x{item.quantity}</span>
                            </span>
                            <span className="font-mono text-gray-500">₦{Number(item.price || 0).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Totals & Metadata */}
                    <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100 space-y-2 text-xs text-left">
                      <div className="flex justify-between text-gray-500 font-semibold">
                        <span>Total Items</span>
                        <span>{totalQty} items</span>
                      </div>
                      <div className="flex justify-between text-gray-500 font-semibold">
                        <span>Payment Mode</span>
                        <span className="capitalize">{paymentMethodText}</span>
                      </div>
                      <div className="flex justify-between text-[#1A1C1E] font-extrabold border-t border-gray-100 pt-2">
                        <span>Paid Total</span>
                        <span className="text-[#1A1C1E] font-black">₦{o.total.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1 text-xs font-bold">
                      <button
                        onClick={() => {
                          setOrderId(o.id);
                          setOrderNumber(o.order_number);
                          setOrderStatus(o.status);
                          navigateToScreen('tracking');
                        }}
                        className="flex-1 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-[#1A1C1E] rounded-xl text-center cursor-pointer uppercase tracking-wider transition shadow-sm"
                      >
                        Track Status
                      </button>
                      <button
                        onClick={() => handleReorder(o)}
                        className="flex-1 py-3 bg-[#FFD23F] text-slate-950 rounded-xl text-center cursor-pointer uppercase font-black tracking-wider transition hover:opacity-90 active:scale-98 shadow-sm"
                      >
                        Reorder Items
                      </button>
                    </div>
                  </div>
                  </div>
                );
              })
            )}
          </main>
        </div>
      )}
      {/* ─── 10. Store Not Found Screen ─── */}
      {screen === 'store_not_found' && (
        <main className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-background text-on-surface">
          <div className="max-w-md w-full p-8 bg-surface-container rounded-3xl border border-outline-variant/10 shadow-xl space-y-6 animate-scale">
            <div className="w-20 h-20 bg-error-container text-error rounded-[28%] flex items-center justify-center mx-auto shadow-md">
              <span className="material-symbols-outlined text-4xl font-bold">storefront</span>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black tracking-tight text-on-background font-headline-xl">Store Not Found</h1>
              <p className="text-sm text-secondary-fixed-dim leading-relaxed max-w-[280px] mx-auto">
                The link or QR code you scanned does not correspond to an active partner merchant on StoreFlow.
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={() => navigateToScreen('home')}
                className="w-full h-14 bg-primary text-on-primary font-bold rounded-full shadow-lg active:scale-98 hover:bg-primary/95 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">home</span>
                <span>Go to Home Page</span>
              </button>
            </div>
          </div>
        </main>
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
                {selectedProduct.image ? (
                  <img src={selectedProduct.image} className="w-full h-full object-contain p-4" alt="" />
                ) : (
                  <span className="text-6xl">📦</span>
                )}
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-on-background font-headline-lg">{selectedProduct.name}</h2>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-xl font-extrabold text-primary">{store?.currency || '₦'}{getPrice(selectedProduct).toLocaleString()}</span>
                  <span className={`text-xs font-semibold ${selectedProduct.quantity > 0 ? 'text-primary' : 'text-error'}`}>
                    {selectedProduct.quantity > 0 ? 'Available' : 'Out of Stock'}
                  </span>
                </div>
              </div>
              {selectedProduct.description && (
                <div>
                  <h4 className="text-xs font-bold text-secondary uppercase mb-1">Description</h4>
                  <p className="text-sm text-secondary-fixed-dim leading-relaxed">{selectedProduct.description}</p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4 w-full">
              {getQty(selectedProduct.id) > 0 ? (
                <>
                  <div className="flex justify-between items-center bg-surface-container-low rounded-2xl p-2 border border-outline-variant/10">
                    <span className="text-xs font-bold text-secondary px-2">Quantity in Cart</span>
                    <div className="flex items-center gap-4">
                      <button onClick={() => addToCart(selectedProduct, -1)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer border border-gray-100">
                        <span className="material-symbols-outlined text-lg">remove</span>
                      </button>
                      <span className="font-extrabold text-base text-on-surface">{getQty(selectedProduct.id)}</span>
                      <button onClick={() => addToCart(selectedProduct, 1)} className="w-10 h-10 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer">
                        <span className="material-symbols-outlined text-lg">add</span>
                      </button>
                    </div>
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setIsCartOpen(false)}>
          <div className="bg-white w-full rounded-t-3xl overflow-hidden p-6 flex flex-col max-h-[85vh] text-[#1A1C1E]" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-5"></div>
            
            {checkoutStep === 'shopping' && (
              <>
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-[#1A1C1E] font-headline-lg">My Cart ({totalItemsCount})</span>
                    {cart.length > 0 && (
                      <button onClick={() => setCart([])} className="text-xs text-red-600 font-bold hover:underline cursor-pointer">
                        Clear All
                      </button>
                    )}
                  </div>
                  <button onClick={() => setIsCartOpen(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors text-[#1A1C1E]">
                    <span className="material-symbols-outlined text-lg">close</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 pr-1 py-2">
                  {cart.map(item => (
                    <div key={item.product.id} className="flex gap-4 items-center pb-4 border-b border-gray-100">
                      <div className="w-14 h-14 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden shrink-0 border border-gray-100">
                        {item.product.image ? (
                          <img src={item.product.image} className="w-full h-full object-contain p-1" alt="" />
                        ) : (
                          <span className="text-2xl">📦</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <h4 className="font-bold text-sm text-[#1A1C1E] truncate">{item.product.name}</h4>
                        <span className="text-xs text-gray-400 mt-0.5 block font-semibold">₦{getPrice(item.product)} each</span>
                      </div>
                      <div className="flex items-center gap-3 bg-gray-50 rounded-full p-1 border border-gray-100 shrink-0">
                        <button onClick={() => addToCart(item.product, -1)} className="w-8 h-8 bg-white text-[#1A1C1E] rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer border border-gray-100">
                          <span className="material-symbols-outlined text-sm font-bold">remove</span>
                        </button>
                        <span className="font-black text-sm text-[#1A1C1E] w-4 text-center">{item.quantity}</span>
                        <button onClick={() => addToCart(item.product, 1)} className="w-8 h-8 bg-[#1A1C1E] text-[#FFD23F] rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer">
                          <span className="material-symbols-outlined text-sm font-black">add</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-gray-100 pt-4 mt-4 text-[#1A1C1E]">
                  <div className="space-y-2 mb-5 text-left">
                    <div className="flex justify-between text-xs text-gray-400 font-bold">
                      <span>Subtotal</span><span>₦{subtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 font-bold">
                      <span>Delivery Fee</span><span>{deliveryFee === 0 ? 'FREE' : `₦${deliveryFee}`}</span>
                    </div>
                    <div className="h-[1px] bg-gray-105 my-2"></div>
                    <div className="flex justify-between text-base font-black text-[#1A1C1E]">
                      <span>Total</span><span>₦{total.toLocaleString()}</span>
                    </div>
                  </div>
                  <button
                    disabled={cart.length === 0}
                    onClick={() => setCheckoutStep('checkout')}
                    className="w-full py-4 rounded-full font-black uppercase tracking-wider text-xs shadow-md transition-all cursor-pointer bg-black text-[#FFD23F] hover:bg-black/90 disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none"
                  >
                    Continue to Checkout
                  </button>
                </div>
              </>
            )}

            {checkoutStep === 'checkout' && (
              <div className="space-y-5 overflow-y-auto max-h-[75vh] py-2 text-[#1A1C1E]">
                <div className="flex justify-between items-center text-left">
                  <h3 className="font-black text-lg font-headline-lg text-[#1A1C1E]">Checkout Details</h3>
                  <button onClick={() => setCheckoutStep('shopping')} className="w-8 h-8 rounded-full bg-gray-100 text-[#1A1C1E] flex items-center justify-center cursor-pointer hover:bg-gray-200">
                    <span className="material-symbols-outlined text-base">arrow_back</span>
                  </button>
                </div>

                {/* Compact Order Summary */}
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 text-[#1A1C1E]">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-black uppercase tracking-wider text-gray-400">Order Summary ({totalItemsCount})</span>
                    <span className="text-xs font-black text-[#1A1C1E]">₦{total.toLocaleString()}</span>
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-2 pr-1">
                    {cart.map(item => (
                      <div key={item.product.id} className="flex justify-between items-center text-xs">
                        <span className="font-bold text-[#1A1C1E] truncate max-w-[200px]">{item.product.name} <span className="text-gray-400 font-semibold">x{item.quantity}</span></span>
                        <span className="font-black text-gray-600">₦{(getPrice(item.product) * item.quantity).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ─── It'sMe Prefill Button ─── */}
                <button
                  onClick={applyItsMeToCheckout}
                  className="w-full py-3.5 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-2xl flex items-center justify-center gap-2 shadow-md active:scale-[0.98] transition-transform cursor-pointer border border-[#FFD23F]/20 hover:border-[#FFD23F]/40"
                >
                  <span className="text-base">✨</span>
                  <span className="text-sm">Fill with It'sMe</span>
                  {itsMeProfile.displayName && (
                    <span className="text-[10px] font-semibold text-[#FFD23F]/60">— {itsMeProfile.displayName}</span>
                  )}
                </button>
                <div className="space-y-2 text-left">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-wider">Order Option</label>
                  <div className="grid grid-cols-2 gap-2 bg-gray-50 rounded-full p-1 border border-gray-100">
                    <button onClick={() => setDeliveryType('pickup')} className={`py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${deliveryType === 'pickup' ? 'bg-[#1A1C1E] text-white shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}>
                      Store Pickup
                    </button>
                    <button onClick={() => setDeliveryType('delivery')} className={`py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${deliveryType === 'delivery' ? 'bg-[#1A1C1E] text-white shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}>
                      Home Delivery
                    </button>
                  </div>
                </div>

                {(store?.data?.marketplaceSettings?.reqCustomerName !== false) && (
                  <div className="space-y-1 text-left">
                    <label className="text-xs font-black text-gray-400 uppercase px-1 tracking-wider">Full Name</label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 focus:ring-2 focus:ring-[#1A1C1E]/20 text-[#1A1C1E] rounded-xl text-sm font-semibold outline-none shadow-sm"
                      placeholder="Enter full name"
                    />
                  </div>
                )}

                {(store?.data?.marketplaceSettings?.reqCustomerPhone !== false) && (
                  <div className="space-y-1 text-left">
                    <label className="text-xs font-black text-gray-400 uppercase px-1 tracking-wider">Phone Number</label>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={e => setCustomerPhone(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 focus:ring-2 focus:ring-[#1A1C1E]/20 text-[#1A1C1E] rounded-xl text-sm font-semibold outline-none shadow-sm"
                      placeholder="e.g. 08123456789"
                    />
                  </div>
                )}

                {(store?.data?.marketplaceSettings?.reqCustomerEmail === true) && (
                  <div className="space-y-1 text-left">
                    <label className="text-xs font-black text-gray-400 uppercase px-1 tracking-wider">Email Address</label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={e => setCustomerEmail(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 focus:ring-2 focus:ring-[#1A1C1E]/20 text-[#1A1C1E] rounded-xl text-sm font-semibold outline-none shadow-sm"
                      placeholder="Enter email address"
                    />
                  </div>
                )}

                {deliveryType === 'delivery' && (store?.data?.marketplaceSettings?.reqCustomerAddress !== false) && (
                  <div className="space-y-1 text-left">
                    <label className="text-xs font-black text-gray-400 uppercase px-1 tracking-wider">Delivery Address</label>
                    <input
                      type="text"
                      value={deliveryAddress}
                      onChange={e => setDeliveryAddress(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 focus:ring-2 focus:ring-[#1A1C1E]/20 text-[#1A1C1E] rounded-xl text-sm font-semibold outline-none shadow-sm"
                      placeholder="Enter street address"
                    />
                  </div>
                )}

                {deliveryType === 'delivery' && (store?.data?.marketplaceSettings?.reqCustomerLandmark === true) && (
                  <div className="space-y-1 text-left">
                    <label className="text-xs font-black text-gray-400 uppercase px-1 tracking-wider">Landmark / Near Bus Stop</label>
                    <input
                      type="text"
                      value={deliveryLandmark}
                      onChange={e => setDeliveryLandmark(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 focus:ring-2 focus:ring-[#1A1C1E]/20 text-[#1A1C1E] rounded-xl text-sm font-semibold outline-none shadow-sm"
                      placeholder="Nearest landmark"
                    />
                  </div>
                )}

                {(store?.data?.marketplaceSettings?.reqCustomerNotes !== false) && (
                  <div className="space-y-1 text-left">
                    <label className="text-xs font-black text-gray-400 uppercase px-1 tracking-wider">Special Instructions</label>
                    <input
                      type="text"
                      value={specialInstructions}
                      onChange={e => setSpecialInstructions(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-gray-200 focus:ring-2 focus:ring-[#1A1C1E]/20 text-[#1A1C1E] rounded-xl text-sm font-semibold outline-none shadow-sm"
                      placeholder="e.g. Leave with guard"
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  {localStorage.getItem('storeflow_saved_checkout_phone') && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerName(localStorage.getItem('storeflow_saved_checkout_name') || '');
                        setCustomerPhone(localStorage.getItem('storeflow_saved_checkout_phone') || '');
                        setDeliveryAddress(localStorage.getItem('storeflow_pref_address') || '');
                        setDeliveryLandmark(localStorage.getItem('storeflow_saved_checkout_landmark') || '');
                        setSpecialInstructions(localStorage.getItem('storeflow_saved_checkout_notes') || '');
                      }}
                      className="px-4 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-full font-bold text-xs transition cursor-pointer shadow-sm"
                    >
                      "It's Me" Prefill
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!customerName.trim()) {
                        alert('Please enter your name.');
                        return;
                      }
                      const normalized = normalizeNigerianPhone(customerPhone);
                      if (!normalized) {
                        alert('Please enter a valid Nigerian mobile phone number (e.g. 080xxxxxxxx).');
                        return;
                      }
                      if (deliveryType === 'delivery' && !deliveryAddress.trim()) {
                        alert('Please enter a delivery address.');
                        return;
                      }
                      setCustomerPhone(normalized);
                      setCheckoutStep('payment');
                    }}
                    className="flex-1 bg-[#1A1C1E] text-white hover:bg-black py-4 rounded-full font-black uppercase tracking-wider text-xs shadow-md active:scale-98 transition-all cursor-pointer"
                  >
                    Continue to Payment
                  </button>
                </div>
              </div>
            )}

            {checkoutStep === 'payment' && (
              <div className="space-y-5 text-[#1A1C1E]">
                <div className="flex justify-between items-center text-left">
                  <h3 className="font-black text-lg font-headline-lg text-[#1A1C1E]">Select Payment</h3>
                  <button onClick={() => setCheckoutStep('checkout')} className="w-8 h-8 rounded-full bg-gray-100 text-[#1A1C1E] flex items-center justify-center cursor-pointer hover:bg-gray-200">
                    <span className="material-symbols-outlined text-base">arrow_back</span>
                  </button>
                </div>

                {/* Compact Order Summary */}
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 text-[#1A1C1E]">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-black uppercase tracking-wider text-gray-400">Order Summary ({totalItemsCount})</span>
                    <span className="text-xs font-black text-[#1A1C1E]">₦{total.toLocaleString()}</span>
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-2 pr-1">
                    {cart.map(item => (
                      <div key={item.product.id} className="flex justify-between items-center text-xs">
                        <span className="font-bold text-[#1A1C1E] truncate max-w-[200px]">{item.product.name} <span className="text-gray-400 font-semibold">x{item.quantity}</span></span>
                        <span className="font-black text-gray-600">₦{(getPrice(item.product) * item.quantity).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  {paymentMethodsList.map(opt => (
                    <div
                      key={opt.key}
                      onClick={() => setPaymentMethod(opt.key as any)}
                      className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center gap-3 text-left ${paymentMethod === opt.key ? 'border-[#1A1C1E] bg-[#1A1C1E]/5 text-[#1A1C1E]' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                    >
                      <span className={`material-symbols-outlined text-2xl ${paymentMethod === opt.key ? 'text-[#FFD23F] font-black' : 'text-gray-400'}`}>{opt.icon}</span>
                      <div className="flex-1">
                        <div className="text-sm font-black">{opt.label}</div>
                        <div className="text-xs text-gray-400 mt-0.5 font-semibold">{opt.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={submitOrder}
                  className="w-full bg-[#1A1C1E] hover:bg-black text-[#FFD23F] py-4 rounded-full font-black uppercase tracking-wider text-xs shadow-md active:scale-98 transition-all cursor-pointer"
                >
                  Place Order (₦{total.toLocaleString()})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── ⚡ Quick Order Overlay Sheet ─── */}
      {showQuickOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setShowQuickOrder(false)}>
          <div className="bg-white w-full rounded-t-3xl overflow-hidden p-6 animate-slide-up space-y-6 text-[#1A1C1E]" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-2"></div>
            <div className="flex justify-between items-center text-left">
              <h3 className="font-black text-lg flex items-center gap-2 text-[#1A1C1E]">
                <span className="material-symbols-outlined text-[#FFD23F] font-black text-xl">bolt</span>
                <span>⚡ Quick Order</span>
              </h3>
              <button onClick={() => setShowQuickOrder(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center cursor-pointer text-[#1A1C1E] hover:bg-gray-200">
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="space-y-4">
              {/* Vocal search */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={quickOrderInput}
                  onChange={e => { setQuickOrderInput(e.target.value); setSearchQuery(e.target.value); }}
                  placeholder="Voice search or barcode scan..."
                  className="flex-1 px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold shadow-sm"
                />
                <button
                  onClick={handleVoiceSearch}
                  className={`w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer transition-colors active-scale ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 text-[#1A1C1E] hover:bg-gray-200'}`}
                >
                  <span className="material-symbols-outlined text-xl">{isListening ? 'mic' : 'mic_none'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-left">
                <button onClick={startScanner} className="p-4 bg-white border border-gray-200 hover:bg-gray-50 rounded-2xl flex flex-col items-center gap-1.5 cursor-pointer active-scale shadow-sm">
                  <span className="material-symbols-outlined text-[#FFD23F] text-2xl font-black">qr_code_scanner</span>
                  <span className="text-xs font-black text-[#1A1C1E]">Scan Barcode</span>
                </button>
                <button
                  onClick={() => {
                    const firstStore = allStores[0];
                    if (firstStore) {
                      setStoreId(firstStore.id);
                      loadStoreDetails(firstStore.id);
                      navigateToScreen('store');
                      setShowQuickOrder(false);
                    }
                  }}
                  className="p-4 bg-white border border-gray-200 hover:bg-gray-50 rounded-2xl flex flex-col items-center gap-1.5 cursor-pointer active-scale shadow-sm"
                >
                  <span className="material-symbols-outlined text-[#FFD23F] text-2xl font-black">history</span>
                  <span className="text-xs font-black text-[#1A1C1E]">Repeat Order</span>
                </button>
              </div>

              <div className="space-y-2 text-left">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider px-1">AI Smart Suggestions</h4>
                <div className="p-4 bg-[#FFD23F]/5 border border-[#FFD23F]/20 rounded-2xl space-y-2">
                  <p className="text-xs font-black text-[#1A1C1E]">Cheaper Store Found!</p>
                  <p className="text-xs text-gray-500 font-semibold">Indomie Chicken is 15% cheaper at FreshMart. Switch to save ₦120.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── It'sMe Identity Screen Overlay ─── */}
      {showItsMeScreen && (
        <div className="absolute inset-0 z-[200] bg-[#F8F9FA] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-white border-b border-gray-100 px-4 h-16 flex items-center justify-between shrink-0">
            <button
              onClick={() => setShowItsMeScreen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-[#1A1C1E] cursor-pointer active:scale-95 transition"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <div className="text-center">
              <p className="text-[#FFD23F] font-black text-base tracking-tight leading-none">It'sMe</p>
              <p className="text-[10px] text-gray-400 font-semibold">Your secure StoreFlow identity</p>
            </div>
            <button
              onClick={() => {
                updateItsMeProfileAndSync({
                  ...itsMeProfile,
                  displayName: itsMeEditName,
                  phone: itsMeEditPhone,
                  email: itsMeEditEmail,
                  deliveryInstructions: itsMeEditInstructions,
                });
                setShowItsMeScreen(false);
              }}
              className="px-3 py-1.5 bg-[#1A1C1E] text-[#FFD23F] text-xs font-black rounded-full cursor-pointer hover:bg-black active:scale-95 transition"
            >
              Save
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-4 py-5 space-y-5 pb-10">

            {/* Identity Hero Card */}
            <div className="relative overflow-hidden bg-[#1A1C1E] rounded-3xl p-6 shadow-lg">
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[#FFD23F]/10 blur-2xl pointer-events-none" />
              <div className="relative z-10 flex flex-col items-center text-center gap-3">
                {/* Avatar with Photo Upload */}
                <div className="relative group w-20 h-20">
                  {itsMeProfile.profilePhoto ? (
                    <img src={itsMeProfile.profilePhoto} className="w-20 h-20 rounded-2xl object-cover border border-[#FFD23F]/30" alt="" />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-[#FFD23F]/20 border border-[#FFD23F]/30 flex items-center justify-center text-3xl font-black text-[#FFD23F]">
                      {itsMeProfile.displayName ? itsMeProfile.displayName.charAt(0).toUpperCase() : '✦'}
                    </div>
                  )}
                  <label htmlFor="itsme-photo-upload-input" className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-2xl cursor-pointer transition-opacity">
                    <span className="material-symbols-outlined text-[#FFD23F] text-xl font-bold">photo_camera</span>
                  </label>
                  <input
                    type="file"
                    id="itsme-photo-upload-input"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-white font-black text-lg">{itsMeProfile.displayName || 'Your Name'}</span>
                    <span className="text-[9px] bg-[#FFD23F]/15 text-[#FFD23F] border border-[#FFD23F]/25 px-2 py-0.5 rounded-full font-black uppercase tracking-wider">It'sMe</span>
                  </div>
                  <p className="text-white/40 text-[10px] font-mono mt-1 select-all">{itsMeProfile.customerId}</p>
                </div>
                {/* Quick stats row */}
                <div className="w-full grid grid-cols-3 gap-2 mt-2 pt-4 border-t border-white/10">
                  <div className="text-center">
                    <p className="text-[#FFD23F] font-black text-base">{itsMeProfile.addresses.length}</p>
                    <p className="text-white/40 text-[9px] font-bold uppercase tracking-wider mt-0.5">Addresses</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[#FFD23F] font-black text-base">{ordersHistory.length}</p>
                    <p className="text-white/40 text-[9px] font-bold uppercase tracking-wider mt-0.5">Orders</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[#FFD23F] font-black text-base capitalize">{itsMeProfile.preferredPayment.slice(0,4)}</p>
                    <p className="text-white/40 text-[9px] font-bold uppercase tracking-wider mt-0.5">Payment</p>
                  </div>
                </div>
              </div>
            </div>

            {/* QR Code Identity Card */}
            <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm flex flex-col items-center justify-center text-center space-y-3">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Your Personal QR Code</p>
              <div className="bg-[#1A1C1E] p-4 rounded-[24px] shadow-md border border-white/5">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(itsMeProfile.customerId)}`}
                  alt="Customer ID QR Code"
                  className="w-40 h-40 bg-white p-2.5 rounded-2xl mx-auto"
                />
              </div>
              <p className="text-[11px] text-gray-400 font-semibold max-w-[240px]">Scan this code at checkout counters or share it with partner stores to link your identity instantly.</p>
            </div>

            {/* Contact Info */}
            <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Contact Info</h3>
                <button onClick={tryBrowserAutofill} className="text-[10px] text-[#1A1C1E] font-black flex items-center gap-1 cursor-pointer hover:text-gray-600">
                  <span className="material-symbols-outlined text-xs">download</span>
                  Import from browser
                </button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Display Name</label>
                  <input
                    type="text"
                    autoComplete="name"
                    value={itsMeEditName}
                    onChange={e => setItsMeEditName(e.target.value)}
                    className="w-full px-4 py-3 bg-[#F8F9FA] border border-gray-200 focus:border-gray-400 focus:outline-none text-[#1A1C1E] rounded-xl text-sm font-semibold"
                    placeholder="Your full name"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Phone Number</label>
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={itsMeEditPhone}
                    onChange={e => setItsMeEditPhone(e.target.value)}
                    className="w-full px-4 py-3 bg-[#F8F9FA] border border-gray-200 focus:border-gray-400 focus:outline-none text-[#1A1C1E] rounded-xl text-sm font-semibold"
                    placeholder="+234 xxx xxx xxxx"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Email</label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={itsMeEditEmail}
                    onChange={e => setItsMeEditEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-[#F8F9FA] border border-gray-200 focus:border-gray-400 focus:outline-none text-[#1A1C1E] rounded-xl text-sm font-semibold"
                    placeholder="your@email.com"
                  />
                </div>
              </div>
            </div>

            {/* Delivery Addresses */}
            <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-4">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Saved Addresses</h3>
              {itsMeProfile.addresses.map((addr, i) => (
                <div key={i} className="flex items-center justify-between bg-[#F8F9FA] rounded-2xl px-4 py-3 border border-gray-100">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="material-symbols-outlined text-[#FFD23F] text-base">location_on</span>
                    <span className="text-xs text-[#1A1C1E] font-semibold truncate">{addr}</span>
                  </div>
                  <button
                    onClick={() => {
                      const newList = itsMeProfile.addresses.filter((_, idx) => idx !== i);
                      updateItsMeProfileAndSync({ ...itsMeProfile, addresses: newList });
                    }}
                    className="ml-2 text-gray-300 hover:text-rose-400 cursor-pointer shrink-0 transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  autoComplete="street-address"
                  value={itsMeAddressInput}
                  onChange={e => setItsMeAddressInput(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-[#F8F9FA] border border-gray-200 focus:border-gray-400 focus:outline-none text-[#1A1C1E] rounded-xl text-sm font-semibold"
                  placeholder="Add new address…"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && itsMeAddressInput.trim()) {
                      const newList = [...itsMeProfile.addresses, itsMeAddressInput.trim()];
                      updateItsMeProfileAndSync({ ...itsMeProfile, addresses: newList });
                      setItsMeAddressInput('');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (!itsMeAddressInput.trim()) return;
                    const newList = [...itsMeProfile.addresses, itsMeAddressInput.trim()];
                    updateItsMeProfileAndSync({ ...itsMeProfile, addresses: newList });
                    setItsMeAddressInput('');
                  }}
                  className="px-4 py-2.5 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-xl text-xs cursor-pointer hover:bg-black active:scale-95 transition"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Landmarks */}
            <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-4">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Saved Landmarks</h3>
              {itsMeProfile.landmarks.map((lm, i) => (
                <div key={i} className="flex items-center justify-between bg-[#F8F9FA] rounded-2xl px-4 py-3 border border-gray-100">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="material-symbols-outlined text-[#FFD23F] text-base">place</span>
                    <span className="text-xs text-[#1A1C1E] font-semibold truncate">{lm}</span>
                  </div>
                  <button
                    onClick={() => {
                      const newList = itsMeProfile.landmarks.filter((_, idx) => idx !== i);
                      updateItsMeProfileAndSync({ ...itsMeProfile, landmarks: newList });
                    }}
                    className="ml-2 text-gray-300 hover:text-rose-400 cursor-pointer shrink-0"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={itsMeLandmarkInput}
                  onChange={e => setItsMeLandmarkInput(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-[#F8F9FA] border border-gray-200 focus:border-gray-400 focus:outline-none text-[#1A1C1E] rounded-xl text-sm font-semibold"
                  placeholder="e.g. Near GTBank, after bridge…"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && itsMeLandmarkInput.trim()) {
                      const newList = [...itsMeProfile.landmarks, itsMeLandmarkInput.trim()];
                      updateItsMeProfileAndSync({ ...itsMeProfile, landmarks: newList });
                      setItsMeLandmarkInput('');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (!itsMeLandmarkInput.trim()) return;
                    const newList = [...itsMeProfile.landmarks, itsMeLandmarkInput.trim()];
                    updateItsMeProfileAndSync({ ...itsMeProfile, landmarks: newList });
                    setItsMeLandmarkInput('');
                  }}
                  className="px-4 py-2.5 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-xl text-xs cursor-pointer hover:bg-black active:scale-95 transition"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Delivery Instructions */}
            <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Preferred Delivery Instructions</h3>
              <textarea
                value={itsMeEditInstructions}
                onChange={e => setItsMeEditInstructions(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 bg-[#F8F9FA] border border-gray-200 focus:border-gray-400 focus:outline-none text-[#1A1C1E] rounded-xl text-sm font-semibold resize-none"
                placeholder="e.g. Call me 5 minutes before arrival…"
              />
            </div>

            {/* Payment Preference */}
            <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Preferred Payment</h3>
              <div className="grid grid-cols-3 gap-2">
                {(['cash', 'transfer', 'opay'] as const).map(method => (
                  <button
                    key={method}
                    onClick={() => {
                      updateItsMeProfileAndSync({ ...itsMeProfile, preferredPayment: method });
                    }}
                    className={`py-3 rounded-2xl font-black text-xs capitalize transition-all cursor-pointer border ${itsMeProfile.preferredPayment === method ? 'bg-[#1A1C1E] text-[#FFD23F] border-[#1A1C1E] shadow-md' : 'bg-[#F8F9FA] text-gray-500 border-gray-100 hover:border-gray-300'}`}
                  >
                    {method === 'opay' ? 'OPay' : method === 'transfer' ? 'Transfer' : 'Cash'}
                  </button>
                ))}
              </div>
            </div>

            {/* Recent Orders */}
            {ordersHistory.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Recent Orders</h3>
                  <button onClick={() => { setShowItsMeScreen(false); navigateToScreen('history'); loadOrdersHistory(); }} className="text-[10px] font-black text-[#1A1C1E] cursor-pointer hover:text-gray-500">
                    View all →
                  </button>
                </div>
                {ordersHistory.slice(0, 3).map(o => (
                  <div key={o.id} className="flex items-center justify-between bg-[#F8F9FA] rounded-2xl px-4 py-3 border border-gray-100">
                    <div>
                      <p className="text-xs font-black text-[#1A1C1E]">#{o.order_number}</p>
                      <p className="text-[10px] text-gray-400 font-semibold">{new Date(o.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-[#1A1C1E]">₦{o.total?.toLocaleString()}</p>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${o.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : o.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{o.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Favorite Stores */}
            {(() => {
              const favStores = allStores.filter(s => localStorage.getItem('storeflow_fav_store_' + s.id) === 'true');
              if (favStores.length === 0) return null;
              return (
                <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-3">
                  <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Favourite Stores</h3>
                  {favStores.map(s => (
                    <div
                      key={s.id}
                      onClick={() => { setShowItsMeScreen(false); setStoreId(s.id); loadStoreDetails(s.id); navigateToScreen('store'); }}
                      className="flex items-center gap-3 bg-[#F8F9FA] rounded-2xl px-4 py-3 border border-gray-100 cursor-pointer hover:border-gray-200 transition"
                    >
                      <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                        {isLogoImageUrl(s.logo) ? <img src={s.logo} className="w-full h-full object-cover" alt="" /> : <span className="text-lg">🏪</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-[#1A1C1E] truncate">{s.business_name}</p>
                        <p className="text-[10px] text-gray-400 font-semibold truncate">{s.address || 'Partner Store'}</p>
                      </div>
                      <span className="material-symbols-outlined text-gray-300 text-base">chevron_right</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Identity Metadata */}
            <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Identity Details</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center py-2 border-b border-gray-50">
                  <span className="text-xs text-gray-400 font-semibold">Customer ID</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-[#1A1C1E] font-bold">···{itsMeProfile.customerId.slice(-8)}</span>
                    <button onClick={() => { navigator.clipboard.writeText(itsMeProfile.customerId); }} className="p-1 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer active:scale-95 transition">
                      <span className="material-symbols-outlined text-xs text-gray-500">content_copy</span>
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-50">
                  <span className="text-xs text-gray-400 font-semibold">Date Joined</span>
                  <span className="text-xs font-bold text-[#1A1C1E]">{new Date(itsMeProfile.dateJoined).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-xs text-gray-400 font-semibold">Last Updated</span>
                  <span className="text-xs font-bold text-[#1A1C1E]">{new Date(itsMeProfile.lastUpdated).toLocaleDateString()}</span>
                </div>
              </div>
              {!currentUser && (
                <div className="p-3.5 bg-amber-50 border border-amber-100 rounded-2xl text-[10px] text-amber-900 leading-relaxed font-semibold">
                  💡 <strong>Tip:</strong> Sign in to sync your It'sMe profile across all your devices.
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ─── It'sMe Post-Order Update Prompt ─── */}
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

      {/* QR Scanner Modal */}
      {showScanner && renderScanner()}

      {/* ─── Global Bottom Navigation ─── */}
      {['home', 'explore', 'store', 'tracking', 'profile', 'history'].includes(screen) && !isCartOpen && (
        <nav className="fixed bottom-0 left-0 right-0 w-full max-w-screen-xl mx-auto z-40 flex justify-around items-center px-4 py-3 bg-white shadow-[0px_-4px_20px_rgba(0,0,0,0.05)] rounded-t-2xl border-t border-gray-100 text-[#1A1C1E]">
          <button onClick={() => navigateToScreen('home')} className={`flex flex-col items-center justify-center cursor-pointer ${screen === 'home' ? 'text-[#1A1C1E] relative after:content-[\'\'] after:absolute after:-bottom-1 after:w-1 after:h-1 after:bg-[#FFD23F] after:rounded-full' : 'text-gray-400 font-semibold hover:text-[#1A1C1E]'}`}>
            <span className="material-symbols-outlined text-xl">home</span>
            <span className={`text-[10px] mt-1 ${screen === 'home' ? 'font-bold' : 'font-semibold'}`}>Home</span>
          </button>
          <button onClick={() => { setSearchQuery(''); navigateToScreen('explore'); }} className={`flex flex-col items-center justify-center cursor-pointer ${screen === 'explore' ? 'text-[#1A1C1E] relative after:content-[\'\'] after:absolute after:-bottom-1 after:w-1 after:h-1 after:bg-[#FFD23F] after:rounded-full' : 'text-gray-400 font-semibold hover:text-[#1A1C1E]'}`}>
            <span className="material-symbols-outlined text-xl">grid_view</span>
            <span className={`text-[10px] mt-1 ${screen === 'explore' ? 'font-bold' : 'font-semibold'}`}>Explore</span>
          </button>
          <button onClick={() => { navigateToScreen('history'); loadOrdersHistory(); }} className={`flex flex-col items-center justify-center cursor-pointer relative ${screen === 'history' ? 'text-[#1A1C1E] relative after:content-[\'\'] after:absolute after:-bottom-1 after:w-1 after:h-1 after:bg-[#FFD23F] after:rounded-full' : 'text-gray-400 font-semibold hover:text-[#1A1C1E]'}`}>
            <span className="material-symbols-outlined text-xl">receipt_long</span>
            <span className={`text-[10px] mt-1 ${screen === 'history' ? 'font-bold' : 'font-semibold'}`}>Orders</span>
            {activeOrdersCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-[#1A1C1E] text-[#FFD23F] text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-black shadow-sm">{activeOrdersCount}</span>
            )}
          </button>
          <button onClick={() => setIsCartOpen(true)} className="flex flex-col items-center justify-center text-gray-400 font-semibold hover:text-[#1A1C1E] relative cursor-pointer">
            <span className="material-symbols-outlined text-xl text-gray-400">shopping_cart</span>
            <span className="text-[10px] font-semibold mt-1">Cart</span>
            {totalItemsCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-[#1A1C1E] text-[#FFD23F] text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-black shadow-sm">{totalItemsCount}</span>
            )}
          </button>
        </nav>
      )}
    </div>
    </div>
  );
}

export default App;
