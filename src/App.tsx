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
  const [screen, setScreen] = useState<'splash' | 'onboarding' | 'login' | 'location' | 'home' | 'store' | 'tracking' | 'profile' | 'history'>('splash');
  const [_storeId, setStoreId] = useState<string | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [allStores, setAllStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [deepLinkedProductId, setDeepLinkedProductId] = useState<string | null>(null);

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
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'opay'>('cash');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState('');
  const [orderStatus, setOrderStatus] = useState('Pending');
  const [orderCopied, setOrderCopied] = useState(false);
  const [ordersHistory, setOrdersHistory] = useState<Order[]>([]);

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

  // ─── Splash Screen Load Timer ──────────────────────────────────────────────

  useEffect(() => {
    if (screen === 'splash') {
      const timer = setTimeout(() => {
        if (!isOnboarded) {
          setScreen('onboarding');
        } else {
          // Check session auto login
          checkSession();
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
      setScreen('home');
    } else {
      // If remember logic is offline or no user, direct to home (as guest) or login
      setScreen('home');
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
    setLoading(true);
    setErrorText(null);
    try {
      const { data: storeData, error: storeErr } = await supabase.from('stores').select('*').eq('id', sid).maybeSingle();
      if (storeErr) throw storeErr;

      if (storeData) {
        setStore(storeData);
        const { data: prodData } = await supabase.from('products').select('*').eq('store_id', sid).eq('status', 'active');
        const { data: catData } = await supabase.from('categories').select('name').eq('store_id', sid);

        const prods = prodData || [];
        setProducts(prods);
        localStorage.setItem('storeflow_cached_products', JSON.stringify(prods));

        let cats = ['All'];
        if (catData && catData.length > 0) {
          cats = ['All', ...catData.map((c: any) => c.name)];
        } else {
          const uniq = Array.from(new Set(prods.map(p => p.category).filter((c): c is string => !!c)));
          cats = ['All', ...uniq];
        }
        setCategories(cats);
        localStorage.setItem('storeflow_cached_categories', JSON.stringify(cats));
      } else {
        const matched = allStores.find(s => s.id === sid);
        if (matched) {
          setStore(matched);
          setProducts([]);
        }
      }
    } catch (err) {
      console.error('Error loading store detail:', err);
      setErrorText('Offline Mode: Displaying offline catalog.');
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

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.product.selling_price * i.quantity, 0), [cart]);
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
        instructions: specialInstructions
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
            price: item.product.selling_price,
            subtotal: item.product.selling_price * item.quantity
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
            price: item.product.selling_price,
            subtotal: item.product.selling_price * item.quantity
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
                      <p className="font-extrabold text-base text-on-background">₦{p.selling_price.toLocaleString()}</p>
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

          {/* Bottom Navigation */}
          <nav className="fixed bottom-0 left-0 w-full z-40 flex justify-around items-center px-4 py-3 bg-surface shadow-[0px_-4px_20px_rgba(0,0,0,0.05)] rounded-t-2xl md:hidden border-t border-outline-variant/10 text-on-surface">
            <button onClick={() => setScreen('home')} className="flex flex-col items-center justify-center text-primary relative after:content-[''] after:absolute after:-bottom-1 after:w-1 after:h-1 after:bg-primary-container after:rounded-full cursor-pointer">
              <span className="material-symbols-outlined text-xl">home</span>
              <span className="text-[10px] font-bold mt-1">Home</span>
            </button>
            <button onClick={() => setScreen('home')} className="flex flex-col items-center justify-center text-secondary cursor-pointer">
              <span className="material-symbols-outlined text-xl">grid_view</span>
              <span className="text-[10px] font-semibold mt-1">Explore</span>
            </button>
            <button onClick={() => { setScreen('history'); loadOrdersHistory(); }} className="flex flex-col items-center justify-center text-secondary cursor-pointer">
              <span className="material-symbols-outlined text-xl">receipt_long</span>
              <span className="text-[10px] font-semibold mt-1">Orders</span>
            </button>
            <button onClick={() => setIsCartOpen(true)} className="flex flex-col items-center justify-center text-secondary relative cursor-pointer">
              <span className="material-symbols-outlined text-xl">shopping_cart</span>
              <span className="text-[10px] font-semibold mt-1">Cart</span>
              {totalItemsCount > 0 && (
                <span className="absolute -top-1 -right-2 bg-primary text-on-primary text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-bold">{totalItemsCount}</span>
              )}
            </button>
          </nav>
        </div>
      )}

      {/* ─── 6. Store Details Page ─── */}
      {screen === 'store' && (
        <div className="max-w-[1200px] mx-auto pb-24">
          <header className="sticky top-0 z-40 bg-surface/85 backdrop-blur-md flex justify-between items-center w-full h-16 border-b border-outline-variant/10 px-4 md:px-gutter text-on-surface">
            <div className="flex items-center gap-3">
              <button onClick={() => setScreen('home')} className="w-10 h-10 flex items-center justify-center rounded-full bg-surface-container-low active:scale-95 transition-transform cursor-pointer">
                <span className="material-symbols-outlined text-lg">arrow_back</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button className="w-10 h-10 flex items-center justify-center rounded-full bg-surface-container-low active:scale-95 transition-transform cursor-pointer">
                <span className="material-symbols-outlined text-lg">favorite</span>
              </button>
              <button className="w-10 h-10 flex items-center justify-center rounded-full bg-surface-container-low active:scale-95 transition-transform cursor-pointer">
                <span className="material-symbols-outlined text-lg">share</span>
              </button>
            </div>
          </header>

          <main className="mt-4 px-4 md:px-gutter">
            {/* Warning Banner if closed */}
            {store?.status === 'inactive' && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm flex items-center gap-3">
                <span className="material-symbols-outlined text-xl shrink-0">warning</span>
                <span><strong>Closed Alert</strong>: This store is currently closed. You can view the items, but checkout will be disabled.</span>
              </div>
            )}

            {/* Hero */}
            <section className="mb-6">
              <div className="relative w-full aspect-[21/9] rounded-xl overflow-hidden shadow-sm bg-surface-container-low">
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10"></div>
                {store?.logo ? (
                  <img className="w-full h-full object-cover" src={store.logo} alt="" />
                ) : (
                  <div className="w-full h-full bg-primary-container flex items-center justify-center text-on-primary-container text-4xl">🏪</div>
                )}
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end z-20">
                  <span className="bg-primary-container text-on-primary-container px-3 py-1 rounded-full text-xs font-semibold shadow-sm">Featured Partner</span>
                </div>
              </div>

              <div className="mt-4 flex justify-between items-start">
                <div>
                  <h1 className="text-2xl md:text-3xl font-extrabold text-on-background font-headline-lg">{store?.business_name}</h1>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex items-center text-primary-fixed-dim">
                      <span className="material-symbols-outlined text-sm text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                      <span className="text-sm text-on-surface-variant font-semibold ml-1">4.6 (320 ratings)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 mt-4 text-on-surface-variant text-sm font-medium">
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[18px]">schedule</span>
                  <span>{deliveryType === 'delivery' ? '30-45 min' : '15-20 min'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[18px]">delivery_dining</span>
                  <span>Free delivery over ₦5,000</span>
                </div>
              </div>
            </section>

            {/* StoreFlow Price Badge */}
            <section className="mb-8">
              <div className="bg-surface-container-low rounded-xl p-4 flex items-center gap-4 border border-outline-variant/30">
                <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-on-primary-container text-2xl">local_offer</span>
                </div>
                <div>
                  <p className="font-bold text-on-surface">StoreFlow Prices</p>
                  <p className="text-sm text-secondary mt-0.5">You get lower prices on items in this store 🎉</p>
                </div>
              </div>
            </section>

            {/* Search and Category Chips */}
            <section className="sticky top-14 z-30 bg-surface/95 backdrop-blur-sm pt-2 pb-4">
              <div className="relative w-full h-14 bg-surface-container-low rounded-full flex items-center px-4 transition-all focus-within:ring-2 focus-within:ring-primary/20">
                <span className="material-symbols-outlined text-secondary mr-3">search</span>
                <input
                  className="bg-transparent border-none focus:ring-0 w-full text-base placeholder:text-secondary-fixed-dim outline-none text-on-surface"
                  placeholder="Search in store"
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="mr-2 cursor-pointer">
                    <span className="material-symbols-outlined text-secondary text-lg">close</span>
                  </button>
                )}
                <span className="material-symbols-outlined text-secondary ml-2 cursor-pointer">tune</span>
              </div>
              <div className="flex gap-2 mt-6 overflow-x-auto hide-scrollbar -mx-4 px-4 md:-mx-gutter md:px-gutter">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`whitespace-nowrap px-6 py-2 rounded-full font-semibold text-sm transition-all cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-on-background text-surface'
                        : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </section>

            {/* Product Grid */}
            <section className="mt-6">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredProducts.map(p => {
                  const qtyInCart = getQty(p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProduct(p)}
                      className="group relative bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-3 hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col justify-between"
                    >
                      <div>
                        <div className="relative w-full aspect-square bg-surface rounded-xl mb-3 overflow-hidden flex items-center justify-center">
                          {p.image ? (
                            <img className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300" src={p.image} alt="" />
                          ) : (
                            <div className="w-full h-full bg-surface-container-low flex items-center justify-center text-on-surface-variant text-2xl font-bold">
                              {p.name.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          {p.quantity <= 10 && p.quantity > 0 && (
                            <div className="absolute top-2 left-2 bg-error text-on-error px-2 py-0.5 rounded text-[10px] font-bold">
                              LOW STOCK
                            </div>
                          )}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              addToCart(p, 1);
                            }}
                            className="absolute bottom-2 right-2 w-8 h-8 bg-primary-container rounded-full flex items-center justify-center text-on-primary-container hover:bg-primary-container/90 active:scale-90 transition-transform cursor-pointer shadow-sm z-10"
                          >
                            <span className="material-symbols-outlined text-base">add</span>
                          </button>
                        </div>
                        <div className="space-y-1 px-1">
                          <p className="font-bold text-sm text-on-surface truncate">{p.name}</p>
                          <p className="text-xs text-secondary truncate">{p.description || p.category || 'Product'}</p>
                        </div>
                      </div>
                      <div className="flex justify-between items-center mt-3 px-1">
                        <span className="font-extrabold text-base text-on-background">₦{p.selling_price.toLocaleString()}</span>
                        {qtyInCart > 0 && (
                          <div className="flex items-center gap-1.5 bg-surface-container-high rounded-full px-2 py-1">
                            <span className="text-[10px] font-bold text-on-surface-variant">{qtyInCart} in cart</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </main>

          {/* Sticky Cart Bar */}
          {totalItemsCount > 0 && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-[480px] px-4 animate-fade md:bottom-6">
              <button
                onClick={() => setIsCartOpen(true)}
                className="w-full bg-primary text-on-primary py-4 px-6 rounded-full flex justify-between items-center shadow-lg active:scale-98 hover:bg-primary/95 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className="bg-on-primary text-primary text-xs w-6 h-6 flex items-center justify-center rounded-full font-bold">{totalItemsCount}</span>
                  <span className="font-semibold text-sm">View Cart</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">{store?.currency || '₦'}{total.toLocaleString()}</span>
                  <span className="material-symbols-outlined text-lg">arrow_forward</span>
                </div>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── 7. Order Tracking timeline ─── */}
      {screen === 'tracking' && (
        <div className="max-w-[480px] mx-auto py-8 px-4 animate-scale space-y-6">
          <div className="text-center flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center mb-2">
              <span className="material-symbols-outlined text-3xl font-bold">done</span>
            </div>
            <h1 className="text-2xl font-extrabold text-on-background font-headline-xl">Order Placed! 🎉</h1>
            <p className="text-sm text-secondary">Your order has been sent to the store.</p>
          </div>

          <div className="bg-primary text-on-primary rounded-2xl p-5 flex items-center justify-between shadow-sm">
            <div>
              <div className="text-[10px] font-bold text-on-primary/60 uppercase tracking-widest">Order Reference</div>
              <div className="text-2xl font-black mt-0.5 tracking-wider font-headline-xl">#{orderNumber}</div>
            </div>
            <button onClick={copyOrderNumber} className="px-4 py-2 rounded-lg bg-white/12 border border-white/10 text-xs font-bold flex items-center gap-2 cursor-pointer hover:bg-white/18 active:scale-95 transition-all">
              <span className="material-symbols-outlined text-sm">{orderCopied ? 'check' : 'content_copy'}</span>
              <span>{orderCopied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-on-surface">
            <div className="p-4 bg-surface-container rounded-2xl flex flex-col items-center text-center gap-1 border border-outline-variant/10">
              <span className="material-symbols-outlined text-primary text-xl">schedule</span>
              <div className="font-extrabold text-sm mt-1">{deliveryType === 'delivery' ? '30–45 min' : '15–20 min'}</div>
              <div className="text-[10px] text-secondary font-semibold">Estimated delivery</div>
            </div>
            <div className="p-4 bg-surface-container rounded-2xl flex flex-col items-center text-center gap-1 border border-outline-variant/10">
              <span className="material-symbols-outlined text-primary text-xl">{deliveryType === 'delivery' ? 'local_shipping' : 'storefront'}</span>
              <div className="font-extrabold text-sm mt-1 capitalize">{deliveryType}</div>
              <div className="text-[10px] text-secondary font-semibold">Order type</div>
            </div>
          </div>

          <div className="bg-surface-container-low rounded-2xl p-6 border border-outline-variant/20 text-on-surface">
            <h3 className="text-xs font-extrabold uppercase text-secondary tracking-widest mb-6">Order Progress</h3>
            <div className="relative border-l-2 border-outline-variant/30 ml-3 pl-6 space-y-8">
              {[
                { key: 'Pending', label: 'Order Received', desc: 'The store is reviewing your order details' },
                { key: 'Preparing', label: 'Preparing Bag', desc: 'The shop staff is scanning and packaging your items' },
                { key: 'Ready', label: deliveryType === 'delivery' ? 'Out for Delivery' : 'Ready for Pickup', desc: deliveryType === 'delivery' ? 'Courier agent has picked up your order' : 'Visit the counter for pickup' },
                { key: 'Completed', label: 'Completed', desc: 'Thank you for shopping with StoreFlow!' },
              ].map((step) => {
                const completed = isStatusAtLeast(orderStatus, step.key);
                const active = orderStatus === step.key;
                return (
                  <div key={step.key} className="relative">
                    <div className={`absolute -left-[31px] top-0.5 w-4.5 h-4.5 rounded-full border-4 transition-all duration-300 ${
                      active ? 'bg-primary border-surface-container-low scale-110 shadow' : completed ? 'bg-primary border-primary' : 'bg-surface-container-low border-outline-variant/40'
                    }`} />
                    <div className="space-y-1">
                      <div className={`text-sm font-extrabold ${active ? 'text-primary' : completed ? 'text-on-surface' : 'text-secondary'}`}>{step.label}</div>
                      <div className="text-xs text-secondary leading-relaxed">{step.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <button onClick={() => setScreen('home')} className="w-full py-4 bg-surface-container-low border border-outline-variant/30 text-on-surface font-bold rounded-full cursor-pointer hover:bg-surface-container-high transition-colors flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-lg">home</span>
            <span>Back to Home</span>
          </button>
        </div>
      )}

      {/* ─── 8. Profile Hub Screen ─── */}
      {screen === 'profile' && (
        <div className="max-w-md mx-auto p-6 flex flex-col justify-between min-h-screen text-on-surface">
          <header className="flex items-center gap-3 mb-6">
            <button onClick={() => setScreen('home')} className="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center cursor-pointer active-scale">
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <h1 className="text-lg font-bold">Profile Hub</h1>
          </header>

          <main className="flex-1 space-y-6">
            {/* User credentials */}
            <div className="p-4 bg-surface-container-low rounded-2xl flex items-center gap-4 border border-outline-variant/20">
              <div className="w-14 h-14 bg-primary-container rounded-full flex items-center justify-center font-bold text-on-primary-container text-xl uppercase shadow-sm">
                {profileName ? profileName.slice(0, 2) : 'G'}
              </div>
              <div>
                <h4 className="font-extrabold text-base">{profileName || 'Guest User'}</h4>
                <p className="text-xs text-secondary">{profileEmail || profilePhone || 'Shopping anonymously'}</p>
              </div>
            </div>

            {/* Form actions */}
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-secondary uppercase px-1">Display Name</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  className="w-full px-4 h-12 bg-surface-container-low text-on-surface rounded-xl border border-outline-variant/30 focus:outline-none focus:ring-2 focus:ring-primary text-sm font-semibold"
                />
              </div>

              {/* Dark mode toggler */}
              <div className="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-outline-variant/10">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-lg">dark_mode</span>
                  <span className="text-sm font-semibold">Dark Mode</span>
                </div>
                <input
                  type="checkbox"
                  checked={darkMode}
                  onChange={e => {
                    setDarkMode(e.target.checked);
                    localStorage.setItem('storeflow_dark_mode', String(e.target.checked));
                  }}
                  className="rounded text-primary focus:ring-primary h-5 w-5"
                />
              </div>

              {/* Saved list options */}
              <button onClick={() => { setScreen('history'); loadOrdersHistory(); }} className="w-full p-4 bg-surface-container-low hover:bg-surface-container-high rounded-xl text-left font-semibold text-sm flex items-center justify-between cursor-pointer border border-outline-variant/10 active-scale">
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-lg">receipt_long</span>
                  <span>My Orders History</span>
                </span>
                <span className="material-symbols-outlined text-secondary text-lg">chevron_right</span>
              </button>
            </div>
          </main>

          <footer className="py-6">
            {currentUser ? (
              <button onClick={handleLogout} className="w-full h-14 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl active-scale cursor-pointer">
                Log Out
              </button>
            ) : (
              <button onClick={() => setScreen('login')} className="w-full h-14 bg-on-background text-surface font-bold rounded-xl active-scale cursor-pointer">
                Log In
              </button>
            )}
          </footer>
        </div>
      )}

      {/* ─── 9. Orders History Screen ─── */}
      {screen === 'history' && (
        <div className="max-w-md mx-auto p-6 flex flex-col justify-between min-h-screen text-on-surface">
          <header className="flex items-center gap-3 mb-6">
            <button onClick={() => setScreen('home')} className="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center cursor-pointer active-scale">
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <h1 className="text-lg font-bold">Orders History</h1>
          </header>

          <main className="flex-1 space-y-4 overflow-y-auto">
            {ordersHistory.length === 0 ? (
              <div className="text-center py-12 text-secondary flex flex-col items-center justify-center gap-2">
                <span className="material-symbols-outlined text-4xl text-outline-variant">receipt_long</span>
                <p className="text-sm font-semibold">No orders recorded yet.</p>
              </div>
            ) : (
              ordersHistory.map(o => (
                <div key={o.id} className="p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="font-extrabold text-sm text-on-surface">Order #{o.order_number}</span>
                    <span className="text-xs font-semibold text-secondary">{new Date(o.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-secondary capitalize font-bold">Status: {o.status}</span>
                    <span className="font-bold text-on-background">₦{o.total.toLocaleString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setOrderId(o.id);
                        setOrderNumber(o.order_number);
                        setOrderStatus(o.status);
                        setScreen('tracking');
                      }}
                      className="flex-1 py-2 bg-primary-container text-on-primary-container text-xs font-bold rounded-lg cursor-pointer hover:opacity-90 active-scale"
                    >
                      Track Progress
                    </button>
                  </div>
                </div>
              ))
            )}
          </main>
        </div>
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
                  <span className="text-xl font-extrabold text-primary">{store?.currency || '₦'}{selectedProduct.selling_price.toLocaleString()}</span>
                  <span className={`text-xs font-semibold ${selectedProduct.quantity > 0 ? 'text-primary' : 'text-error'}`}>
                    {selectedProduct.quantity > 0 ? `In Stock (${selectedProduct.quantity} left)` : 'Out of Stock'}
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
                        <span className="text-xs text-secondary mt-0.5 block">₦{item.product.selling_price} each</span>
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
                    disabled={cart.length === 0 || store?.status === 'inactive'}
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

                {deliveryType === 'delivery' && (
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

                <button
                  disabled={!customerName || !customerPhone || (deliveryType === 'delivery' && !deliveryAddress)}
                  onClick={() => setCheckoutStep('payment')}
                  className="w-full bg-primary text-on-primary py-4 rounded-full font-bold shadow-md hover:bg-primary/95 transition-all cursor-pointer disabled:opacity-50"
                >
                  Continue to Payment
                </button>
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
                  {[
                    { key: 'opay', icon: 'phone_android', label: 'OPay Wallet', sub: 'Instant transfer via OPay (08123456789)' },
                    { key: 'transfer', icon: 'credit_card', label: 'Bank Transfer', sub: 'Access Bank: 1234567890 (StoreFlow)' },
                    { key: 'cash', icon: 'payments', label: 'Cash on Pickup / Delivery', sub: 'Pay in cash' }
                  ].map(opt => (
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

    </div>
  );
}

export default App;
