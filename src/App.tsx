import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import jsQR from 'jsqr';
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
}

const STATUS_ORDER = ['Pending', 'Preparing', 'Ready', 'Completed'];
const isStatusAtLeast = (current: string, target: string) =>
  STATUS_ORDER.indexOf(current) >= STATUS_ORDER.indexOf(target);

function App() {
  // Navigation & State Management
  const [screen, setScreen] = useState<'splash' | 'onboarding' | 'login' | 'location' | 'home' | 'store' | 'tracking' | 'profile' | 'history' | 'store_not_found'>(() => {
    const { storeId } = parseRoute();
    if (storeId) return 'store';
    return 'splash';
  });
  const [_storeId, setStoreId] = useState<string | null>(null);
  const [store, setStore] = useState<any>(null);
  const [allStores, setAllStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [deepLinkedProductId, setDeepLinkedProductId] = useState<string | null>(null);

  // Dynamic Pricing Configuration
  const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail');

  const isStoreOpenState = useMemo(() => {
    if (store?.status === 'inactive') return false;
    if (!store?.data || !store.data.marketplaceSettings) {
      return store?.status === 'active';
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

  // Cart & Modal
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Onboarding first launch detection
  const [isOnboarded, setIsOnboarded] = useState(() => localStorage.getItem('storeflow_onboarded') === 'true');

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

  const isCheckoutFormValid = useMemo(() => {
    const ms = store?.data?.marketplaceSettings;
    if (!ms) {
      return !!customerName && !!customerPhone && (deliveryType !== 'delivery' || !!deliveryAddress);
    }
    
    if (ms.reqCustomerName !== false && !customerName.trim()) return false;
    if (ms.reqCustomerPhone !== false) {
      const norm = normalizeNigerianPhone(customerPhone);
      if (!norm) return false;
    }
    if (ms.reqCustomerEmail === true && !customerEmail.trim()) return false;
    if (deliveryType === 'delivery') {
      if (ms.reqCustomerAddress !== false && !deliveryAddress.trim()) return false;
      if (ms.reqCustomerLandmark === true && !deliveryLandmark.trim()) return false;
    }
    if (ms.reqCustomerNotes === true && !specialInstructions.trim()) return false;
    
    return true;
  }, [store, customerName, customerPhone, customerEmail, deliveryAddress, deliveryLandmark, specialInstructions, deliveryType, normalizeNigerianPhone]);

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

  // Quick Order Modal
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [quickOrderInput, setQuickOrderInput] = useState('');

  // User Profile
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('storeflow_dark_mode') === 'true');

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

  // ─── Splash Screen Load Timer ──────────────────────────────────────────────

  useEffect(() => {
    if (screen === 'splash') {
      const timer = setTimeout(() => {
        if (!isOnboarded) {
          setScreen('onboarding');
        } else {
          setScreen('home');
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [screen, isOnboarded]);

  const checkSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      setCurrentUser(session.user);
      setProfileName(session.user.user_metadata?.full_name || '');
      setProfileEmail(session.user.email || '');
      setProfilePhone(session.user.phone || '');
      setCustomerName(session.user.user_metadata?.full_name || '');
      setCustomerPhone(session.user.phone || '');
    }
    loadStoresData();
  };

  // ─── Fetch Stores & Dynamic Products ────────────────────────────────────────

  const loadStoresData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('stores').select('*');
      if (error) throw error;
      if (data) {
        setAllStores(data);
        localStorage.setItem('storeflow_cached_all_stores', JSON.stringify(data));
      }
    } catch (e) {
      console.warn('Supabase loading error, running offline fallback:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadStoreDetails = async (sid: string) => {
    console.log(`[StoreFlow QR] Store ID received from URL/QR: "${sid}"`);
    setLoading(true);
    setErrorText(null);
    try {
      console.log(`[StoreFlow QR] Executing database query for store ID: "${sid}"...`);
      
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sid);
      let query = supabase.from('stores').select('*');
      if (isUuid) {
        query = query.or(`id.eq.${sid},store_id.eq.${sid},access_code.eq.${sid}`);
      } else {
        query = query.or(`store_id.eq.${sid},access_code.eq.${sid}`);
      }
      
      const { data: storeData, error: storeErr } = await query.maybeSingle();

      if (storeErr) {
        console.error(`[StoreFlow QR] Database query error for store ID: "${sid}":`, storeErr);
        throw storeErr;
      }

      console.log(`[StoreFlow QR] Query result for store:`, storeData);

      if (storeData) {
        setStore(storeData);
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

        // Dynamically compute categories list
        let cats = ['All'];
        const uniq = Array.from(new Set(prods.map(p => p.category).filter((c): c is string => !!c)));
        cats = ['All', ...uniq];
        setCategories(cats);
        localStorage.setItem('storeflow_cached_categories', JSON.stringify(cats));
      } else {
        console.warn(`[StoreFlow QR] Store ID: "${sid}" not found in database.`);
        setScreen('store_not_found');
      }
    } catch (err: any) {
      console.error(`[StoreFlow QR] Critical error loading store detail for ID: "${sid}":`, {
        message: err?.message,
        stack: err?.stack,
        details: err?.details,
        hint: err?.hint,
        code: err?.code,
        raw: err
      });
      setErrorText('Offline Mode: Displaying offline catalog.');
      // Attempt local storage fallback if we have a match
      const matched = allStores.find(s => s.id === sid);
      if (matched) {
        console.log(`[StoreFlow QR] Found matched store in offline cache:`, matched);
        setStore(matched);
        setProducts([]);
      } else {
        setScreen('store_not_found');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadOrdersHistory = async () => {
    if (!currentUser) return;
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_phone', currentUser.phone || customerPhone)
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

    const timer = setInterval(() => {
      setOrderStatus(cur => {
        if (cur === 'Pending') return 'Preparing';
        if (cur === 'Preparing') return 'Ready';
        if (cur === 'Ready') return 'Completed';
        return cur;
      });
    }, 20000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
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
    const handleRouting = () => {
      const { storeId: sid, productId: pid } = parseRoute();
      if (sid) {
        setStoreId(sid);
        loadStoreDetails(sid);
        setScreen('store');
        if (pid) {
          setDeepLinkedProductId(pid);
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

  const stopScanner = useCallback(() => {
    if (scanFrameRef.current) cancelAnimationFrame(scanFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setShowScanner(false);
    setScanError(null);
    setScanSuccess(false);
  }, []);

  const startScanner = useCallback(async () => {
    setScanError(null);
    setScanSuccess(false);
    setShowScanner(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch {
      setScanError('Camera access denied. Please grant permissions.');
    }
  }, []);

  const handleVideoReady = useCallback(() => {
    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        scanFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
      
      if (code?.data) {
        const { storeId: scannedStore, productId: scannedProduct } = parseQRCode(code.data);
        if (scannedStore) {
          setScanSuccess(true);
          setTimeout(() => {
            stopScanner();
            setStoreId(scannedStore);
            loadStoreDetails(scannedStore);
            setScreen('store');
            if (scannedProduct) {
              const matched = products.find(p => p.id === scannedProduct);
              if (matched) setSelectedProduct(matched);
            }
          }, 700);
          return;
        }
      }
      scanFrameRef.current = requestAnimationFrame(tick);
    };
    scanFrameRef.current = requestAnimationFrame(tick);
  }, [products, stopScanner]);

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
          setScreen('home');
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
          setScreen('home');
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
    setScreen('home');
  };

  // ─── Location & Address Selector ───────────────────────────────────────────

  const selectAddressAndSave = (addr: string) => {
    setSelectedAddress(addr);
    localStorage.setItem('storeflow_address', addr);
    setScreen('home');
  };

  const addNewAddress = () => {
    if (!newAddressInput.trim()) return;
    const list = [newAddressInput, ...savedAddresses];
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
        const { data: newOrder, error: orderErr } = await supabase
          .from('orders')
          .insert(orderPayload)
          .select().single();

        if (orderErr) throw orderErr;
        const oid = newOrder?.id || Date.now().toString();

        await supabase.from('order_items').insert(
          cart.map(item => ({
            order_id: oid,
            product_id: item.product.id,
            quantity: item.quantity,
            price: getPrice(item.product),
            subtotal: getPrice(item.product) * item.quantity
          }))
        );

        setOrderId(oid);
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
      setScreen('tracking');
      loadOrdersHistory();
    } catch (e: any) {
      alert('Order placement failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyOrderNumber = () => {
    navigator.clipboard.writeText(orderNumber).then(() => {
      setOrderCopied(true);
      setTimeout(() => setOrderCopied(false), 2000);
    });
  };

  function renderScanner() {
    return (
      <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center">
        <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between z-10">
          <div>
            <div className="text-white font-extrabold text-xl">Scan QR Code</div>
            <div className="text-white/50 text-xs mt-1">Point at a store or product QR code</div>
          </div>
          <button onClick={stopScanner} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white cursor-pointer hover:bg-white/20">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="relative w-72 h-72">
          {/* Corner brackets */}
          {([
            { top: 0, left: 0 },
            { top: 0, right: 0 },
            { bottom: 0, left: 0 },
            { bottom: 0, right: 0 }
          ] as any[]).map((pos, i) => (
            <div key={i} style={{
              position: 'absolute', width: '28px', height: '28px',
              borderColor: scanSuccess ? '#22c55e' : '#fff',
              borderStyle: 'solid', borderWidth: 0,
              ...(pos.top === 0 ? { borderTopWidth: '3px' } : { borderBottomWidth: '3px' }),
              ...(pos.left === 0 ? { borderLeftWidth: '3px' } : { borderRightWidth: '3px' }),
              borderRadius: pos.top === 0 && pos.left === 0 ? '4px 0 0 0' : pos.top === 0 ? '0 4px 0 0' : pos.left === 0 ? '0 0 0 4px' : '0 0 4px 0',
              transition: 'border-color 0.3s ease', ...pos,
            }} />
          ))}

          <video ref={videoRef} onCanPlay={handleVideoReady} playsInline muted
            className="w-full h-full object-cover rounded-2xl transition-opacity duration-300"
            style={{ opacity: scanSuccess ? 0.4 : 1 }}
          />
          <canvas ref={canvasRef} className="hidden" />

          {scanSuccess && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
                <span className="material-symbols-outlined text-white text-3xl font-bold">check</span>
              </div>
              <span className="text-green-500 font-bold text-sm">QR Code Detected!</span>
            </div>
          )}

          {!scanSuccess && !scanError && (
            <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-white to-transparent animate-scan-line" />
          )}
        </div>

        {scanError && (
          <div className="mt-6 mx-6 p-4 bg-red-500/15 border border-red-500/30 rounded-2xl flex items-start gap-3 max-w-xs">
            <span className="material-symbols-outlined text-red-500 text-lg shrink-0 mt-0.5">warning</span>
            <span className="text-red-300 text-xs leading-relaxed">{scanError}</span>
          </div>
        )}

        {!scanError && !scanSuccess && (
          <p className="text-white/40 text-xs mt-6 text-center px-8">
            Scanning automatically · Support local stores and partners
          </p>
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

  // ─── Search Filtering logic ────────────────────────────────────────────────

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.brand?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
        (p.category?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
      const matchCat = selectedCategory === 'All' || p.category === selectedCategory;
      return matchSearch && matchCat;
    });
  }, [products, searchQuery, selectedCategory]);

  const searchedStores = useMemo(() => {
    if (!searchQuery) return allStores;
    return allStores.filter(s =>
      s.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.address?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
    );
  }, [allStores, searchQuery]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-surface-container-high border-t-primary rounded-full animate-spin"></div>
        <p className="text-secondary text-sm font-semibold">Loading StoreFlow...</p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-zinc-950 text-zinc-100' : 'bg-surface text-on-surface'}`}>
      
      {/* Offline Status Banner */}
      {!isOnline && (
        <div className="bg-red-500 text-white text-xs py-2 px-4 text-center sticky top-0 z-[100] font-bold">
          ⚠️ You are offline. Showing cached catalog data. Sync when online.
        </div>
      )}

      {/* ─── 1. Splash Screen ─── */}
      {screen === 'splash' && (
        <main className="bg-on-background text-surface min-h-screen flex flex-col justify-between items-center py-20 px-10">
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="mb-6 flex items-center justify-center w-24 h-24 bg-surface rounded-[28%] rotate-12 shadow-xl animate-bounce overflow-hidden">
              <img src="/logo.jpg" className="w-full h-full object-cover -rotate-12 scale-110" alt="StoreFlow" />
            </div>
            <h1 className="text-3xl font-extrabold text-surface tracking-tight font-headline-xl">
              StoreFlow
            </h1>
            <p className="mt-3 text-sm text-surface-variant max-w-[200px] leading-relaxed font-body-lg">
              Everything you need, delivered fast.
            </p>
          </div>
          <div className="w-full max-w-[140px] h-1 bg-surface-variant/20 rounded-full overflow-hidden">
            <div className="h-full bg-primary-container w-2/3 animate-pulse rounded-full"></div>
          </div>
        </main>
      )}

      {/* ─── 2. Onboarding Screen ─── */}
      {screen === 'onboarding' && (
        <div className="min-h-screen flex flex-col justify-between p-6 max-w-md mx-auto">
          <div className="flex justify-end pt-4">
            <button onClick={() => { localStorage.setItem('storeflow_onboarded', 'true'); setIsOnboarded(true); setScreen('home'); }} className="text-sm font-bold text-secondary cursor-pointer">Skip</button>
          </div>
          <main className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl font-extrabold text-on-background font-headline-xl">Welcome to StoreFlow</h1>
              <p className="text-sm text-secondary max-w-xs mx-auto leading-relaxed">
                Connect to nearby stores, select products, and check out in under a minute.
              </p>
            </div>
            <div className="relative w-72 h-72 bg-surface-container rounded-[40px] shadow-sm overflow-hidden flex items-center justify-center p-6">
              <img className="w-full h-full object-cover rounded-3xl" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDqOVy4Qz9h-3rrA4QjtMif0NFdiQx8MP6W-YhT_kpIfRfOGfci_B4Xc9XLeWSafM-YqlExuIeOPtgv4axxkmJPWtOydIXtAo86zx5AnnoGPt0yViyi2oCJAS4daz9Mh07eaV4aJPzZz7WZnjp_7l5oDmOSOJstc_mvowOIXnl5L-vSjdmi1GbTe36GnOgDJZDBewq7CAYcn2Y9bJlUnFmSrNbwRXfmqYHrhMyJIfbPz8kHRI6SS8t1eg" alt="" />
            </div>
            <div className="flex justify-center space-x-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-surface-container-highest"></div>
              <div className="h-1.5 w-6 rounded-full bg-primary"></div>
              <div className="h-1.5 w-1.5 rounded-full bg-surface-container-highest"></div>
            </div>
          </main>
          <footer className="space-y-4 pb-8">
            <button onClick={() => { localStorage.setItem('storeflow_onboarded', 'true'); setIsOnboarded(true); setScreen('login'); }} className="w-full h-14 bg-on-background text-surface font-bold rounded-xl active-scale cursor-pointer">
              Get Started
            </button>
            <button onClick={() => { localStorage.setItem('storeflow_onboarded', 'true'); setIsOnboarded(true); setScreen('home'); }} className="w-full h-14 border border-outline-variant text-on-background font-bold rounded-xl active-scale cursor-pointer">
              Explore as Guest
            </button>
          </footer>
        </div>
      )}

      {/* ─── 3. Login / Signup Screen ─── */}
      {screen === 'login' && (
        <div className="min-h-screen p-6 flex flex-col justify-between max-w-md mx-auto relative z-10">
          <header className="h-14 flex items-center">
            <button onClick={() => setScreen('home')} className="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center cursor-pointer active-scale">
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
          </header>

          <main className="flex-1 flex flex-col justify-center space-y-6 pt-12">
            <div className="text-center md:text-left">
              <h1 className="text-3xl font-extrabold text-on-background font-headline-xl">
                {authMode === 'login' ? 'Welcome back 👋' : 'Create Account 🚀'}
              </h1>
              <p className="text-sm text-secondary mt-1">
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
                  <label className="text-xs font-bold text-secondary uppercase px-1">Full Name</label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={e => setProfileName(e.target.value)}
                    className="w-full px-4 h-12 bg-surface-container-low text-on-surface rounded-xl border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary text-sm font-semibold"
                    placeholder="Enter full name"
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-secondary uppercase px-1">Email Address</label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={e => setAuthEmail(e.target.value)}
                  className="w-full px-4 h-12 bg-surface-container-low text-on-surface rounded-xl border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary text-sm font-semibold"
                  placeholder="name@example.com"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-secondary uppercase px-1">Password</label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  className="w-full px-4 h-12 bg-surface-container-low text-on-surface rounded-xl border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary text-sm font-semibold"
                  placeholder="••••••••••••"
                />
              </div>

              <button onClick={handleEmailAuth} className="w-full h-14 bg-on-background text-surface font-bold rounded-xl active-scale cursor-pointer">
                {authMode === 'login' ? 'Log In' : 'Sign Up'}
              </button>
            </form>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-[1px] bg-outline-variant/20" />
              <span className="text-xs text-secondary font-semibold">or phone OTP</span>
              <div className="flex-1 h-[1px] bg-outline-variant/20" />
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-secondary uppercase px-1">Phone Number</label>
                <input
                  type="tel"
                  value={authPhone}
                  onChange={e => setAuthPhone(e.target.value)}
                  className="w-full px-4 h-12 bg-surface-container-low text-on-surface rounded-xl border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary text-sm font-semibold"
                  placeholder="+2348012345678"
                />
              </div>

              {showOTPField && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-secondary uppercase px-1">6-digit OTP Code</label>
                  <input
                    type="text"
                    value={authOTP}
                    onChange={e => setAuthOTP(e.target.value)}
                    className="w-full px-4 h-12 bg-surface-container-low text-on-surface rounded-xl border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary text-sm font-semibold text-center tracking-widest"
                    placeholder="000000"
                  />
                </div>
              )}

              <button onClick={handlePhoneOTPAuth} className="w-full h-12 bg-primary text-on-primary font-bold rounded-xl active-scale cursor-pointer flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-lg">sms</span>
                {showOTPField ? 'Verify OTP' : 'Send Phone OTP'}
              </button>
            </div>
          </main>

          <footer className="py-6 text-center">
            <button onClick={() => setAuthMode(m => m === 'login' ? 'signup' : 'login')} className="text-sm font-bold text-on-background cursor-pointer hover:underline">
              {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
            </button>
          </footer>
        </div>
      )}

      {/* ─── 4. Location Selector Screen ─── */}
      {screen === 'location' && (
        <div className="min-h-screen p-6 max-w-md mx-auto flex flex-col justify-between">
          <header className="flex items-center gap-3 mb-6">
            <button onClick={() => setScreen('home')} className="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center cursor-pointer active-scale">
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <h1 className="text-lg font-bold">Select Delivery Location</h1>
          </header>

          <main className="flex-1 space-y-6">
            <div className="flex gap-2">
              <input
                type="text"
                value={newAddressInput}
                onChange={e => setNewAddressInput(e.target.value)}
                className="flex-1 px-4 h-12 bg-surface-container-low text-on-surface rounded-xl border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary text-sm font-semibold"
                placeholder="Search or enter address"
              />
              <button onClick={addNewAddress} className="w-12 h-12 bg-primary text-on-primary rounded-xl flex items-center justify-center cursor-pointer active-scale shadow-sm">
                <span className="material-symbols-outlined text-xl">add</span>
              </button>
            </div>

            <button onClick={requestGPSLocation} className="w-full py-4 border border-outline-variant/30 rounded-xl flex items-center justify-center gap-2 font-bold cursor-pointer active-scale text-on-surface">
              <span className="material-symbols-outlined text-primary text-lg">my_location</span>
              <span>Use Current Location (GPS)</span>
            </button>

            <div className="space-y-3">
              <h3 className="text-xs font-bold text-secondary uppercase px-1">Saved Addresses</h3>
              <div className="space-y-2">
                {savedAddresses.map(addr => (
                  <button
                    key={addr}
                    onClick={() => selectAddressAndSave(addr)}
                    className="w-full p-4 bg-surface-container-low hover:bg-surface-container-high rounded-xl text-left font-semibold text-sm flex items-center justify-between cursor-pointer border border-outline-variant/10 active-scale"
                  >
                    <span>{addr}</span>
                    <span className="material-symbols-outlined text-secondary text-lg">chevron_right</span>
                  </button>
                ))}
              </div>
            </div>
          </main>
        </div>
      )}

      {/* ─── 5. Home / Discover Screen ─── */}
      {screen === 'home' && (
        <div className="max-w-[1200px] mx-auto pb-24">
          <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md h-16 flex justify-between items-center border-b border-outline-variant/10 px-4 md:px-gutter text-on-surface">
            <div className="flex items-center gap-3">
              <button onClick={() => setScreen('profile')} className="w-10 h-10 flex items-center justify-center hover:bg-surface-container-low transition-colors rounded-full cursor-pointer">
                <span className="material-symbols-outlined text-primary text-xl">menu</span>
              </button>
              <div onClick={() => setScreen('location')} className="flex flex-col cursor-pointer hover:opacity-85 select-none">
                <span className="text-[10px] font-bold text-secondary uppercase">Deliver to</span>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-extrabold text-on-surface">{selectedAddress}</span>
                  <span className="material-symbols-outlined text-secondary text-base">expand_more</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={startScanner} className="w-10 h-10 flex items-center justify-center hover:bg-surface-container-low transition-colors rounded-full cursor-pointer">
                <span className="material-symbols-outlined text-primary text-xl">qr_code_scanner</span>
              </button>
            </div>
          </header>

          <main className="px-4 md:px-gutter mt-4 space-y-8">
            {/* Search Bar */}
            <div className="relative w-full h-14 bg-surface-container-low rounded-full flex items-center px-4 border border-outline-variant/10 focus-within:ring-2 focus-within:ring-primary/20">
              <span className="material-symbols-outlined text-secondary mr-3">search</span>
              <input
                className="bg-transparent border-none focus:ring-0 w-full text-base placeholder:text-secondary-fixed-dim outline-none text-on-surface"
                placeholder="Search stores, products, brands..."
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="mr-2 cursor-pointer">
                  <span className="material-symbols-outlined text-secondary text-lg">close</span>
                </button>
              )}
              <span className="material-symbols-outlined text-secondary ml-2 cursor-pointer" onClick={() => setShowQuickOrder(true)}>tune</span>
            </div>

            {deferredPrompt && (
              <div className="bg-primary-container text-on-primary-container p-4 rounded-2xl flex items-center justify-between border border-primary/20">
                <div>
                  <h4 className="font-extrabold text-sm">Install StoreFlow App</h4>
                  <p className="text-xs text-secondary mt-0.5 font-semibold">Access offline shopping directly from your home screen.</p>
                </div>
                <button onClick={triggerInstall} className="px-4 py-2 bg-on-background text-surface text-xs font-bold rounded-xl cursor-pointer">
                  Install
                </button>
              </div>
            )}

            {/* Banner Carousel */}
            <section className="relative w-full aspect-[21/9] rounded-2xl overflow-hidden shadow-sm bg-primary-container text-on-primary-container p-6 flex flex-col justify-between">
              <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent z-10" />
              <img className="absolute inset-0 w-full h-full object-cover" src="https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1200&q=80" alt="" />
              <div className="relative z-20 space-y-1.5 max-w-xs text-white">
                <span className="bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded">Promo</span>
                <h2 className="text-xl font-extrabold">Nigeria Grocery Deals</h2>
                <p className="text-xs text-white/80">Get free delivery and up to 25% off FreshMart orders today.</p>
              </div>
            </section>

            {/* Categories */}
            <section>
              <h3 className="text-sm font-bold text-secondary uppercase px-1 mb-3">Browse Categories</h3>
              <div className="flex gap-2 overflow-x-auto hide-scrollbar">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-5 py-2.5 rounded-full font-bold text-xs shrink-0 transition-all cursor-pointer ${
                      selectedCategory === cat ? 'bg-on-background text-surface' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </section>

            {/* Stores List */}
            <section>
              <h2 className="text-xl font-extrabold text-on-background mb-4 font-headline-md">Partner Stores</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {searchedStores.map(s => (
                  <div
                    key={s.id}
                    onClick={() => {
                      setStoreId(s.id);
                      loadStoreDetails(s.id);
                      setScreen('store');
                    }}
                    className="p-4 bg-surface-container-low border border-outline-variant/10 hover:border-outline-variant/40 rounded-2xl flex gap-4 cursor-pointer active-scale transition-all"
                  >
                    <div className="w-16 h-16 bg-surface rounded-xl overflow-hidden shrink-0 flex items-center justify-center shadow-sm">
                      {s.logo ? (
                        <img className="w-full h-full object-cover" src={s.logo} alt="" />
                      ) : (
                        <span className="text-3xl">🏪</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-extrabold text-base text-on-surface truncate">{s.business_name}</h4>
                      <p className="text-xs text-secondary mt-0.5 truncate">{s.address || 'GRA Phase II, Ikeja'}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {s.status === 'active' ? 'Open' : 'Closed'}
                        </span>
                        <span className="text-[10px] font-semibold text-secondary">• 15-20 min</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Dynamic Recommended Products */}
            <section>
              <h2 className="text-xl font-extrabold text-on-background mb-4 font-headline-md">Recommended For You</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredProducts.slice(0, 4).map(p => (
                  <div
                    key={p.id}
                    onClick={() => {
                      setStoreId(p.store_id);
                      loadStoreDetails(p.store_id);
                      setSelectedProduct(p);
                      setScreen('store');
                    }}
                    className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-3 cursor-pointer hover:shadow-md transition-all flex flex-col justify-between active-scale"
                  >
                    <div className="relative w-full aspect-square bg-surface rounded-xl mb-3 overflow-hidden flex items-center justify-center">
                      {p.image ? (
                        <img src={p.image} className="w-full h-full object-contain p-2" alt="" />
                      ) : (
                        <span className="text-2xl">📦</span>
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="font-bold text-sm text-on-surface truncate">{p.name}</p>
                      <p className="font-extrabold text-base text-on-background">₦{getPrice(p).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </main>

          {/* ⚡ Quick Order FAB */}
          <div className="fixed bottom-24 right-4 z-40">
            <button
              onClick={() => setShowQuickOrder(true)}
              className="w-14 h-14 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-lg cursor-pointer hover:scale-105 active:scale-95 transition-transform"
              title="Quick Order"
            >
              <span className="material-symbols-outlined text-2xl font-bold">bolt</span>
            </button>
          </div>

        </div>
      )}

      {/* ─── 6. Store Details Page ─── */}
      {screen === 'store' && (
        <div className="bg-[#1A1C1E] min-h-screen text-white pb-32">
          {/* Header Banner Background */}
          <div className="relative w-full bg-[#1A1C1E] pb-8 pt-6 rounded-b-[32px] shadow-lg border-b border-white/5">
            <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-transparent pointer-events-none" />
            
            {/* Top Navigation Row */}
            <header className="flex justify-between items-center w-full px-4 h-12 relative z-20">
              <button 
                onClick={() => setScreen('home')} 
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white active:scale-90 transition-transform cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">arrow_back</span>
              </button>
              <div className="flex items-center gap-2">
                <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white active:scale-90 transition-transform cursor-pointer">
                  <span className="material-symbols-outlined text-lg">favorite</span>
                </button>
                <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white active:scale-90 transition-transform cursor-pointer">
                  <span className="material-symbols-outlined text-lg">share</span>
                </button>
              </div>
            </header>

            {/* Centered Store Branding */}
            <div className="flex flex-col items-center text-center mt-4 space-y-3 relative z-10 px-4">
              <div className="w-32 h-32 rounded-full border-4 border-white bg-[#1A1C1E] shadow-2xl overflow-hidden flex items-center justify-center shrink-0">
                {store?.logo ? (
                  <img src={store.logo} className="w-full h-full object-cover" alt="" />
                ) : (
                  <span className="text-5xl">🏪</span>
                )}
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl font-black tracking-tight text-white flex items-center justify-center gap-1.5 font-headline-xl">
                  {store?.business_name || 'StoreFlow Store'}
                  <span className="material-symbols-outlined text-[#FFD23F] text-xl font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                </h1>
                
                <div className="flex items-center justify-center gap-1 text-[#FFD23F] text-xs font-bold">
                  <span className="material-symbols-outlined text-sm font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                  <span>{(store?.data?.marketplaceSettings?.rating || 4.8).toFixed(1)} (320 reviews)</span>
                </div>
                
                <p className="text-xs text-slate-300 font-medium max-w-xs mx-auto">
                  {store?.data?.marketplaceSettings?.description || 'Your trusted neighborhood store.'}
                </p>
              </div>
            </div>

            {/* Store Status Badge */}
            <div className="flex justify-center mt-4 relative z-10">
              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                storeStatusText === 'Open' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                storeStatusText === 'Closing Soon' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  storeStatusText === 'Open' ? 'bg-emerald-400 animate-pulse' :
                  storeStatusText === 'Closing Soon' ? 'bg-amber-400' :
                  'bg-red-400'
                }`} />
                {storeStatusText}
              </span>
            </div>

            {/* Closed Alert Notice */}
            {storeStatusText === 'Closed' && (
              <div className="mt-4 mx-4 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs font-semibold text-center leading-relaxed max-w-md md:mx-auto">
                ⚠️ <strong>This store is currently closed.</strong><br/>
                Orders will be processed when the store opens.
              </div>
            )}

            {/* Premium Tab Selector Segments */}
            <div className="mt-6 flex p-1 rounded-2xl bg-[#26282B] border border-white/5 text-xs font-bold w-full max-w-[340px] mx-auto z-10 relative">
              {(['Overview', 'Products', 'Info'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setStoreTab(t)}
                  className={`flex-1 py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    storeTab === t 
                      ? 'bg-white text-[#1A1C1E] shadow-lg' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>{t}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Main Content Area */}
          <main className="mt-6 px-4 max-w-lg md:max-w-2xl mx-auto space-y-6">
            
            {/* OVERVIEW TAB */}
            {storeTab === 'Overview' && (
              <div className="space-y-6 animate-fade">
                {/* Dynamic Quick Info Tiles */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[#26282B] border border-white/5 rounded-2xl p-3 flex flex-col items-center text-center gap-1 shadow-sm">
                    <span className="material-symbols-outlined text-[#FFD23F] text-xl">schedule</span>
                    <span className="font-extrabold text-[11px] text-white mt-1">
                      {store?.data?.marketplaceSettings?.deliveryTime || (deliveryType === 'delivery' ? '30-45 min' : '15-20 min')}
                    </span>
                    <span className="text-[9px] text-slate-400 font-semibold leading-tight">Delivery Time</span>
                  </div>
                  <div className="bg-[#26282B] border border-white/5 rounded-2xl p-3 flex flex-col items-center text-center gap-1 shadow-sm">
                    <span className="material-symbols-outlined text-[#FFD23F] text-xl">delivery_dining</span>
                    <span className="font-extrabold text-[11px] text-white mt-1">
                      ₦{(store?.data?.marketplaceSettings?.deliveryFee || 1500).toLocaleString()}
                    </span>
                    <span className="text-[9px] text-slate-400 font-semibold leading-tight">Delivery Fee</span>
                  </div>
                  <div className="bg-[#26282B] border border-white/5 rounded-2xl p-3 flex flex-col items-center text-center gap-1 shadow-sm">
                    <span className="material-symbols-outlined text-[#FFD23F] text-xl">verified_user</span>
                    <span className="font-extrabold text-[11px] text-white mt-1">Verified</span>
                    <span className="text-[9px] text-slate-400 font-semibold leading-tight">Since 2024</span>
                  </div>
                </div>

                {/* Promotions section */}
                {((store?.data?.marketplaceSettings?.freeDeliveryThreshold || 5000) > 0) && (
                  <div className="bg-gradient-to-r from-[#FFD23F]/15 to-[#FFD23F]/5 border border-[#FFD23F]/20 p-4 rounded-2xl flex items-center gap-3.5 shadow-sm text-left">
                    <span className="text-3xl">🚚</span>
                    <div>
                      <h4 className="font-extrabold text-sm text-white">Free Delivery Offer</h4>
                      <p className="text-[10px] text-slate-300 mt-0.5">
                        Get free home delivery on orders above ₦{(store?.data?.marketplaceSettings?.freeDeliveryThreshold || 5000).toLocaleString()}
                      </p>
                    </div>
                  </div>
                )}

                {/* Quick Categories list */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs uppercase tracking-wider font-extrabold text-slate-400 px-1">Categories</h3>
                    <button onClick={() => setStoreTab('Products')} className="text-xs font-bold text-[#FFD23F] hover:underline cursor-pointer">View all</button>
                  </div>
                  <div className="flex gap-2.5 overflow-x-auto hide-scrollbar -mx-4 px-4">
                    {categories.map(cat => {
                      const iconMap = {
                        All: '🌾',
                        Beverages: '🥤',
                        Groceries: '🌾',
                        Snacks: '🍿',
                        Frozen: '❄️',
                        Household: '🧼',
                        Medicine: '💊',
                        Personal: '🧴',
                        Other: '📦'
                      };
                      return (
                        <button
                          key={cat}
                          onClick={() => {
                            setSelectedCategory(cat);
                            setStoreTab('Products');
                          }}
                          className="bg-[#26282B] border border-white/5 text-white whitespace-nowrap px-4 py-3 rounded-2xl font-bold text-xs shrink-0 flex items-center gap-2 cursor-pointer hover:bg-[#32353A] transition"
                        >
                          <span>{iconMap[cat] || '📦'}</span>
                          <span>{cat}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Popular Products section */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs uppercase tracking-wider font-extrabold text-slate-400 px-1">Popular Products</h3>
                    <button onClick={() => setStoreTab('Products')} className="text-xs font-bold text-[#FFD23F] hover:underline cursor-pointer">View all</button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {filteredProducts.slice(0, 4).map(p => {
                      const qtyInCart = getQty(p.id);
                      const isOutOfStock = p.quantity <= 0;

                      return (
                        <div
                          key={p.id}
                          onClick={() => setSelectedProduct(p)}
                          className="bg-[#26282B] border border-white/5 rounded-2xl p-3 flex flex-col justify-between shadow-sm relative group cursor-pointer hover:border-white/10 transition-all text-left"
                        >
                          <div>
                            {/* Tags row */}
                            <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
                              {p.wholesale_price && p.retail_price && p.wholesale_price < p.retail_price && (
                                <span className="bg-[#FFD23F] text-slate-950 font-black text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider">Promo</span>
                              )}
                            </div>

                            {/* Image wrapper */}
                            <div className="relative w-full aspect-square bg-white rounded-xl mb-3 overflow-hidden flex items-center justify-center">
                              {p.image ? (
                                <img src={p.image} className="w-full h-full object-contain p-2" alt="" />
                              ) : (
                                <span className="text-3xl">📦</span>
                              )}
                            </div>
                            
                            <div className="space-y-1">
                              <h4 className="font-extrabold text-sm text-white truncate">{p.name}</h4>
                              <p className="text-[10px] text-slate-400 truncate">{p.description || p.category || 'Product'}</p>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between">
                            <span className="font-black text-sm text-[#FFD23F]">₦{getPrice(p).toLocaleString()}</span>
                            {isOutOfStock ? (
                              <span className="text-[9px] font-black text-rose-500 uppercase">Sold Out</span>
                            ) : (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  addToCart(p, 1);
                                }}
                                className="w-8 h-8 bg-[#FFD23F] text-slate-950 rounded-full flex items-center justify-center active:scale-90 transition cursor-pointer"
                              >
                                <span className="material-symbols-outlined text-base font-bold">add</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* PRODUCTS TAB */}
            {storeTab === 'Products' && (
              <div className="space-y-6 animate-fade">
                
                {/* Retail vs Wholesale Control toggle */}
                {isRetailEnabled && isWholesaleEnabled && (
                  <div className="flex p-1 rounded-2xl bg-[#26282B] border border-white/5 text-xs font-bold w-full max-w-[280px] mx-auto">
                    <button
                      onClick={() => setPriceMode('retail')}
                      className={`flex-1 py-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        priceMode === 'retail' ? 'bg-white text-[#1A1C1E] shadow-md' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <span>Retail Pricing</span>
                    </button>
                    <button
                      onClick={() => setPriceMode('wholesale')}
                      className={`flex-1 py-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        priceMode === 'wholesale' ? 'bg-white text-[#1A1C1E] shadow-md' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <span>Wholesale Pricing</span>
                    </button>
                  </div>
                )}

                {/* Product Search Bar */}
                <div className="relative w-full h-12 bg-[#26282B] rounded-2xl flex items-center px-4 border border-white/5 focus-within:border-white/20 transition-all">
                  <span className="material-symbols-outlined text-slate-400 mr-2.5">search</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search products in this store..."
                    className="bg-transparent border-none text-xs focus:ring-0 focus:outline-none w-full text-white placeholder:text-slate-400"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="mr-2 cursor-pointer text-slate-400 hover:text-white">
                      <span className="material-symbols-outlined text-base">close</span>
                    </button>
                  )}
                  <span className="material-symbols-outlined text-slate-400 cursor-pointer ml-1 hover:text-white">mic</span>
                  <span className="material-symbols-outlined text-slate-400 cursor-pointer ml-2 hover:text-white">qr_code_scanner</span>
                </div>

                {/* Categories scrolling pills */}
                <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-4 py-2 rounded-full font-bold text-xs shrink-0 transition-all cursor-pointer ${
                        selectedCategory === cat
                          ? 'bg-[#FFD23F] text-slate-950 font-black'
                          : 'bg-[#26282B] border border-white/5 text-slate-300 hover:bg-[#32353A]'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* 2-Column Product Grid */}
                {filteredProducts.length === 0 ? (
                  <div className="bg-[#26282B] border border-white/5 rounded-2xl p-8 text-center text-xs text-slate-400">
                    No products found matching your search.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {filteredProducts.map(p => {
                      const qtyInCart = getQty(p.id);
                      const isOutOfStock = p.quantity <= 0;
                      const isLimited = p.quantity > 0 && p.quantity <= 5;
                      const isNew = p.status === 'new' || (p.cost_price === 0 && p.selling_price > 0);

                      return (
                        <div
                          key={p.id}
                          onClick={() => setSelectedProduct(p)}
                          className="bg-[#26282B] border border-white/5 rounded-2xl p-3 flex flex-col justify-between shadow-sm relative group cursor-pointer hover:border-white/10 transition-all text-left"
                        >
                          <div>
                            {/* Badges block */}
                            <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
                              {isOutOfStock && (
                                <span className="bg-rose-600 text-white font-black text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider">Out of Stock</span>
                              )}
                              {isLimited && (
                                <span className="bg-amber-600 text-white font-black text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider">Limited</span>
                              )}
                              {isNew && (
                                <span className="bg-[#FFD23F] text-slate-950 font-black text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider">New</span>
                              )}
                            </div>

                            {/* Favorite Heart Button */}
                            <button 
                              onClick={(e) => { e.stopPropagation(); alert('Added to favorites!'); }}
                              className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-[#1A1C1E]/60 backdrop-blur-md flex items-center justify-center text-slate-300 hover:text-rose-500 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-sm font-semibold">favorite</span>
                            </button>

                            {/* Product Image */}
                            <div className="relative w-full aspect-square bg-white rounded-xl mb-3 overflow-hidden flex items-center justify-center">
                              {p.image ? (
                                <img src={p.image} className="w-full h-full object-contain p-2" alt="" />
                              ) : (
                                <span className="text-3xl">📦</span>
                              )}
                            </div>

                            <div className="space-y-1">
                              <h4 className="font-extrabold text-sm text-white truncate">{p.name}</h4>
                              <p className="text-[10px] text-slate-400 truncate">{p.description || p.category || 'Product'}</p>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="font-black text-sm text-[#FFD23F]">₦{getPrice(p).toLocaleString()}</span>
                              <span className="text-[9px] text-slate-400 font-semibold">
                                {isOutOfStock ? 'Unavailable' : isLimited ? 'Limited Stock' : 'Available'}
                              </span>
                            </div>

                            {isOutOfStock ? (
                              <span className="text-[9px] font-black text-rose-500 uppercase">Sold Out</span>
                            ) : qtyInCart > 0 ? (
                              <div className="flex items-center gap-1 bg-[#FFD23F]/10 rounded-full px-1.5 py-1">
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    addToCart(p, -1);
                                  }}
                                  className="w-5 h-5 bg-[#FFD23F] text-slate-950 rounded-full flex items-center justify-center active:scale-90 transition cursor-pointer"
                                >
                                  <span className="material-symbols-outlined text-[10px] font-bold">remove</span>
                                </button>
                                <span className="text-xs font-black text-white px-1 font-mono">{qtyInCart}</span>
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    addToCart(p, 1);
                                  }}
                                  className="w-5 h-5 bg-[#FFD23F] text-slate-950 rounded-full flex items-center justify-center active:scale-90 transition cursor-pointer"
                                >
                                  <span className="material-symbols-outlined text-[10px] font-bold">add</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  addToCart(p, 1);
                                }}
                                className="w-8 h-8 bg-[#FFD23F] text-slate-950 rounded-full flex items-center justify-center active:scale-90 transition cursor-pointer"
                              >
                                <span className="material-symbols-outlined text-base font-bold">add</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* INFO TAB */}
            {storeTab === 'Info' && (
              <div className="space-y-6 animate-fade">
                {/* Store Information Card */}
                <div className="bg-[#26282B] border border-white/5 rounded-3xl p-5 shadow-lg space-y-4 text-left">
                  <h3 className="font-display font-black text-base text-white border-b border-white/5 pb-2">Store Details</h3>
                  
                  <div className="space-y-3.5 text-xs text-slate-300">
                    <div className="flex gap-3 items-start">
                      <span className="text-lg shrink-0">📍</span>
                      <div>
                        <p className="font-bold text-white uppercase text-[9px] tracking-wider text-slate-400">Full Address</p>
                        <p className="mt-0.5 leading-relaxed font-semibold">{store?.address || 'Warri, Delta State, Nigeria'}</p>
                      </div>
                    </div>

                    <div className="flex gap-3 items-start">
                      <span className="text-lg shrink-0">☎</span>
                      <div>
                        <p className="font-bold text-white uppercase text-[9px] tracking-wider text-slate-400">Phone Number</p>
                        <p className="mt-0.5 font-semibold">{store?.phone || '+234 801 234 5678'}</p>
                      </div>
                    </div>

                    <div className="flex gap-3 items-start">
                      <span className="text-lg shrink-0">✉</span>
                      <div>
                        <p className="font-bold text-white uppercase text-[9px] tracking-wider text-slate-400">Email Address</p>
                        <p className="mt-0.5 font-semibold">{store?.email || 'support@storeflow.com'}</p>
                      </div>
                    </div>

                    {store?.data?.marketplaceSettings?.website && (
                      <div className="flex gap-3 items-start">
                        <span className="text-lg shrink-0">🌍</span>
                        <div>
                          <p className="font-bold text-white uppercase text-[9px] tracking-wider text-slate-400">Website</p>
                          <p className="mt-0.5 font-semibold text-[#FFD23F] hover:underline cursor-pointer">{store.data.marketplaceSettings.website}</p>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3 items-start">
                      <span className="text-lg shrink-0">🕒</span>
                      <div>
                        <p className="font-bold text-white uppercase text-[9px] tracking-wider text-slate-400">Opening Hours</p>
                        <p className="mt-0.5 font-semibold text-emerald-400">
                          {store?.data?.marketplaceSettings?.openingTime || '08:00'} AM – {store?.data?.marketplaceSettings?.closingTime || '09:00'} PM
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3 items-start">
                      <span className="text-lg shrink-0">🚚</span>
                      <div>
                        <p className="font-bold text-white uppercase text-[9px] tracking-wider text-slate-400">Delivery Information</p>
                        <p className="mt-0.5 font-semibold">
                          Time: {store?.data?.marketplaceSettings?.deliveryTime || '30-45 mins'} | Fee: ₦{(store?.data?.marketplaceSettings?.deliveryFee || 1500).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3 items-start">
                      <span className="text-lg shrink-0">🏪</span>
                      <div>
                        <p className="font-bold text-white uppercase text-[9px] tracking-wider text-slate-400">Store Type</p>
                        <p className="mt-0.5 font-semibold capitalize">{store?.category || 'Retail Provision Store'}</p>
                      </div>
                    </div>

                    <div className="flex gap-3 items-start">
                      <span className="text-lg shrink-0">📦</span>
                      <div>
                        <p className="font-bold text-white uppercase text-[9px] tracking-wider text-slate-400">Catalog Size</p>
                        <p className="mt-0.5 font-semibold">{products.length} published products</p>
                      </div>
                    </div>

                    <div className="flex gap-3 items-start">
                      <span className="text-lg shrink-0">📍</span>
                      <div>
                        <p className="font-bold text-white uppercase text-[9px] tracking-wider text-slate-400">Distance</p>
                        <p className="mt-0.5 font-semibold text-slate-200">0.8 km away from your location</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick Action Buttons */}
                <div className="grid grid-cols-4 gap-2 text-[10px] font-bold text-center">
                  <a 
                    href={`tel:${store?.phone || '08012345678'}`}
                    className="bg-[#26282B] border border-white/5 py-3.5 rounded-2xl flex flex-col items-center gap-1.5 hover:bg-[#32353A] cursor-pointer text-white"
                  >
                    <span className="material-symbols-outlined text-lg text-[#FFD23F]">call</span>
                    <span>Call Store</span>
                  </a>
                  <a 
                    href={`https://wa.me/${(store?.phone || '2348012345678').replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-[#26282B] border border-white/5 py-3.5 rounded-2xl flex flex-col items-center gap-1.5 hover:bg-[#32353A] cursor-pointer text-white"
                  >
                    <span className="material-symbols-outlined text-lg text-[#FFD23F]">chat</span>
                    <span>WhatsApp</span>
                  </a>
                  <a 
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store?.address || 'Warri, Delta State, Nigeria')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-[#26282B] border border-white/5 py-3.5 rounded-2xl flex flex-col items-center gap-1.5 hover:bg-[#32353A] cursor-pointer text-white"
                  >
                    <span className="material-symbols-outlined text-lg text-[#FFD23F]">directions_car</span>
                    <span>Directions</span>
                  </a>
                  <button 
                    onClick={() => {
                      if (navigator.share) {
                        navigator.share({
                          title: store?.business_name || 'StoreFlow Store',
                          text: `Shop online at ${store?.business_name || 'StoreFlow'}!`,
                          url: window.location.href
                        }).catch(() => {});
                      } else {
                        alert('Link copied to clipboard!');
                      }
                    }}
                    className="bg-[#26282B] border border-white/5 py-3.5 rounded-2xl flex flex-col items-center gap-1.5 hover:bg-[#32353A] cursor-pointer text-white"
                  >
                    <span className="material-symbols-outlined text-lg text-[#FFD23F]">share</span>
                    <span>Share Link</span>
                  </button>
                </div>
              </div>
            )}
          </main>

          {/* Floating Sticky Bottom Cart Card */}
          {totalItemsCount > 0 && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-[480px] px-4 animate-fade md:bottom-6">
              <button
                onClick={() => setIsCartOpen(true)}
                className="w-full bg-[#FFD23F] text-slate-950 py-4 px-6 rounded-full flex justify-between items-center shadow-2xl active:scale-98 transition-all cursor-pointer font-black"
              >
                <div className="flex items-center gap-3">
                  <span className="bg-slate-950 text-[#FFD23F] text-[11px] w-6 h-6 flex items-center justify-center rounded-full font-black font-mono">{totalItemsCount}</span>
                  <span className="font-black text-sm uppercase tracking-wider">View Cart</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-black text-sm">₦{total.toLocaleString()}</span>
                  <span className="material-symbols-outlined text-lg font-bold">arrow_forward</span>
                </div>
              </button>
            </div>
          )}
        </div>
      )}
      {/* ─── 7. Order Tracking timeline ─── */}
      {screen === 'tracking' && (
        <div className="bg-[#1A1C1E] min-h-screen text-white pb-32">
          {/* Header */}
          <header className="sticky top-0 z-40 bg-[#1A1C1E]/80 backdrop-blur-md flex justify-between items-center w-full h-16 border-b border-white/5 px-4 text-white">
            <button 
              onClick={() => {
                setScreen('store');
                setStoreTab('Overview');
              }} 
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white active:scale-95 transition cursor-pointer"
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
                  ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30' 
                  : 'bg-[#FFD23F]/20 text-[#FFD23F] border border-[#FFD23F]/35'
              }`}>
                <span className="material-symbols-outlined text-3xl font-black">
                  {orderStatus === 'Rejected' ? 'block' : orderStatus === 'Cancelled' ? 'close' : 'receipt_long'}
                </span>
              </div>
              <h1 className="text-2xl font-black text-white font-display uppercase tracking-tight">
                {orderStatus === 'Rejected' ? 'Order Rejected' : orderStatus === 'Cancelled' ? 'Order Cancelled' : 'Order Placed! 🎉'}
              </h1>
              <p className="text-xs text-slate-400 font-medium max-w-xs leading-relaxed">
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
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-2xl text-xs space-y-1.5">
                <h4 className="font-extrabold text-sm flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm font-bold">warning</span>
                  <span>Cancellation details</span>
                </h4>
                <p className="text-slate-300 font-medium leading-relaxed">
                  The merchant rejected your order.
                </p>
                {rejectionReason && (
                  <p className="mt-2 bg-rose-500/20 p-3 rounded-xl border border-rose-500/30 text-white font-semibold font-mono">
                    Reason: {rejectionReason}
                  </p>
                )}
              </div>
            )}

            {/* Changes Requested Interactive Box */}
            {orderStatus === 'Changes Requested' && (
              <div className="bg-amber-500/10 border border-amber-500/20 text-[#FFD23F] p-4 rounded-2xl text-xs space-y-3.5">
                <h4 className="font-extrabold text-sm flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm font-bold">info</span>
                  <span>Review Proposal</span>
                </h4>
                {changeRequestMessage && (
                  <div className="bg-amber-500/20 p-3 rounded-xl border border-amber-500/30 text-white leading-relaxed font-semibold">
                    "{changeRequestMessage}"
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleCancelOrder}
                    disabled={loading}
                    className="flex-1 py-3 bg-rose-500/20 border border-rose-500/30 hover:bg-rose-500/30 text-rose-400 font-extrabold rounded-xl transition cursor-pointer text-center uppercase tracking-wider"
                  >
                    Cancel Order
                  </button>
                  <button
                    onClick={handleApproveChanges}
                    disabled={loading}
                    className="flex-1 py-3 bg-[#FFD23F] hover:opacity-90 text-slate-950 font-black rounded-xl transition cursor-pointer text-center uppercase tracking-wider"
                  >
                    {loading ? 'Approving...' : 'Approve Proposal'}
                  </button>
                </div>
              </div>
            )}

            {/* Reference Badge Card */}
            <div className="bg-[#26282B] border border-white/5 rounded-2xl p-5 flex items-center justify-between shadow-sm">
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Order Number</div>
                <div className="text-xl font-black mt-0.5 tracking-wider text-white font-mono">#{orderNumber}</div>
              </div>
              <button 
                onClick={copyOrderNumber} 
                className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-xs font-bold flex items-center gap-2 cursor-pointer hover:bg-white/15 active:scale-95 transition-all text-white"
              >
                <span className="material-symbols-outlined text-sm">{orderCopied ? 'check' : 'content_copy'}</span>
                <span>{orderCopied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-3 gap-3 text-white text-xs">
              <div className="p-3 bg-[#26282B] border border-white/5 rounded-2xl flex flex-col items-center text-center gap-1">
                <span className="material-symbols-outlined text-[#FFD23F] text-lg">schedule</span>
                <span className="font-extrabold text-[11px] mt-1 truncate">{deliveryType === 'delivery' ? '30–45 min' : '15–20 min'}</span>
                <span className="text-[9px] text-slate-400 font-semibold">Estimated Time</span>
              </div>
              <div className="p-3 bg-[#26282B] border border-white/5 rounded-2xl flex flex-col items-center text-center gap-1">
                <span className="material-symbols-outlined text-[#FFD23F] text-lg">{deliveryType === 'delivery' ? 'local_shipping' : 'storefront'}</span>
                <span className="font-extrabold text-[11px] mt-1 capitalize truncate">{deliveryType}</span>
                <span className="text-[9px] text-slate-400 font-semibold">Order Mode</span>
              </div>
              <div className="p-3 bg-[#26282B] border border-white/5 rounded-2xl flex flex-col items-center text-center gap-1">
                <span className="material-symbols-outlined text-[#FFD23F] text-lg">credit_card</span>
                <span className="font-extrabold text-[11px] mt-1 capitalize truncate">{paymentMethod}</span>
                <span className="text-[9px] text-slate-400 font-semibold">Payment</span>
              </div>
            </div>

            {/* Timeline Steps Tracker */}
            <div className="bg-[#26282B] border border-white/5 rounded-3xl p-5 shadow-lg space-y-6">
              <h3 className="font-black text-sm uppercase tracking-wider text-slate-400 border-b border-white/5 pb-2.5">Live Timeline</h3>
              
              <div className="relative border-l border-white/10 ml-3.5 pl-6 space-y-6">
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
                          ? 'bg-[#FFD23F] border-[#1A1C1E] scale-110 shadow-lg shadow-[#FFD23F]/20' 
                          : completed 
                            ? 'bg-[#FFD23F] border-[#FFD23F]' 
                            : 'bg-[#1A1C1E] border-white/20'
                      }`} />
                      <div className="space-y-1">
                        <div className={`text-xs font-black ${active ? 'text-[#FFD23F]' : completed ? 'text-white' : 'text-slate-400'}`}>{step.label}</div>
                        <div className="text-[10px] text-slate-400 leading-relaxed font-semibold">{step.desc}</div>
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
                  setScreen('store');
                  setStoreTab('Overview');
                }}
                className="w-full py-4 bg-[#FFD23F] text-slate-950 font-black rounded-2xl flex items-center justify-center gap-2 active:scale-98 transition shadow-lg text-sm uppercase tracking-wider cursor-pointer"
              >
                <span className="material-symbols-outlined text-base font-bold">arrow_back</span>
                <span>Back to Storefront</span>
              </button>

              <button
                onClick={() => {
                  setScreen('history');
                  loadOrdersHistory();
                }}
                className="w-full py-4 bg-[#26282B] border border-white/5 text-white font-extrabold rounded-2xl flex items-center justify-between px-5 hover:bg-[#32353A] cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#FFD23F] text-lg">receipt_long</span>
                  <span>View All Past Orders</span>
                </span>
                <span className="material-symbols-outlined text-slate-400 text-lg">chevron_right</span>
              </button>

              {/* PWA Installer banner */}
              {deferredPrompt && (
                <button 
                  onClick={triggerInstall} 
                  className="w-full py-4 bg-[#FFD23F]/10 border border-[#FFD23F]/20 text-[#FFD23F] font-bold rounded-2xl flex items-center justify-between px-5 hover:bg-[#FFD23F]/15 cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#FFD23F] text-lg">download</span>
                    <span>Install PWA Web App</span>
                  </span>
                  <span className="material-symbols-outlined text-[#FFD23F] text-lg">chevron_right</span>
                </button>
              )}
            </div>
          </main>
        </div>
      )}
      {/* ─── 8. Profile Hub Screen ─── */}
      {screen === 'profile' && (
        <div className="bg-[#1A1C1E] min-h-screen text-white pb-32">
          {/* Header */}
          <header className="sticky top-0 z-40 bg-[#1A1C1E]/80 backdrop-blur-md flex justify-between items-center w-full h-16 border-b border-white/5 px-4 text-white">
            <button 
              onClick={() => setScreen('home')} 
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white active:scale-95 transition cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <span className="text-sm font-black tracking-wider uppercase">Profile Hub</span>
            <div className="w-10 h-10" />
          </header>

          <main className="mt-6 px-4 max-w-md mx-auto space-y-6 text-left">
            {/* User credentials details */}
            <div className="p-5 bg-[#26282B] border border-white/5 rounded-3xl flex items-center gap-4 shadow-lg">
              <div className="w-14 h-14 bg-[#FFD23F] rounded-full flex items-center justify-center font-black text-slate-950 text-xl uppercase shadow-sm">
                {profileName ? profileName.slice(0, 2) : 'GS'}
              </div>
              <div className="space-y-0.5">
                <h4 className="font-extrabold text-base text-white">{profileName || 'Guest Shopper'}</h4>
                <p className="text-xs text-slate-400 font-semibold">{profileEmail || 'Shopping anonymously'}</p>
                {currentUser ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mt-1">
                    Registered Member
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30 mt-1">
                    Guest Account
                  </span>
                )}
              </div>
            </div>

            {/* Permanent Customer ID Section */}
            <div className="bg-[#26282B] border border-white/5 rounded-3xl p-5 shadow-lg space-y-3">
              <h3 className="font-black text-xs uppercase tracking-wider text-slate-400">Security Credentials</h3>
              <div className="flex justify-between items-center bg-[#1A1C1E] p-3.5 rounded-2xl border border-white/5 text-xs">
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-slate-400 font-bold">StoreFlow Customer ID</p>
                  <p className="font-mono mt-1 text-white font-bold">{localStorage.getItem('storeflow_customer_uuid')?.slice(-12) || 'Generating...'}</p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(localStorage.getItem('storeflow_customer_uuid') || '');
                    alert('Customer ID copied to clipboard!');
                  }}
                  className="p-2 rounded-xl bg-white/10 text-[#FFD23F] hover:bg-white/15 cursor-pointer active:scale-95 transition text-white"
                >
                  <span className="material-symbols-outlined text-sm font-bold">content_copy</span>
                </button>
              </div>
              {!currentUser && (
                <div className="p-3.5 bg-[#FFD23F]/5 border border-[#FFD23F]/10 rounded-2xl text-[10px] text-slate-300 leading-relaxed font-semibold">
                  💡 <strong>Important Note:</strong> Your orders are tied to this device. Please log in or sign up to link your history permanently.
                </div>
              )}
            </div>

            {/* Form actions */}
            <div className="space-y-4">
              <div className="space-y-1 px-1">
                <label className="text-xs font-black text-slate-400 uppercase tracking-wider">Display Name</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  className="w-full px-4 h-12 bg-[#26282B] text-white rounded-2xl border border-white/5 focus:outline-none focus:border-white/20 text-xs font-bold"
                />
              </div>

              {/* Dark mode toggler */}
              <div className="flex items-center justify-between p-4 bg-[#26282B] border border-white/5 rounded-2xl">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#FFD23F] text-lg">dark_mode</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Dark Mode Accent</span>
                </div>
                <input
                  type="checkbox"
                  checked={darkMode}
                  onChange={e => {
                    setDarkMode(e.target.checked);
                    localStorage.setItem('storeflow_dark_mode', String(e.target.checked));
                  }}
                  className="rounded text-[#FFD23F] focus:ring-[#FFD23F] h-5 w-5 bg-slate-900 border-white/10"
                />
              </div>

              {/* Saved list options */}
              <button 
                onClick={() => { setScreen('history'); loadOrdersHistory(); }} 
                className="w-full p-4 bg-[#26282B] border border-white/5 rounded-2xl text-left font-extrabold text-xs uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-[#32353A] active:scale-98 transition text-white"
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#FFD23F] text-lg">receipt_long</span>
                  <span>My Orders History</span>
                </span>
                <span className="material-symbols-outlined text-slate-400 text-lg">chevron_right</span>
              </button>

              {/* PWA Installer */}
              {deferredPrompt && (
                <button 
                  onClick={triggerInstall} 
                  className="w-full p-4 bg-[#FFD23F]/10 border border-[#FFD23F]/20 rounded-2xl text-left font-extrabold text-xs uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-[#FFD23F]/15 active:scale-98 transition text-[#FFD23F]"
                >
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#FFD23F] text-lg">download</span>
                    <span>Install PWA App</span>
                  </span>
                  <span className="material-symbols-outlined text-[#FFD23F] text-lg">chevron_right</span>
                </button>
              )}
            </div>
          </main>

          <footer className="py-6 px-4 max-w-md mx-auto">
            {currentUser ? (
              <button onClick={handleLogout} className="w-full h-14 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-2xl active:scale-95 transition cursor-pointer uppercase tracking-wider text-xs">
                Log Out Account
              </button>
            ) : (
              <button onClick={() => setScreen('login')} className="w-full h-14 bg-white text-[#1A1C1E] font-black rounded-2xl active:scale-95 transition cursor-pointer uppercase tracking-wider text-xs">
                Sign In / Register
              </button>
            )}
          </footer>
        </div>
      )}
      {/* ─── 9. Orders History Screen ─── */}
      {screen === 'history' && (
        <div className="bg-[#1A1C1E] min-h-screen text-white pb-32">
          {/* Header */}
          <header className="sticky top-0 z-40 bg-[#1A1C1E]/80 backdrop-blur-md flex justify-between items-center w-full h-16 border-b border-white/5 px-4 text-white">
            <button 
              onClick={() => setScreen('home')} 
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white active:scale-95 transition cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <span className="text-sm font-black tracking-wider uppercase">Orders History</span>
            <div className="w-10 h-10" />
          </header>

          <main className="mt-6 px-4 max-w-md mx-auto space-y-4 text-left">
            {ordersHistory.length === 0 ? (
              <div className="text-center py-16 text-slate-400 flex flex-col items-center justify-center gap-3">
                <span className="material-symbols-outlined text-5xl text-slate-600">receipt_long</span>
                <p className="text-sm font-black uppercase tracking-wider">No orders placed yet</p>
                <p className="text-xs text-slate-500 font-medium max-w-xs leading-relaxed">
                  When you place an order, it will appear here instantly with live tracking updates.
                </p>
              </div>
            ) : (
              ordersHistory.map(o => {
                let itemsSummary = [];
                let instructions = '';
                let landmark = '';
                let paymentMethodText = 'Cash';
                let storeNameText = 'Partner Store';
                
                if (o.notes) {
                  try {
                    const parsed = JSON.parse(o.notes);
                    itemsSummary = parsed.items_summary || [];
                    instructions = parsed.instructions || '';
                    landmark = parsed.landmark || '';
                    paymentMethodText = parsed.payment_method || 'Cash';
                    storeNameText = parsed.store_name || 'StoreFlow Partner';
                  } catch (e) {
                    instructions = o.notes;
                  }
                }

                // If itemsSummary is empty, fallback to order_items relation
                if (itemsSummary.length === 0 && o.order_items) {
                  itemsSummary = o.order_items.map((oi) => ({
                    name: oi.product?.name || 'Product',
                    quantity: oi.quantity,
                    price: oi.price
                  }));
                }

                const totalQty = itemsSummary.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

                return (
                  <div key={o.id} className="bg-[#26282B] border border-white/5 rounded-3xl p-5 shadow-lg space-y-4">
                    {/* Header: Store Name & Date */}
                    <div className="flex justify-between items-start border-b border-white/5 pb-3">
                      <div>
                        <h4 className="font-extrabold text-sm text-white truncate max-w-[200px]">{storeNameText}</h4>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">#{o.order_number}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 font-bold block">{new Date(o.created_at).toLocaleDateString()}</span>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider mt-1 ${
                          o.status === 'Completed' || o.status === 'Delivered' ? 'bg-emerald-500/25 text-emerald-400 border border-emerald-500/35' :
                          o.status === 'Rejected' || o.status === 'Cancelled' ? 'bg-rose-500/25 text-rose-400 border border-rose-500/35' :
                          'bg-[#FFD23F]/25 text-[#FFD23F] border border-[#FFD23F]/35'
                        }`}>
                          {o.status}
                        </span>
                      </div>
                    </div>

                    {/* Receipt Items list */}
                    <div className="space-y-2 text-xs">
                      <p className="font-bold text-[10px] text-slate-400 uppercase tracking-wider">Order Items</p>
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {itemsSummary.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center text-slate-300">
                            <span className="font-semibold text-white">
                              {item.name} <span className="text-slate-400 font-mono text-[10px]">x{item.quantity}</span>
                            </span>
                            <span className="font-mono text-slate-400">₦{Number(item.price || 0).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Totals & Metadata */}
                    <div className="bg-[#1A1C1E]/50 p-3 rounded-2xl border border-white/5 space-y-2 text-xs">
                      <div className="flex justify-between text-slate-400 font-semibold">
                        <span>Total Items</span>
                        <span>{totalQty} items</span>
                      </div>
                      <div className="flex justify-between text-slate-400 font-semibold">
                        <span>Payment Mode</span>
                        <span className="capitalize">{paymentMethodText}</span>
                      </div>
                      <div className="flex justify-between text-white font-extrabold border-t border-white/5 pt-2">
                        <span>Paid Total</span>
                        <span className="text-[#FFD23F] font-black">₦{o.total.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1 text-xs font-bold">
                      <button
                        onClick={() => {
                          setOrderId(o.id);
                          setOrderNumber(o.order_number);
                          setOrderStatus(o.status);
                          setScreen('tracking');
                        }}
                        className="flex-1 py-3 bg-[#26282B] border border-white/10 hover:bg-[#32353A] text-white rounded-xl text-center cursor-pointer uppercase tracking-wider transition"
                      >
                        Track Status
                      </button>
                      <button
                        onClick={() => handleReorder(o)}
                        className="flex-1 py-3 bg-[#FFD23F] text-slate-950 rounded-xl text-center cursor-pointer uppercase font-black tracking-wider transition hover:opacity-90 active:scale-98"
                      >
                        Reorder Items
                      </button>
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
                onClick={() => setScreen('home')}
                className="w-full h-14 bg-primary text-on-primary font-bold rounded-full shadow-lg active:scale-98 hover:bg-primary/95 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">home</span>
                <span>Go to Home Page</span>
              </button>
            </div>
          </div>
        </main>
      )}

      {/* ─── Product Details Modal Sheet ─── */}
      {selectedProduct && screen === 'store' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSelectedProduct(null)}>
          <div className="bg-surface w-full max-w-[480px] rounded-t-3xl overflow-hidden p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
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

            <div className="flex gap-4">
              {getQty(selectedProduct.id) > 0 ? (
                <div className="flex-1 flex justify-between items-center bg-surface-container-low rounded-full p-1.5 border border-outline-variant/20">
                  <button onClick={() => addToCart(selectedProduct, -1)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer">
                    <span className="material-symbols-outlined text-lg">remove</span>
                  </button>
                  <span className="font-extrabold text-base text-on-surface">{getQty(selectedProduct.id)}</span>
                  <button onClick={() => addToCart(selectedProduct, 1)} className="w-10 h-10 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer">
                    <span className="material-symbols-outlined text-lg">add</span>
                  </button>
                </div>
              ) : (
                <button
                  disabled={selectedProduct.quantity <= 0 || store?.status === 'inactive'}
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
          <div className="bg-surface w-full max-w-[480px] rounded-t-3xl overflow-hidden p-6 animate-slide-up flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-1 bg-outline-variant/30 rounded-full mx-auto mb-5"></div>
            
            {checkoutStep === 'shopping' && (
              <>
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-extrabold text-on-background font-headline-lg">My Cart ({totalItemsCount})</span>
                    {cart.length > 0 && (
                      <button onClick={() => setCart([])} className="text-xs text-red-500 font-bold hover:underline cursor-pointer">
                        Clear All
                      </button>
                    )}
                  </div>
                  <button onClick={() => setIsCartOpen(false)} className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center cursor-pointer hover:bg-surface-container-high transition-colors">
                    <span className="material-symbols-outlined text-lg">close</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 pr-1 py-2">
                  {cart.map(item => (
                    <div key={item.product.id} className="flex gap-4 items-center pb-4 border-b border-outline-variant/10">
                      <div className="w-14 h-14 bg-surface-container-low rounded-xl flex items-center justify-center overflow-hidden shrink-0">
                        {item.product.image ? (
                          <img src={item.product.image} className="w-full h-full object-contain p-1" alt="" />
                        ) : (
                          <span className="text-2xl">📦</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-sm text-on-surface truncate">{item.product.name}</h4>
                        <span className="text-xs text-secondary mt-0.5 block">₦{getPrice(item.product)} each</span>
                      </div>
                      <div className="flex items-center gap-3 bg-surface-container-low rounded-full p-1 border border-outline-variant/20 shrink-0">
                        <button onClick={() => addToCart(item.product, -1)} className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer">
                          <span className="material-symbols-outlined text-sm">remove</span>
                        </button>
                        <span className="font-bold text-sm text-on-surface">{item.quantity}</span>
                        <button onClick={() => addToCart(item.product, 1)} className="w-8 h-8 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer">
                          <span className="material-symbols-outlined text-sm">add</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-outline-variant/20 pt-4 mt-4 text-on-surface">
                  <div className="space-y-2 mb-5">
                    <div className="flex justify-between text-xs text-secondary">
                      <span>Subtotal</span><span>₦{subtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs text-secondary">
                      <span>Delivery Fee</span><span>{deliveryFee === 0 ? 'FREE' : `₦${deliveryFee}`}</span>
                    </div>
                    <div className="h-[1px] bg-outline-variant/10 my-2"></div>
                    <div className="flex justify-between text-base font-extrabold text-on-background">
                      <span>Total</span><span>₦{total.toLocaleString()}</span>
                    </div>
                  </div>
                  <button
                    disabled={cart.length === 0 || !isStoreOpenState || store?.data?.marketplaceSettings?.onlineOrdersEnabled === false}
                    onClick={() => setCheckoutStep('checkout')}
                    className="w-full bg-primary text-on-primary py-4 rounded-full font-bold shadow-md hover:bg-primary/95 active:scale-98 transition-all cursor-pointer disabled:opacity-50"
                  >
                    Continue to Checkout
                  </button>
                </div>
              </>
            )}

            {checkoutStep === 'checkout' && (
              <div className="space-y-5 overflow-y-auto max-h-[75vh] py-2 text-on-surface">
                <div className="flex justify-between items-center">
                  <h3 className="font-extrabold text-lg font-headline-lg">Checkout Delivery Details</h3>
                  <button onClick={() => setCheckoutStep('shopping')} className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center cursor-pointer">
                    <span className="material-symbols-outlined text-base">arrow_back</span>
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-secondary uppercase tracking-wider">Order Option</label>
                  <div className="grid grid-cols-2 gap-2 bg-surface-container-low rounded-full p-1 border border-outline-variant/20">
                    <button onClick={() => setDeliveryType('pickup')} className={`py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${deliveryType === 'pickup' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant'}`}>
                      Store Pickup
                    </button>
                    <button onClick={() => setDeliveryType('delivery')} className={`py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${deliveryType === 'delivery' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant'}`}>
                      Home Delivery
                    </button>
                  </div>
                </div>

                {(store?.data?.marketplaceSettings?.reqCustomerName !== false) && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-secondary uppercase px-1">Full Name</label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                      className="w-full px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/30 text-sm font-semibold outline-none"
                      placeholder="Enter full name"
                    />
                  </div>
                )}

                {(store?.data?.marketplaceSettings?.reqCustomerPhone !== false) && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-secondary uppercase px-1">Phone Number</label>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={e => setCustomerPhone(e.target.value)}
                      className="w-full px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/30 text-sm font-semibold outline-none"
                      placeholder="e.g. 08123456789"
                    />
                  </div>
                )}

                {(store?.data?.marketplaceSettings?.reqCustomerEmail === true) && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-secondary uppercase px-1">Email Address</label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={e => setCustomerEmail(e.target.value)}
                      className="w-full px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/30 text-sm font-semibold outline-none"
                      placeholder="Enter email address"
                    />
                  </div>
                )}

                {deliveryType === 'delivery' && (store?.data?.marketplaceSettings?.reqCustomerAddress !== false) && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-secondary uppercase px-1">Delivery Address</label>
                    <input
                      type="text"
                      value={deliveryAddress}
                      onChange={e => setDeliveryAddress(e.target.value)}
                      className="w-full px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/30 text-sm font-semibold outline-none"
                      placeholder="Enter street address"
                    />
                  </div>
                )}

                {deliveryType === 'delivery' && (store?.data?.marketplaceSettings?.reqCustomerLandmark === true) && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-secondary uppercase px-1">Landmark / Near Bus Stop</label>
                    <input
                      type="text"
                      value={deliveryLandmark}
                      onChange={e => setDeliveryLandmark(e.target.value)}
                      className="w-full px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/30 text-sm font-semibold outline-none"
                      placeholder="Nearest landmark"
                    />
                  </div>
                )}

                {(store?.data?.marketplaceSettings?.reqCustomerNotes !== false) && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-secondary uppercase px-1">Special Instructions</label>
                    <input
                      type="text"
                      value={specialInstructions}
                      onChange={e => setSpecialInstructions(e.target.value)}
                      className="w-full px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/30 text-sm font-semibold outline-none"
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
                      className="px-4 bg-[#26282B] border border-white/10 rounded-full font-bold text-xs hover:bg-[#32353A] transition cursor-pointer text-[#FFD23F]"
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
                    className="flex-1 bg-[#FFD23F] text-slate-950 py-4 rounded-full font-black uppercase tracking-wider text-xs shadow-md hover:opacity-90 active:scale-98 transition-all cursor-pointer"
                  >
                    Continue to Payment
                  </button>
                </div>
              </div>
            )}

            {checkoutStep === 'payment' && (
              <div className="space-y-5 text-on-surface">
                <div className="flex justify-between items-center">
                  <h3 className="font-extrabold text-lg font-headline-lg">Select Payment Method</h3>
                  <button onClick={() => setCheckoutStep('checkout')} className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center cursor-pointer">
                    <span className="material-symbols-outlined text-base">arrow_back</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {paymentMethodsList.map(opt => (
                    <div
                      key={opt.key}
                      onClick={() => setPaymentMethod(opt.key as any)}
                      className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center gap-3 ${paymentMethod === opt.key ? 'border-primary bg-primary/5' : 'border-outline-variant/30'}`}
                    >
                      <span className="material-symbols-outlined text-2xl text-primary">{opt.icon}</span>
                      <div className="flex-1">
                        <div className="text-sm font-extrabold">{opt.label}</div>
                        <div className="text-xs text-secondary mt-0.5">{opt.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={submitOrder}
                  className="w-full bg-primary text-on-primary py-4 rounded-full font-bold shadow-md hover:bg-primary/95 transition-all cursor-pointer"
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
          <div className="bg-surface w-full max-w-[480px] rounded-t-3xl overflow-hidden p-6 animate-slide-up space-y-6" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-1 bg-outline-variant/30 rounded-full mx-auto mb-2"></div>
            <div className="flex justify-between items-center">
              <h3 className="font-extrabold text-lg flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">bolt</span>
                <span>⚡ Quick Order</span>
              </h3>
              <button onClick={() => setShowQuickOrder(false)} className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center cursor-pointer">
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
                  className="flex-1 px-4 h-12 bg-surface-container-low text-on-surface rounded-xl border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary text-sm font-semibold"
                />
                <button
                  onClick={handleVoiceSearch}
                  className={`w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer transition-colors active-scale ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-primary-container text-on-primary-container'}`}
                >
                  <span className="material-symbols-outlined text-xl">{isListening ? 'mic' : 'mic_none'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={startScanner} className="p-4 border border-outline-variant/30 rounded-2xl flex flex-col items-center gap-1.5 cursor-pointer active-scale">
                  <span className="material-symbols-outlined text-primary text-2xl">qr_code_scanner</span>
                  <span className="text-xs font-bold">Scan Barcode</span>
                </button>
                <button
                  onClick={() => {
                    const firstStore = allStores[0];
                    if (firstStore) {
                      setStoreId(firstStore.id);
                      loadStoreDetails(firstStore.id);
                      setScreen('store');
                      setShowQuickOrder(false);
                    }
                  }}
                  className="p-4 border border-outline-variant/30 rounded-2xl flex flex-col items-center gap-1.5 cursor-pointer active-scale"
                >
                  <span className="material-symbols-outlined text-primary text-2xl">history</span>
                  <span className="text-xs font-bold">Repeat Order</span>
                </button>
              </div>

              <div className="space-y-2">
                <h4 className="text-[10px] font-bold text-secondary uppercase tracking-widest px-1">AI Smart Suggestions</h4>
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl space-y-2">
                  <p className="text-xs font-bold text-primary">Cheaper Store Found!</p>
                  <p className="text-xs text-secondary">Indomie Chicken is 15% cheaper at FreshMart. Switch to save ₦120.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Scanner Modal */}
      {showScanner && renderScanner()}

      {/* ─── Global Bottom Navigation ─── */}
      {['home', 'store', 'tracking', 'profile', 'history'].includes(screen) && !isCartOpen && (
        <nav className="fixed bottom-0 left-0 w-full z-40 flex justify-around items-center px-4 py-3 bg-surface shadow-[0px_-4px_20px_rgba(0,0,0,0.05)] rounded-t-2xl border-t border-outline-variant/10 text-on-surface">
          <button onClick={() => setScreen('home')} className={`flex flex-col items-center justify-center cursor-pointer ${screen === 'home' ? 'text-primary relative after:content-[\'\'] after:absolute after:-bottom-1 after:w-1 after:h-1 after:bg-primary-container after:rounded-full' : 'text-secondary'}`}>
            <span className="material-symbols-outlined text-xl">home</span>
            <span className={`text-[10px] mt-1 ${screen === 'home' ? 'font-bold' : 'font-semibold'}`}>Home</span>
          </button>
          <button onClick={() => setScreen('home')} className={`flex flex-col items-center justify-center cursor-pointer text-secondary`}>
            <span className="material-symbols-outlined text-xl">grid_view</span>
            <span className="text-[10px] font-semibold mt-1">Explore</span>
          </button>
          <button onClick={() => { setScreen('history'); loadOrdersHistory(); }} className={`flex flex-col items-center justify-center cursor-pointer ${screen === 'history' ? 'text-primary relative after:content-[\'\'] after:absolute after:-bottom-1 after:w-1 after:h-1 after:bg-primary-container after:rounded-full' : 'text-secondary'}`}>
            <span className="material-symbols-outlined text-xl">receipt_long</span>
            <span className={`text-[10px] mt-1 ${screen === 'history' ? 'font-bold' : 'font-semibold'}`}>Orders</span>
          </button>
          <button onClick={() => setIsCartOpen(true)} className="flex flex-col items-center justify-center text-secondary relative cursor-pointer">
            <span className="material-symbols-outlined text-xl">shopping_cart</span>
            <span className="text-[10px] font-semibold mt-1">Cart</span>
            {totalItemsCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-primary text-on-primary text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-bold">{totalItemsCount}</span>
            )}
          </button>
        </nav>
      )}

    </div>
  );
}

export default App;
