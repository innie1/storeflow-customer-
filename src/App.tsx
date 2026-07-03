import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import jsQR from 'jsqr';
import { parseRoute, parseQRCode } from './router';
import { 
  Search, Plus, Minus, ShoppingBag, X, Check, 
  Phone, ArrowLeft, AlertTriangle, Star,
  Smartphone, CreditCard, ChevronRight, RefreshCw, Camera, Clock, Copy
} from 'lucide-react';

// ─── Type Definitions ────────────────────────────────────────────────────────

interface Product {
  id: string;
  store_id: string;
  category_id?: string;
  name: string;
  description?: string;
  selling_price: number;
  quantity: number;
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
}

interface CartItem {
  product: Product;
  quantity: number;
}

// ─── Demo / Fallback Data ─────────────────────────────────────────────────────

const MOCK_STORE_ID = 'demo';
const MOCK_STORE: Store = {
  id: MOCK_STORE_ID,
  business_name: 'FreshMart Superstore',
  phone: '+234 801 234 5678',
  address: '23 Allen Avenue, Ikeja, Lagos',
  logo: '🛍️',
  currency: '₦',
};

const MOCK_PRODUCTS: Product[] = [
  { id: 'p1', store_id: MOCK_STORE_ID, name: 'Indomie Chicken 70g', description: 'Delicious chicken flavor instant noodles.', selling_price: 480, quantity: 45, category: 'Groceries' },
  { id: 'p2', store_id: MOCK_STORE_ID, name: 'Coca Cola 50cl', description: 'Refreshing carbonated soft drink.', selling_price: 350, quantity: 80, category: 'Drinks' },
  { id: 'p3', store_id: MOCK_STORE_ID, name: 'Golden Penny Semovita 1kg', description: 'Premium quality semolina wheat flour.', selling_price: 850, quantity: 20, category: 'Groceries' },
  { id: 'p4', store_id: MOCK_STORE_ID, name: 'Milo Tin 400g', description: 'Rich chocolate malt beverage powder.', selling_price: 2750, quantity: 15, category: 'Drinks' },
  { id: 'p5', store_id: MOCK_STORE_ID, name: 'Bournvita 500g', description: 'Nutritious cocoa beverage refill pack.', selling_price: 2450, quantity: 12, category: 'Drinks' },
  { id: 'p6', store_id: MOCK_STORE_ID, name: 'Dangote Sugar 1kg', description: 'Pure white granulated cane sugar.', selling_price: 750, quantity: 35, category: 'Groceries' },
  { id: 'p7', store_id: MOCK_STORE_ID, name: 'Oral-B Toothpaste Big', description: 'Extra fresh fluoride toothpaste.', selling_price: 1500, quantity: 8, category: 'Personal Care' },
  { id: 'p8', store_id: MOCK_STORE_ID, name: 'Morning Fresh Dishwashing', description: 'Super grease cutter lemon power.', selling_price: 1800, quantity: 14, category: 'Groceries' },
];

const MOCK_CATEGORIES = ['All', 'Groceries', 'Drinks', 'Personal Care'];

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_ORDER = ['Pending', 'Preparing', 'Ready', 'Completed'];
const isStatusAtLeast = (current: string, target: string) =>
  STATUS_ORDER.indexOf(current) >= STATUS_ORDER.indexOf(target);

// ─── App Component ────────────────────────────────────────────────────────────

function App() {
  // Navigation & Store State
  const [storeId, setStoreId] = useState<string | null>(null);
  const [deepLinkedProductId, setDeepLinkedProductId] = useState<string | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Cart & Modal
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Checkout & Order
  const [checkoutStep, setCheckoutStep] = useState<'shopping' | 'checkout' | 'payment' | 'tracking'>('shopping');
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

  // PWA Install
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // QR Scanner
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);

  // ── QR Scanner Logic ──────────────────────────────────────────────────────

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
      setScanError('Camera access denied. Please allow camera permission and try again.');
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
            const newPath = scannedProduct
              ? `/s/${scannedStore}/p/${scannedProduct}`
              : `/s/${scannedStore}`;
            window.history.pushState({}, '', newPath);
            setDeepLinkedProductId(scannedProduct);
            setStoreId(scannedStore);
          }, 700);
          return;
        }
      }
      scanFrameRef.current = requestAnimationFrame(tick);
    };
    scanFrameRef.current = requestAnimationFrame(tick);
  }, [stopScanner]);

  // ── URL Routing on Mount ──────────────────────────────────────────────────

  useEffect(() => {
    // Handle ?action=scan (PWA shortcut)
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'scan') {
      setLoading(false);
      startScanner();
      return;
    }

    const { storeId: sid, productId: pid } = parseRoute();
    if (sid) {
      setStoreId(sid);
      if (pid) setDeepLinkedProductId(pid);
      loadStoreData(sid);
    } else {
      setLoading(false);
    }
  }, []);

  // ── Deep-link: auto-open product after store loads ────────────────────────

  useEffect(() => {
    if (!deepLinkedProductId || products.length === 0) return;
    const match = products.find(p => p.id === deepLinkedProductId);
    if (match) setSelectedProduct(match);
  }, [deepLinkedProductId, products]);

  // ── PWA Install trigger ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // ── Fetch Store, Products, Categories from Supabase ───────────────────────

  const loadStoreData = async (id: string) => {
    setLoading(true);
    setErrorText(null);
    try {
      const [storeRes, productRes, catRes] = await Promise.all([
        supabase.from('stores').select('*').eq('id', id).maybeSingle(),
        supabase.from('products').select('*').eq('store_id', id).eq('status', 'active'),
        supabase.from('categories').select('name').eq('store_id', id),
      ]);

      if (storeRes.error) throw storeRes.error;

      if (storeRes.data) {
        const prods: Product[] = productRes.data || [];
        let cats = ['All'];
        if (catRes.data && catRes.data.length > 0) {
          cats = ['All', ...catRes.data.map((c: any) => c.name)];
        } else {
          const uniq = Array.from(new Set(prods.map(p => p.category).filter((c): c is string => !!c)));
          cats = ['All', ...uniq];
        }
        setStore(storeRes.data);
        setProducts(prods);
        setCategories(cats);
      } else {
        // Fallback: demo or generic mock
        const isDemo = id === 'demo' || id === 'freshmart-demo-uuid';
        setStore(isDemo ? MOCK_STORE : { id, business_name: `Shop (${id.slice(0, 8)})`, currency: '₦', logo: '🏪', phone: '', address: '' });
        setProducts(MOCK_PRODUCTS.map(p => ({ ...p, store_id: id })));
        setCategories(MOCK_CATEGORIES);
      }
    } catch (err) {
      console.error('Error loading store:', err);
      setErrorText('Could not reach server. Showing demo store.');
      setStore(MOCK_STORE);
      setProducts(MOCK_PRODUCTS);
      setCategories(MOCK_CATEGORIES);
    } finally {
      setLoading(false);
    }
  };

  // ── Real-time order tracking ──────────────────────────────────────────────

  useEffect(() => {
    if (!orderId || checkoutStep !== 'tracking') return;

    const channel = supabase
      .channel('order-updates')
      .on('postgres_changes', {
        event: 'UPDATE', filter: `id=eq.${orderId}`, schema: 'public', table: 'orders'
      }, (payload: any) => {
        if (payload.new?.status) setOrderStatus(payload.new.status);
      })
      .subscribe();

    // Demo simulation
    const interval = setInterval(() => {
      setOrderStatus(cur => {
        if (cur === 'Pending') return 'Preparing';
        if (cur === 'Preparing') return 'Ready';
        if (cur === 'Ready') return 'Completed';
        return cur;
      });
    }, 25000);

    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [orderId, checkoutStep]);

  // ── Cart Operations ───────────────────────────────────────────────────────

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

  // ── Calculations ──────────────────────────────────────────────────────────

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.product.selling_price * i.quantity, 0), [cart]);
  const deliveryFee = useMemo(() => (deliveryType === 'pickup' || subtotal === 0) ? 0 : subtotal >= 5000 ? 0 : 500, [deliveryType, subtotal]);
  const total = subtotal + deliveryFee;
  const totalItemsCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);

  const filteredProducts = useMemo(() => products.filter(p => {
    const ms = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    const mc = selectedCategory === 'All' || p.category === selectedCategory;
    return ms && mc;
  }), [products, searchQuery, selectedCategory]);

  // ── Submit Order ──────────────────────────────────────────────────────────

  const submitOrder = async () => {
    if (!customerName || !customerPhone) return;
    setLoading(true);
    try {
      const genOrderNo = `SF-${Math.floor(100000 + Math.random() * 900000)}`;
      const notes = JSON.stringify({ delivery_type: deliveryType, address: deliveryType === 'delivery' ? deliveryAddress : '', payment_method: paymentMethod, instructions: specialInstructions });

      const { data: newOrder, error: orderErr } = await supabase
        .from('orders')
        .insert({ store_id: store?.id || MOCK_STORE_ID, customer_name: customerName, customer_phone: customerPhone, order_number: genOrderNo, status: 'Pending', subtotal, total, notes })
        .select().single();

      if (orderErr) throw orderErr;
      const oid = newOrder?.id || Date.now().toString();

      await supabase.from('order_items').insert(
        cart.map(item => ({ order_id: oid, product_id: item.product.id, quantity: item.quantity, price: item.product.selling_price, subtotal: item.product.selling_price * item.quantity }))
      );

      setOrderId(oid); setOrderNumber(genOrderNo); setOrderStatus('Pending');
      setCheckoutStep('tracking'); setCart([]);
      localStorage.setItem('storeflow_order_placed', 'true');
      setShowInstallPrompt(true);
    } catch {
      const mockNo = `SF-${Math.floor(100000 + Math.random() * 900000)}`;
      setOrderId('mock-' + Date.now()); setOrderNumber(mockNo); setOrderStatus('Pending');
      setCheckoutStep('tracking'); setCart([]);
      localStorage.setItem('storeflow_order_placed', 'true');
      setShowInstallPrompt(true);
    } finally {
      setLoading(false);
    }
  };

  const triggerInstall = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => { setDeferredPrompt(null); setShowInstallPrompt(false); });
    } else {
      alert('Tap Share / Browser Menu → "Add to Home Screen" to install StoreFlow.');
      setShowInstallPrompt(false);
    }
  };

  const copyOrderNumber = () => {
    navigator.clipboard.writeText(orderNumber).then(() => {
      setOrderCopied(true);
      setTimeout(() => setOrderCopied(false), 2000);
    });
  };

  // ── Loading State ─────────────────────────────────────────────────────────

  if (loading && checkoutStep === 'shopping') {
    return (
      <div className="container animate-fade">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: '20px' }}>
          <div style={{ width: '48px', height: '48px', border: '3px solid var(--bg-secondary)', borderTopColor: 'var(--color-graphite)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>
          <p style={{ fontWeight: '600', color: 'var(--color-text-muted)', fontSize: '14px' }}>Loading store...</p>
        </div>
      </div>
    );
  }

  // ── Scan-First Landing Page ───────────────────────────────────────────────

  if (!storeId) {
    return (
      <div className="container animate-fade" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        {/* Hero */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: '32px', textAlign: 'center' }}>
          
          {/* Brand */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '72px', height: '72px', backgroundColor: 'var(--color-graphite)', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShoppingBag size={36} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontSize: '26px', fontWeight: '900', color: 'var(--color-graphite)', letterSpacing: '-0.5px' }}>StoreFlow</h1>
              <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '2px' }}>Scan. Browse. Order. Done.</p>
            </div>
          </div>

          {/* Primary CTA */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', width: '100%', maxWidth: '280px' }}>
            <button
              id="landing-scan-btn"
              onClick={startScanner}
              style={{
                width: '100%', padding: '18px', backgroundColor: 'var(--color-graphite)',
                color: '#fff', borderRadius: 'var(--radius-md)', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
                fontSize: '16px', fontWeight: '700', cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(47,52,58,0.25)', transition: 'var(--transition-fast)'
              }}
            >
              <Camera size={22} />
              Scan Store QR Code
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--color-border)' }} />
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: '600' }}>OR</span>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--color-border)' }} />
            </div>

            {/* Manual entry */}
            <div style={{ width: '100%', display: 'flex', gap: '8px' }}>
              <input
                className="form-input"
                placeholder="Enter store code..."
                style={{ flex: 1, fontSize: '14px' }}
                onChange={e => {
                  const v = e.target.value.trim();
                  if (v.length > 3) {
                    setStoreId(v);
                    loadStoreData(v);
                  }
                }}
              />
            </div>
          </div>

          {/* Features */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '280px' }}>
            {[
              { icon: '⚡', label: 'Instant — no account needed' },
              { icon: '🛒', label: 'Add items and pay in seconds' },
              { icon: '📦', label: 'Pickup or home delivery' },
            ].map(f => (
              <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', fontSize: '13px', fontWeight: '500' }}>
                <span style={{ fontSize: '16px' }}>{f.icon}</span>
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-text-muted)' }}>
          Powered by <strong>StoreFlow</strong> · No registration required
        </div>

        {/* Scanner Modal */}
        {showScanner && renderScanner()}
      </div>
    );
  }

  // ── Scanner Modal Renderer ─────────────────────────────────────────────────

  function renderScanner() {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 999,
        backgroundColor: 'rgba(0,0,0,0.94)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#fff', fontWeight: '800', fontSize: '18px' }}>Scan QR Code</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>Point at a store or product QR code</div>
          </div>
          <button onClick={stopScanner} style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ position: 'relative', width: '280px', height: '280px' }}>
          {/* Corner brackets */}
          {([{top:0,left:0},{top:0,right:0},{bottom:0,left:0},{bottom:0,right:0}] as any[]).map((pos, i) => (
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
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '12px', opacity: scanSuccess ? 0.4 : 1, transition: 'opacity 0.3s ease' }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {scanSuccess && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Check size={28} color="#fff" />
              </div>
              <span style={{ color: '#22c55e', fontWeight: '700', fontSize: '14px' }}>QR Code Detected!</span>
            </div>
          )}

          {!scanSuccess && !scanError && (
            <div style={{ position: 'absolute', left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, transparent, #fff, transparent)', animation: 'scan-line 2s linear infinite', top: '50%' }} />
          )}
        </div>

        {scanError && (
          <div style={{ marginTop: '24px', padding: '14px 18px', backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'flex-start', gap: '10px', maxWidth: '280px' }}>
            <AlertTriangle size={18} style={{ color: '#ef4444', flexShrink: 0, marginTop: '1px' }} />
            <span style={{ color: '#fca5a5', fontSize: '13px', lineHeight: '1.4' }}>{scanError}</span>
          </div>
        )}

        {!scanError && !scanSuccess && (
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', marginTop: '24px', textAlign: 'center', padding: '0 32px' }}>
            Scanning automatically · Works with store &amp; product QR codes
          </p>
        )}
      </div>
    );
  }

  // ── Main App Shell ────────────────────────────────────────────────────────

  return (
    <div className="container animate-fade">

      {/* ═══ SHOPPING SCREEN ═══════════════════════════════════════════════ */}
      {checkoutStep === 'shopping' && (
        <>
          {/* Header */}
          <header className="header">
            <div style={{ fontSize: '32px', padding: '6px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
              {store?.logo || '🏪'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              <h1 style={{ fontSize: '18px', fontWeight: '800' }}>{store?.business_name}</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: '600' }}>
                <span style={{ color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <span style={{ width: '6px', height: '6px', backgroundColor: 'var(--color-success)', borderRadius: '50%' }}></span> Open
                </span>
                <span>•</span>
                <Clock size={11} />
                <span>{deliveryType === 'delivery' ? '30–45 min' : '15–20 min'}</span>
              </div>
            </div>
          </header>

          {/* Search + Camera */}
          <div className="search-container" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div className="search-input-wrapper" style={{ flexGrow: 1 }}>
              <Search size={18} style={{ color: 'var(--color-text-muted)' }} />
              <input
                className="search-input"
                placeholder="Search products..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && <X size={16} onClick={() => setSearchQuery('')} style={{ cursor: 'pointer' }} />}
            </div>
            <button
              id="scan-qr-btn"
              onClick={startScanner}
              style={{ width: '46px', height: '46px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-graphite)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-sm)', transition: 'var(--transition-fast)' }}
              title="Scan QR Code"
            >
              <Camera size={20} />
            </button>
          </div>

          {/* Category Pills */}
          <div className="categories-scroll">
            {categories.map(cat => (
              <button key={cat} className={`category-pill ${selectedCategory === cat ? 'active' : ''}`} onClick={() => setSelectedCategory(cat)}>
                {cat}
              </button>
            ))}
          </div>

          {/* Error Banner */}
          {errorText && (
            <div style={{ margin: '0 20px 16px 20px', padding: '12px 16px', backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)', borderRadius: 'var(--radius-md)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #ffe082' }}>
              <AlertTriangle size={16} /><span>{errorText}</span>
            </div>
          )}

          {/* Product Grid */}
          <div className="grid-products">
            {filteredProducts.map(p => {
              const qtyInCart = getQty(p.id);
              return (
                <div key={p.id} className="product-card" onClick={() => setSelectedProduct(p)}>
                  <div className="product-image-container">
                    {p.image ? (
                      <img src={p.image} className="product-image" alt={p.name} loading="lazy" />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', backgroundColor: 'var(--bg-tertiary)', fontWeight: '600' }}>
                        {p.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    {p.quantity <= 10 && p.quantity > 0 && (
                      <div style={{ position: 'absolute', top: '8px', left: '8px', backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)', padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: '800' }}>
                        LOW STOCK
                      </div>
                    )}
                  </div>

                  <div className="product-info">
                    <span className="product-category">{p.category || 'General'}</span>
                    <h3 className="product-name">{p.name}</h3>
                  </div>

                  <div className="product-footer" onClick={e => e.stopPropagation()}>
                    <span className="product-price">{store?.currency || '₦'}{p.selling_price.toLocaleString()}</span>
                    {qtyInCart > 0 ? (
                      <div className="qty-adjuster" style={{ border: 'none' }}>
                        <button className="qty-btn" onClick={() => addToCart(p, -1)} style={{ width: '28px', height: '28px', backgroundColor: 'var(--bg-tertiary)' }}><Minus size={12} /></button>
                        <span className="qty-val" style={{ padding: '0 8px', fontSize: '13px' }}>{qtyInCart}</span>
                        <button className="qty-btn" onClick={() => addToCart(p, 1)} style={{ width: '28px', height: '28px', backgroundColor: 'var(--color-graphite)', color: '#fff' }}><Plus size={12} /></button>
                      </div>
                    ) : (
                      <button className="add-btn" onClick={() => addToCart(p, 1)}><Plus size={16} /></button>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredProducts.length === 0 && (
              <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>No products found.</p>
              </div>
            )}
          </div>

          {/* Sticky Cart Bar */}
          {totalItemsCount > 0 && (
            <div className="sticky-cart-bar animate-fade">
              <button className="cart-bar-btn" onClick={() => setIsCartOpen(true)}>
                <div className="cart-bar-details">
                  <span className="cart-badge">{totalItemsCount}</span>
                  <span>View Cart</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '16px', fontWeight: '800' }}>{store?.currency || '₦'}{total.toLocaleString()}</span>
                  <ShoppingBag size={18} />
                </div>
              </button>
            </div>
          )}
        </>
      )}

      {/* ═══ PRODUCT MODAL ═════════════════════════════════════════════════ */}
      {selectedProduct && (
        <div className="bottom-sheet-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="bottom-sheet-content" onClick={e => e.stopPropagation()} style={{ borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
            <div className="sheet-handle"></div>
            <div className="sheet-header" style={{ borderBottom: 'none' }}>
              <span className="product-category">{selectedProduct.category}</span>
              <button onClick={() => setSelectedProduct(null)} style={{ padding: '4px', backgroundColor: 'var(--bg-secondary)', borderRadius: '50%' }}><X size={20} /></button>
            </div>
            <div className="sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 24px 24px 24px' }}>
              <div style={{ width: '100%', height: '240px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {selectedProduct.image ? <img src={selectedProduct.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={selectedProduct.name} /> : <span style={{ fontSize: '64px' }}>📦</span>}
              </div>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: '800', lineHeight: '1.3' }}>{selectedProduct.name}</h2>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
                  <span style={{ fontSize: '22px', fontWeight: '800', color: 'var(--color-graphite)' }}>
                    {store?.currency || '₦'}{selectedProduct.selling_price.toLocaleString()}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: selectedProduct.quantity > 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                    {selectedProduct.quantity > 0 ? `In Stock (${selectedProduct.quantity} left)` : 'Out of Stock'}
                  </span>
                </div>
              </div>
              {selectedProduct.description && (
                <div>
                  <h4 style={{ fontSize: '11px', fontWeight: '700', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Description</h4>
                  <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: '1.6' }}>{selectedProduct.description}</p>
                </div>
              )}
            </div>
            <div className="sheet-footer" style={{ borderTop: 'none' }}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                {getQty(selectedProduct.id) > 0 ? (
                  <div className="qty-adjuster" style={{ flexGrow: 1, justifyContent: 'space-between', padding: '4px' }}>
                    <button className="qty-btn" onClick={() => addToCart(selectedProduct, -1)} style={{ width: '48px', height: '48px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '50%' }}><Minus size={16} /></button>
                    <span className="qty-val" style={{ fontSize: '16px' }}>{getQty(selectedProduct.id)}</span>
                    <button className="qty-btn" onClick={() => addToCart(selectedProduct, 1)} style={{ width: '48px', height: '48px', backgroundColor: 'var(--color-graphite)', color: '#fff', borderRadius: '50%' }}><Plus size={16} /></button>
                  </div>
                ) : (
                  <button className="btn-primary" style={{ flexGrow: 1 }} disabled={selectedProduct.quantity <= 0} onClick={() => { addToCart(selectedProduct, 1); setSelectedProduct(null); }}>
                    <span>Add to Cart</span><ChevronRight size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CART DRAWER ═══════════════════════════════════════════════════ */}
      {isCartOpen && checkoutStep === 'shopping' && (
        <div className="bottom-sheet-overlay" onClick={() => setIsCartOpen(false)}>
          <div className="bottom-sheet-content" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle"></div>
            <div className="sheet-header">
              <span className="sheet-title">My Cart ({totalItemsCount})</span>
              <button onClick={() => setIsCartOpen(false)} style={{ padding: '4px', backgroundColor: 'var(--bg-secondary)', borderRadius: '50%' }}><X size={20} /></button>
            </div>
            <div className="sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {cart.map(item => (
                <div key={item.product.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ width: '56px', height: '56px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                    {item.product.image ? <img src={item.product.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : '📦'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: '2px' }}>
                    <h4 style={{ fontSize: '13px', fontWeight: '700' }}>{item.product.name}</h4>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{store?.currency || '₦'}{item.product.selling_price} each</span>
                  </div>
                  <div className="qty-adjuster">
                    <button className="qty-btn" style={{ width: '28px', height: '28px' }} onClick={() => addToCart(item.product, -1)}><Minus size={10} /></button>
                    <span className="qty-val" style={{ padding: '0 6px', fontSize: '12px' }}>{item.quantity}</span>
                    <button className="qty-btn" style={{ width: '28px', height: '28px' }} onClick={() => addToCart(item.product, 1)}><Plus size={10} /></button>
                  </div>
                </div>
              ))}
              {cart.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
                  <div style={{ fontSize: '40px', marginBottom: '8px' }}>🛒</div>
                  <p style={{ fontSize: '14px', fontWeight: '600' }}>Your cart is empty.</p>
                </div>
              )}
            </div>
            <div className="sheet-footer">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                  <span>Subtotal</span><span>{store?.currency || '₦'}{subtotal.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                  <span>Delivery Fee</span><span>{deliveryFee === 0 ? 'FREE' : `${store?.currency || '₦'}${deliveryFee}`}</span>
                </div>
                <div style={{ height: '1px', backgroundColor: 'var(--color-border)' }}></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: '800' }}>
                  <span>Total</span><span>{store?.currency || '₦'}{total.toLocaleString()}</span>
                </div>
              </div>
              <button className="btn-primary" disabled={cart.length === 0} onClick={() => { setIsCartOpen(false); setCheckoutStep('checkout'); }}>
                <span>Continue to Checkout</span><ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ GUEST CHECKOUT ════════════════════════════════════════════════ */}
      {checkoutStep === 'checkout' && (
        <div className="animate-fade" style={{ padding: '24px 20px', paddingBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <button onClick={() => setCheckoutStep('shopping')} style={{ padding: '8px', backgroundColor: 'var(--bg-secondary)', borderRadius: '50%' }}><ArrowLeft size={18} /></button>
            <h1 style={{ fontSize: '18px', fontWeight: '800' }}>Guest Checkout</h1>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label">Order Option</label>
              <div className="toggle-group">
                <button className={`toggle-option ${deliveryType === 'pickup' ? 'active' : ''}`} onClick={() => setDeliveryType('pickup')}>Store Pickup</button>
                <button className={`toggle-option ${deliveryType === 'delivery' ? 'active' : ''}`} onClick={() => setDeliveryType('delivery')}>Home Delivery</button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" placeholder="Enter your name" value={customerName} onChange={e => setCustomerName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input className="form-input" type="tel" placeholder="e.g. 08123456789" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
            </div>
            {deliveryType === 'delivery' && (
              <div className="form-group animate-slide-down">
                <label className="form-label">Delivery Address</label>
                <textarea className="form-input" rows={3} placeholder="Enter full street address" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} style={{ resize: 'none' }} />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Special Instructions (Optional)</label>
              <textarea className="form-input" rows={2} placeholder="e.g. Leave at door" value={specialInstructions} onChange={e => setSpecialInstructions(e.target.value)} style={{ resize: 'none' }} />
            </div>
            <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '16px', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--color-text-muted)' }}><span>Subtotal</span><span>{store?.currency || '₦'}{subtotal.toLocaleString()}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--color-text-muted)' }}><span>Delivery Fee</span><span>{deliveryFee === 0 ? 'FREE' : `${store?.currency || '₦'}${deliveryFee}`}</span></div>
              <div style={{ height: '1px', backgroundColor: 'var(--color-border)' }}></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: '800' }}><span>Order Total</span><span>{store?.currency || '₦'}{total.toLocaleString()}</span></div>
            </div>
            <button className="btn-primary" disabled={!customerName || !customerPhone || (deliveryType === 'delivery' && !deliveryAddress)} onClick={() => setCheckoutStep('payment')}>
              <span>Continue to Payment</span><ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ═══ PAYMENT SCREEN ════════════════════════════════════════════════ */}
      {checkoutStep === 'payment' && (
        <div className="animate-fade" style={{ padding: '24px 20px', paddingBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <button onClick={() => setCheckoutStep('checkout')} style={{ padding: '8px', backgroundColor: 'var(--bg-secondary)', borderRadius: '50%' }}><ArrowLeft size={18} /></button>
            <h1 style={{ fontSize: '18px', fontWeight: '800' }}>Select Payment</h1>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* OPay */}
            {[
              { key: 'opay', icon: <Smartphone size={24} />, label: 'OPay Wallet', sub: 'Fast online transaction via OPay', detail: <span>Send to: <strong style={{ color: 'var(--color-text)' }}>08123456789</strong> (OPay – StoreFlow Mart)</span> },
              { key: 'transfer', icon: <CreditCard size={24} />, label: 'Bank Transfer', sub: 'Transfer details will be provided', detail: <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span>Bank: <strong style={{ color: 'var(--color-text)' }}>Access Bank</strong></span><span>Account: <strong style={{ color: 'var(--color-text)' }}>1234567890</strong></span><span>Name: <strong style={{ color: 'var(--color-text)' }}>StoreFlow Mart Ltd</strong></span></div> },
              { key: 'cash', icon: <ShoppingBag size={24} />, label: deliveryType === 'delivery' ? 'Cash on Delivery' : 'Cash on Pickup', sub: 'Pay at the counter or to the rider', detail: null },
            ].map(opt => (
              <div key={opt.key} style={{ padding: '16px', borderRadius: 'var(--radius-md)', border: `2px solid ${paymentMethod === opt.key ? 'var(--color-graphite)' : 'var(--color-border)'}`, display: 'flex', flexDirection: 'column', gap: '12px', cursor: 'pointer', backgroundColor: paymentMethod === opt.key ? 'var(--color-graphite-ultra-light)' : 'transparent' }} onClick={() => setPaymentMethod(opt.key as any)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ color: 'var(--color-text)' }}>{opt.icon}</span>
                  <div style={{ flexGrow: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '700' }}>{opt.label}</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{opt.sub}</div>
                  </div>
                  <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: '2px solid var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px' }}>
                    {paymentMethod === opt.key && <div style={{ width: '100%', height: '100%', backgroundColor: 'var(--color-graphite)', borderRadius: '50%' }}></div>}
                  </div>
                </div>
                {paymentMethod === opt.key && opt.detail && (
                  <div className="animate-slide-down" style={{ padding: '12px', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                    {opt.detail}
                  </div>
                )}
              </div>
            ))}

            <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '16px', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Recipient</span><span style={{ fontWeight: '600', color: 'var(--color-text)' }}>{customerName}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Delivery Type</span><span style={{ textTransform: 'capitalize', fontWeight: '600', color: 'var(--color-text)' }}>{deliveryType}</span></div>
              <div style={{ height: '1px', backgroundColor: 'var(--color-border)', margin: '4px 0' }}></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: '800', color: 'var(--color-text)' }}><span>Amount to Pay</span><span>{store?.currency || '₦'}{total.toLocaleString()}</span></div>
            </div>

            <button className="btn-primary" onClick={submitOrder}>
              <Check size={18} /><span>Confirm Order</span>
            </button>
          </div>
        </div>
      )}

      {/* ═══ ORDER SUCCESS & TRACKING ═══════════════════════════════════════ */}
      {checkoutStep === 'tracking' && (
        <div className="animate-scale" style={{ padding: '32px 20px', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '48px' }}>
          
          {/* Success Badge */}
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
            <div style={{ width: '72px', height: '72px', borderRadius: '50%', backgroundColor: 'var(--color-success-bg)', color: 'var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', marginBottom: '4px' }}>✓</div>
            <h1 style={{ fontSize: '22px', fontWeight: '800' }}>Order Placed! 🎉</h1>
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>Your order has been sent to {store?.business_name}.</p>
          </div>

          {/* Order Number Card */}
          <div style={{ backgroundColor: 'var(--color-graphite)', borderRadius: 'var(--radius-lg)', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '600', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Order Reference</div>
              <div style={{ fontSize: '22px', fontWeight: '900', color: '#fff', letterSpacing: '1px' }}>#{orderNumber}</div>
            </div>
            <button onClick={copyOrderNumber} style={{ padding: '10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '600' }}>
              {orderCopied ? <Check size={16} /> : <Copy size={16} />}
              {orderCopied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Estimated Time */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1, padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', textAlign: 'center' }}>
              <Clock size={20} style={{ color: 'var(--color-graphite)' }} />
              <div style={{ fontSize: '13px', fontWeight: '800' }}>{deliveryType === 'delivery' ? '30–45 min' : '15–20 min'}</div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Estimated time</div>
            </div>
            <div style={{ flex: 1, padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', textAlign: 'center' }}>
              <div style={{ fontSize: '20px' }}>{deliveryType === 'delivery' ? '🛵' : '🏪'}</div>
              <div style={{ fontSize: '13px', fontWeight: '800', textTransform: 'capitalize' }}>{deliveryType}</div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Order type</div>
            </div>
          </div>

          {/* Tracking Timeline */}
          <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: '24px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: '20px', letterSpacing: '0.06em' }}>Order Progress</h3>
            <div className="tracking-timeline">
              {[
                { key: 'Pending', label: 'Order Received', desc: 'We have received your order request' },
                { key: 'Preparing', label: 'Preparing', desc: 'The store team is packaging your items' },
                { key: 'Ready', label: deliveryType === 'delivery' ? 'Out for Delivery' : 'Ready for Pickup', desc: deliveryType === 'delivery' ? 'Our delivery agent is on the way' : 'Your bag is ready at the pickup desk' },
                { key: 'Completed', label: 'Completed', desc: 'Thank you for shopping with StoreFlow!' },
              ].map(step => (
                <div key={step.key} className={`tracking-step ${isStatusAtLeast(orderStatus, step.key) ? 'completed' : ''} ${orderStatus === step.key ? 'active' : ''}`}>
                  <div className="tracking-node"></div>
                  <span className="tracking-label">{step.label}</span>
                  <span className="tracking-time">{step.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Store Contact */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {store?.address && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '12px 16px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Store Location</span>
                <span style={{ fontWeight: '600' }}>{store.address}</span>
              </div>
            )}
            {store?.phone && (
              <a href={`tel:${store.phone}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px', border: '1.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '13px', fontWeight: '700', textDecoration: 'none', color: 'var(--color-text)' }}>
                <Phone size={16} /><span>Call Store — {store.phone}</span>
              </a>
            )}
          </div>

          {/* Install Prompt */}
          {showInstallPrompt && (
            <div className="install-card animate-slide-up">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
                <div style={{ fontSize: '36px', lineHeight: 1 }}>🚀</div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '4px' }}>Enjoyed shopping?</h3>
                  <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>Install StoreFlow for a faster experience.</p>
                </div>
              </div>
              <div className="install-features">
                {['Faster checkout', 'Reward points', 'Saved orders', 'Member discounts', 'Order history'].map(f => (
                  <div key={f} className="install-feature-item">
                    <Star size={12} style={{ color: '#f59e0b', fill: '#f59e0b' }} />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button className="toggle-option" style={{ border: '1px solid var(--color-border)', fontSize: '12px' }} onClick={() => setShowInstallPrompt(false)}>
                  Maybe Later
                </button>
                <button className="btn-primary" style={{ flexGrow: 1, padding: '10px' }} onClick={triggerInstall}>
                  <Smartphone size={16} /><span>Install StoreFlow</span>
                </button>
              </div>
            </div>
          )}

          {/* Order Again */}
          <button className="btn-primary" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--color-text)', border: '1.5px solid var(--color-border)', boxShadow: 'none' }}
            onClick={() => { setCheckoutStep('shopping'); setOrderId(null); setCart([]); }}>
            <RefreshCw size={16} /><span>Order Again</span>
          </button>
        </div>
      )}

      {/* ═══ QR SCANNER (in-store) ══════════════════════════════════════════ */}
      {showScanner && renderScanner()}
    </div>
  );
}

export default App;
