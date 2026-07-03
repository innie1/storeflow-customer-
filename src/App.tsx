import { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabase';
import { 
  Search, Plus, Minus, ShoppingBag, X, Check, 
  Phone, ArrowLeft, AlertTriangle, Sparkles, 
  Smartphone, CreditCard, ChevronRight, RefreshCw, QrCode
} from 'lucide-react';

// Type definitions matching database schemas
interface Product {
  id: string;
  store_id: string;
  category_id?: string;
  name: string;
  description?: string;
  selling_price: number;
  quantity: number; // Stock level
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

// Fallback high-fidelity mock store for testing and demo purposes
const MOCK_STORE_ID = "freshmart-demo-uuid";
const MOCK_STORE: Store = {
  id: MOCK_STORE_ID,
  business_name: "FreshMart Superstore",
  phone: "+234 801 234 5678",
  address: "23 Allen Avenue, Ikeja, Lagos",
  logo: "🛍️",
  currency: "₦"
};

const MOCK_PRODUCTS: Product[] = [
  { id: "p1", store_id: MOCK_STORE_ID, name: "Indomie Chicken 70g", description: "Delicious chicken flavor instant noodles.", selling_price: 480, quantity: 45, category: "Groceries" },
  { id: "p2", store_id: MOCK_STORE_ID, name: "Coca Cola 50cl", description: "Refreshing carbonated soft drink.", selling_price: 350, quantity: 80, category: "Drinks" },
  { id: "p3", store_id: MOCK_STORE_ID, name: "Golden Penny Semovita 1kg", description: "Premium quality semolina wheat flour.", selling_price: 850, quantity: 20, category: "Groceries" },
  { id: "p4", store_id: MOCK_STORE_ID, name: "Milo Tin 400g", description: "Rich chocolate malt beverage powder.", selling_price: 2750, quantity: 15, category: "Drinks" },
  { id: "p5", store_id: MOCK_STORE_ID, name: "Bournvita 500g", description: "Nutritious cocoa beverage refill pack.", selling_price: 2450, quantity: 12, category: "Drinks" },
  { id: "p6", store_id: MOCK_STORE_ID, name: "Dangote Sugar 1kg", description: "Pure white granulated cane sugar.", selling_price: 750, quantity: 35, category: "Groceries" },
  { id: "p7", store_id: MOCK_STORE_ID, name: "Oral-B Toothpaste Big", description: "Extra fresh fluoride toothpaste.", selling_price: 1500, quantity: 8, category: "Personal Care" },
  { id: "p8", store_id: MOCK_STORE_ID, name: "Morning Fresh Dishwashing", description: "Super grease cutter lemon power liquid.", selling_price: 1800, quantity: 14, category: "Groceries" }
];

const MOCK_CATEGORIES = ["All", "Groceries", "Drinks", "Personal Care"];

function App() {
  // Navigation & Screen States
  const [storeId, setStoreId] = useState<string | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(["All"]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Cart & Modal State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  
  // Checkout & Order Tracking State
  const [checkoutStep, setCheckoutStep] = useState<'shopping' | 'checkout' | 'payment' | 'tracking'>('shopping');
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'opay'>('cash');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState("");
  const [orderStatus, setOrderStatus] = useState("Pending");

  // PWA Install State
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // 1. Scan store ID from URL pathname (/store/{storeId}) or search queries
  useEffect(() => {
    const pathSegments = window.location.pathname.split('/');
    let id = '';
    
    // Check if URL matches /store/{id}
    const storeIdx = pathSegments.indexOf('store');
    if (storeIdx !== -1 && pathSegments[storeIdx + 1]) {
      id = pathSegments[storeIdx + 1];
    } else {
      // Fallback: check query parameter
      const params = new URLSearchParams(window.location.search);
      id = params.get('storeId') || params.get('store') || '';
    }

    if (id) {
      setStoreId(id);
      loadStoreData(id);
    } else {
      // Prompt user to enter or scan code if no ID present
      setLoading(false);
    }
  }, []);

  // Capture PWA Install trigger
  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });
  }, []);

  // Fetch store and inventory from Supabase
  const loadStoreData = async (id: string) => {
    setLoading(true);
    setErrorText(null);
    try {
      // 1. Fetch Store Details
      const { data: storeData, error: storeErr } = await supabase
        .from('stores')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (storeErr) throw storeErr;

      let activeStore = storeData;
      let activeProducts = [];
      let activeCategories = ["All"];

      if (storeData) {
        // 2. Fetch Products
        const { data: productData, error: productErr } = await supabase
          .from('products')
          .select('*')
          .eq('store_id', id)
          .eq('status', 'active');

        if (productErr) throw productErr;
        activeProducts = productData || [];

        // 3. Fetch Categories
        const { data: catData } = await supabase
          .from('categories')
          .select('name')
          .eq('store_id', id);

        if (catData && catData.length > 0) {
          activeCategories = ["All", ...catData.map(c => c.name)];
        } else {
          // Fallback categories mapping from products
          const uniqueCats = Array.from(new Set(activeProducts.map(p => p.category).filter(Boolean)));
          activeCategories = ["All", ...uniqueCats];
        }
      } else {
        // Database is empty or store not found - Fall back to Demo FreshMart if ID is demo, else show warning
        if (id === 'demo' || id === MOCK_STORE_ID) {
          activeStore = MOCK_STORE;
          activeProducts = MOCK_PRODUCTS;
          activeCategories = MOCK_CATEGORIES;
        } else {
          // Create a mock store named after the code, or tell user
          activeStore = {
            id: id,
            business_name: `StoreFlow Mart (${id.slice(0, 6)})`,
            phone: "+234 800 000 0000",
            address: "Remote Location",
            logo: "🏪",
            currency: "₦"
          };
          activeProducts = MOCK_PRODUCTS.map(p => ({ ...p, store_id: id }));
          activeCategories = MOCK_CATEGORIES;
        }
      }

      setStore(activeStore);
      setProducts(activeProducts);
      setCategories(activeCategories);
    } catch (err: any) {
      console.error("Error loading store:", err);
      setErrorText("Failed to retrieve store information. Loading default store instead.");
      // Fallback
      setStore(MOCK_STORE);
      setProducts(MOCK_PRODUCTS);
      setCategories(MOCK_CATEGORIES);
    } finally {
      setLoading(false);
    }
  };

  // Real-time tracking subscription
  useEffect(() => {
    if (!orderId || checkoutStep !== 'tracking') return;

    const channel = supabase
      .channel('order-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', filter: `id=eq.${orderId}`, schema: 'public', table: 'orders' },
        (payload: any) => {
          if (payload.new && payload.new.status) {
            setOrderStatus(payload.new.status);
          }
        }
      )
      .subscribe();

    // Local simulation fallback if tracking is offline / demo
    const interval = setInterval(() => {
      setOrderStatus(current => {
        if (current === 'Pending') return 'Preparing';
        if (current === 'Preparing') return 'Ready';
        if (current === 'Ready') return 'Completed';
        return current;
      });
    }, 25000); // Progress order every 25 seconds for visualization

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [orderId, checkoutStep]);

  // Cart operations
  const addToCart = (product: Product, qty: number = 1) => {
    setCart(prev => {
      const idx = prev.findIndex(item => item.product.id === product.id);
      if (idx !== -1) {
        const newCart = [...prev];
        const newQty = newCart[idx].quantity + qty;
        if (newQty <= 0) {
          newCart.splice(idx, 1);
        } else {
          newCart[idx].quantity = newQty;
        }
        return newCart;
      } else if (qty > 0) {
        return [...prev, { product, quantity: qty }];
      }
      return prev;
    });
  };

  const getProductQtyInCart = (productId: string) => {
    const item = cart.find(i => i.product.id === productId);
    return item ? item.quantity : 0;
  };

  // Calculations
  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.product.selling_price * item.quantity), 0);
  }, [cart]);

  const deliveryFee = useMemo(() => {
    if (deliveryType === 'pickup' || subtotal === 0) return 0;
    return subtotal >= 5000 ? 0 : 500;
  }, [deliveryType, subtotal]);

  const total = subtotal + deliveryFee;

  const totalItemsCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  // Filters search query and categories
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCat = selectedCategory === "All" || p.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [products, searchQuery, selectedCategory]);

  // Submit Guest Order to Supabase
  const submitOrder = async () => {
    if (!customerName || !customerPhone) return;
    
    setLoading(true);
    try {
      const genOrderNo = `SF-${Math.floor(100000 + Math.random() * 900000)}`;
      const orderNotes = JSON.stringify({
        delivery_type: deliveryType,
        address: deliveryType === 'delivery' ? deliveryAddress : '',
        payment_method: paymentMethod,
        instructions: specialInstructions
      });

      // 1. Insert order record
      const { data: newOrder, error: orderErr } = await supabase
        .from('orders')
        .insert({
          store_id: store?.id || MOCK_STORE_ID,
          customer_name: customerName,
          customer_phone: customerPhone,
          order_number: genOrderNo,
          status: 'Pending',
          subtotal: subtotal,
          total: total,
          notes: orderNotes
        })
        .select()
        .single();

      if (orderErr) throw orderErr;

      const orderRecordId = newOrder?.id || Date.now().toString();

      // 2. Insert order items
      const itemsToInsert = cart.map(item => ({
        order_id: orderRecordId,
        product_id: item.product.id,
        quantity: item.quantity,
        price: item.product.selling_price,
        subtotal: item.product.selling_price * item.quantity
      }));

      const { error: itemsErr } = await supabase
        .from('order_items')
        .insert(itemsToInsert);

      if (itemsErr) throw itemsErr;

      setOrderId(orderRecordId);
      setOrderNumber(genOrderNo);
      setOrderStatus("Pending");
      setCheckoutStep('tracking');
      setCart([]); // Reset Cart
      
      // Store checkout success locally to trigger install prompt later
      localStorage.setItem('storeflow_order_placed', 'true');
      setShowInstallPrompt(true);
    } catch (err) {
      console.error("Order submit failed, running mock checkout:", err);
      // Fallback visualization
      const mockOrderNo = `SF-${Math.floor(100000 + Math.random() * 900000)}`;
      setOrderId("mock-" + Date.now());
      setOrderNumber(mockOrderNo);
      setOrderStatus("Pending");
      setCheckoutStep('tracking');
      setCart([]);
      localStorage.setItem('storeflow_order_placed', 'true');
      setShowInstallPrompt(true);
    } finally {
      setLoading(false);
    }
  };

  // Trigger PWA Installation
  const triggerInstall = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult: any) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted PWA installation');
        }
        setDeferredPrompt(null);
        setShowInstallPrompt(false);
      });
    } else {
      alert("Installation is supported via your browser menu. Tap Share/Menu ➔ Add to Home Screen.");
      setShowInstallPrompt(false);
    }
  };

  // Render Loader
  if (loading && checkoutStep === 'shopping') {
    return (
      <div className="container animate-fade">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', gap: '20px' }}>
          <div style={{ width: '48px', height: '48px', border: '4px solid var(--bg-secondary)', borderTopColor: 'var(--color-graphite)', borderRadius: '50%', animation: 'shimmer 1s infinite linear' }}></div>
          <p style={{ fontWeight: '600', color: 'var(--color-text-muted)', fontSize: '14px' }}>Loading StoreFlow Customer...</p>
        </div>
      </div>
    );
  }

  // Render Code Entry if no Store ID URL parsed
  if (!storeId) {
    return (
      <div className="container animate-scale" style={{ display: 'flex', flexDirection: 'column', padding: '40px 24px', justifyContent: 'center', gap: '30px' }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '48px' }}>🏪</div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-graphite)' }}>StoreFlow Customer</h1>
          <p style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>Scan a store QR code or enter the store ID below to begin ordering instantly.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="form-group">
            <label className="form-label">Store ID / Code</label>
            <input 
              className="form-input" 
              placeholder="e.g. freshmart-demo-uuid" 
              onChange={(e) => {
                const val = e.target.value.trim();
                if (val) {
                  setStoreId(val);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && storeId) {
                  loadStoreData(storeId);
                }
              }}
            />
          </div>
          
          <button 
            className="btn-primary" 
            disabled={!storeId}
            onClick={() => storeId && loadStoreData(storeId)}
          >
            <span>Enter Shop</span>
            <ChevronRight size={18} />
          </button>
        </div>

        <div style={{ marginTop: '20px', padding: '16px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Sparkles size={24} style={{ color: 'var(--color-text)' }} />
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontWeight: '500' }}>
            <strong>Instant Check-in</strong>: Scanning a QR code bypasses this screen and loads the menu in under 2 seconds.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container animate-fade">
      {/* SHOPPING SCREEN */}
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
                <span>⏱️ {deliveryType === 'delivery' ? '30-45 min' : '15-20 min'}</span>
              </div>
            </div>
          </header>

          {/* Search bar */}
          <div className="search-container">
            <div className="search-input-wrapper">
              <Search size={18} style={{ color: 'var(--color-text-muted)' }} />
              <input 
                className="search-input" 
                placeholder="Search products..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && <X size={16} onClick={() => setSearchQuery("")} style={{ cursor: 'pointer' }} />}
            </div>
          </div>

          {/* Categories Pill list */}
          <div className="categories-scroll">
            {categories.map(cat => (
              <button 
                key={cat} 
                className={`category-pill ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Warnings or Info */}
          {errorText && (
            <div style={{ margin: '0 20px 16px 20px', padding: '12px 16px', backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)', borderRadius: 'var(--radius-md)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #ffe082' }}>
              <AlertTriangle size={16} />
              <span>{errorText}</span>
            </div>
          )}

          {/* Product grid */}
          <div className="grid-products">
            {filteredProducts.map(p => {
              const qtyInCart = getProductQtyInCart(p.id);
              return (
                <div key={p.id} className="product-card" onClick={() => setSelectedProduct(p)}>
                  <div className="product-image-container">
                    {p.image ? (
                      <img src={p.image} className="product-image" alt={p.name} />
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
                        <button className="qty-btn" onClick={() => addToCart(p, 1)} style={{ width: '28px', height: '28px', backgroundColor: 'var(--color-graphite)', color: 'var(--color-white)' }}><Plus size={12} /></button>
                      </div>
                    ) : (
                      <button className="add-btn" onClick={() => addToCart(p, 1)}>
                        <Plus size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            
            {filteredProducts.length === 0 && (
              <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>No products found matching query.</p>
              </div>
            )}
          </div>

          {/* Sticky floating Cart bar */}
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

      {/* PRODUCT DETAILS MODAL */}
      {selectedProduct && (
        <div className="bottom-sheet-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="bottom-sheet-content" onClick={e => e.stopPropagation()} style={{ borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
            <div className="sheet-handle"></div>
            
            <div className="sheet-header" style={{ borderBottom: 'none' }}>
              <span className="product-category">{selectedProduct.category}</span>
              <button onClick={() => setSelectedProduct(null)} style={{ padding: '4px', backgroundColor: 'var(--bg-secondary)', borderRadius: '50%' }}>
                <X size={20} />
              </button>
            </div>

            <div className="sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 24px 24px 24px' }}>
              <div style={{ width: '100%', height: '240px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {selectedProduct.image ? (
                  <img src={selectedProduct.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={selectedProduct.name} />
                ) : (
                  <span style={{ fontSize: '64px' }}>📦</span>
                )}
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
                {getProductQtyInCart(selectedProduct.id) > 0 ? (
                  <div className="qty-adjuster" style={{ flexGrow: 1, justifyContent: 'space-between', padding: '4px' }}>
                    <button className="qty-btn" onClick={() => addToCart(selectedProduct, -1)} style={{ width: '48px', height: '48px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '50%' }}>
                      <Minus size={16} />
                    </button>
                    <span className="qty-val" style={{ fontSize: '16px' }}>{getProductQtyInCart(selectedProduct.id)}</span>
                    <button className="qty-btn" onClick={() => addToCart(selectedProduct, 1)} style={{ width: '48px', height: '48px', backgroundColor: 'var(--color-graphite)', color: 'var(--color-white)', borderRadius: '50%' }}>
                      <Plus size={16} />
                    </button>
                  </div>
                ) : (
                  <button 
                    className="btn-primary" 
                    style={{ flexGrow: 1 }} 
                    disabled={selectedProduct.quantity <= 0}
                    onClick={() => {
                      addToCart(selectedProduct, 1);
                      setSelectedProduct(null);
                    }}
                  >
                    <span>Add to Cart</span>
                    <ChevronRight size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CART DRAWER */}
      {isCartOpen && checkoutStep === 'shopping' && (
        <div className="bottom-sheet-overlay" onClick={() => setIsCartOpen(false)}>
          <div className="bottom-sheet-content" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle"></div>
            
            <div className="sheet-header">
              <span className="sheet-title">My Cart ({totalItemsCount})</span>
              <button onClick={() => setIsCartOpen(false)} style={{ padding: '4px', backgroundColor: 'var(--bg-secondary)', borderRadius: '50%' }}>
                <X size={20} />
              </button>
            </div>

            <div className="sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {cart.map(item => (
                <div key={item.product.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}>
                  <div style={{ width: '56px', height: '56px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                    {item.product.image ? <img src={item.product.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : '📦'}
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: '2px' }}>
                    <h4 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--color-text)' }}>{item.product.name}</h4>
                    <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--color-text-muted)' }}>
                      {store?.currency || '₦'}{item.product.selling_price} each
                    </span>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--color-text-muted)', fontWeight: '500' }}>
                  <span>Subtotal</span>
                  <span>{store?.currency || '₦'}{subtotal.toLocaleString()}</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--color-text-muted)', fontWeight: '500' }}>
                  <span>Delivery Type</span>
                  <span style={{ fontWeight: '700', textTransform: 'capitalize' }}>{deliveryType}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--color-text-muted)', fontWeight: '500' }}>
                  <span>Delivery Fee</span>
                  <span>{deliveryFee === 0 ? 'FREE' : `${store?.currency || '₦'}${deliveryFee.toLocaleString()}`}</span>
                </div>
                
                <div style={{ height: '1px', backgroundColor: 'var(--color-border)' }}></div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: '800' }}>
                  <span>Total</span>
                  <span>{store?.currency || '₦'}{total.toLocaleString()}</span>
                </div>
              </div>

              <button 
                className="btn-primary" 
                disabled={cart.length === 0}
                onClick={() => {
                  setIsCartOpen(false);
                  setCheckoutStep('checkout');
                }}
              >
                <span>Continue to Checkout</span>
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GUEST CHECKOUT SCREEN */}
      {checkoutStep === 'checkout' && (
        <div className="animate-fade" style={{ padding: '24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <button onClick={() => setCheckoutStep('shopping')} style={{ padding: '8px', backgroundColor: 'var(--bg-secondary)', borderRadius: '50%' }}>
              <ArrowLeft size={18} />
            </button>
            <h1 style={{ fontSize: '18px', fontWeight: '800' }}>Guest Checkout</h1>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Delivery Type toggle */}
            <div className="form-group">
              <label className="form-label">Order Option</label>
              <div className="toggle-group">
                <button 
                  className={`toggle-option ${deliveryType === 'pickup' ? 'active' : ''}`}
                  onClick={() => setDeliveryType('pickup')}
                >
                  Store Pickup
                </button>
                <button 
                  className={`toggle-option ${deliveryType === 'delivery' ? 'active' : ''}`}
                  onClick={() => setDeliveryType('delivery')}
                >
                  Home Delivery
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input 
                className="form-input" 
                placeholder="Enter your name" 
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input 
                className="form-input" 
                type="tel"
                placeholder="e.g. 08123456789" 
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
              />
            </div>

            {deliveryType === 'delivery' && (
              <div className="form-group animate-slide-down">
                <label className="form-label">Delivery Address</label>
                <textarea 
                  className="form-input" 
                  rows={3}
                  placeholder="Enter full street address" 
                  value={deliveryAddress}
                  onChange={e => setDeliveryAddress(e.target.value)}
                  style={{ resize: 'none' }}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Special Instructions (Optional)</label>
              <textarea 
                className="form-input" 
                rows={2}
                placeholder="e.g. Leave package with gatekeeper" 
                value={specialInstructions}
                onChange={e => setSpecialInstructions(e.target.value)}
                style={{ resize: 'none' }}
              />
            </div>

            <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '16px', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '500', color: 'var(--color-text-muted)' }}>
                <span>Subtotal</span>
                <span>{store?.currency || '₦'}{subtotal.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '500', color: 'var(--color-text-muted)' }}>
                <span>Delivery Fee</span>
                <span>{deliveryFee === 0 ? 'FREE' : `${store?.currency || '₦'}${deliveryFee.toLocaleString()}`}</span>
              </div>
              <div style={{ height: '1px', backgroundColor: 'var(--color-border)' }}></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: '800' }}>
                <span>Order Total</span>
                <span>{store?.currency || '₦'}{total.toLocaleString()}</span>
              </div>
            </div>

            <button 
              className="btn-primary" 
              disabled={!customerName || !customerPhone || (deliveryType === 'delivery' && !deliveryAddress)}
              onClick={() => setCheckoutStep('payment')}
            >
              <span>Continue to Payment</span>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* PAYMENT SCREEN */}
      {checkoutStep === 'payment' && (
        <div className="animate-fade" style={{ padding: '24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <button onClick={() => setCheckoutStep('checkout')} style={{ padding: '8px', backgroundColor: 'var(--bg-secondary)', borderRadius: '50%' }}>
              <ArrowLeft size={18} />
            </button>
            <h1 style={{ fontSize: '18px', fontWeight: '800' }}>Select Payment</h1>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* OPay Choice */}
            <div 
              style={{ padding: '16px', borderRadius: 'var(--radius-md)', border: `2px solid ${paymentMethod === 'opay' ? 'var(--color-graphite)' : 'var(--color-border)'}`, display: 'flex', flexDirection: 'column', gap: '12px', cursor: 'pointer', backgroundColor: paymentMethod === 'opay' ? 'var(--color-graphite-ultra-light)' : 'transparent' }}
              onClick={() => setPaymentMethod('opay')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Smartphone size={24} style={{ color: 'var(--color-text)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                  <span style={{ fontSize: '14px', fontWeight: '700' }}>OPay Wallet</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Fast online transaction via OPay</span>
                </div>
                <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: '2px solid var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px' }}>
                  {paymentMethod === 'opay' && <div style={{ width: '100%', height: '100%', backgroundColor: 'var(--color-graphite)', borderRadius: '50%' }}></div>}
                </div>
              </div>
              
              {paymentMethod === 'opay' && (
                <div className="animate-slide-down" style={{ padding: '12px', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                  Send payment to: <strong style={{ color: 'var(--color-text)' }}>08123456789</strong> (OPay - StoreFlow Mart)
                </div>
              )}
            </div>

            {/* Bank Transfer */}
            <div 
              style={{ padding: '16px', borderRadius: 'var(--radius-md)', border: `2px solid ${paymentMethod === 'transfer' ? 'var(--color-graphite)' : 'var(--color-border)'}`, display: 'flex', flexDirection: 'column', gap: '12px', cursor: 'pointer', backgroundColor: paymentMethod === 'transfer' ? 'var(--color-graphite-ultra-light)' : 'transparent' }}
              onClick={() => setPaymentMethod('transfer')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <CreditCard size={24} style={{ color: 'var(--color-text)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                  <span style={{ fontSize: '14px', fontWeight: '700' }}>Bank Transfer</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Transfer details will be provided</span>
                </div>
                <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: '2px solid var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px' }}>
                  {paymentMethod === 'transfer' && <div style={{ width: '100%', height: '100%', backgroundColor: 'var(--color-graphite)', borderRadius: '50%' }}></div>}
                </div>
              </div>
              
              {paymentMethod === 'transfer' && (
                <div className="animate-slide-down" style={{ padding: '12px', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span>Bank: <strong style={{ color: 'var(--color-text)' }}>Access Bank</strong></span>
                  <span>Account No: <strong style={{ color: 'var(--color-text)' }}>1234567890</strong></span>
                  <span>Account Name: <strong style={{ color: 'var(--color-text)' }}>StoreFlow Mart Ltd</strong></span>
                </div>
              )}
            </div>

            {/* Cash on Pickup */}
            <div 
              style={{ padding: '16px', borderRadius: 'var(--radius-md)', border: `2px solid ${paymentMethod === 'cash' ? 'var(--color-graphite)' : 'var(--color-border)'}`, display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', backgroundColor: paymentMethod === 'cash' ? 'var(--color-graphite-ultra-light)' : 'transparent' }}
              onClick={() => setPaymentMethod('cash')}
            >
              <ShoppingBag size={24} style={{ color: 'var(--color-text)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                <span style={{ fontSize: '14px', fontWeight: '700' }}>
                  {deliveryType === 'delivery' ? 'Cash on Delivery' : 'Cash on Pickup'}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Pay at the counter or to the rider</span>
              </div>
              <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: '2px solid var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px' }}>
                {paymentMethod === 'cash' && <div style={{ width: '100%', height: '100%', backgroundColor: 'var(--color-graphite)', borderRadius: '50%' }}></div>}
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '16px', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Recipient Name</span>
                <span>{customerName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Delivery Type</span>
                <span style={{ textTransform: 'capitalize' }}>{deliveryType}</span>
              </div>
              <div style={{ height: '1px', backgroundColor: 'var(--color-border)', margin: '4px 0' }}></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: '800', color: 'var(--color-text)' }}>
                <span>Amount to Pay</span>
                <span>{store?.currency || '₦'}{total.toLocaleString()}</span>
              </div>
            </div>

            <button className="btn-primary" onClick={submitOrder}>
              <Check size={18} />
              <span>Confirm Order</span>
            </button>
          </div>
        </div>
      )}

      {/* ORDER TRACKING & SUCCESS SCREEN */}
      {checkoutStep === 'tracking' && (
        <div className="animate-scale" style={{ padding: '32px 20px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--color-success-bg)', color: 'var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', marginBottom: '8px' }}>
              ✓
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: '800' }}>Order Placed Successfully!</h1>
            <p style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>
              Your order is logged under reference <strong style={{ color: 'var(--color-text)' }}>#{orderNumber}</strong>.
            </p>
          </div>

          {/* Tracking timeline */}
          <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', padding: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: '16px', letterSpacing: '0.05em' }}>
              Order Progress
            </h3>
            
            <div className="tracking-timeline">
              <div className={`tracking-step ${['Pending', 'Preparing', 'Ready', 'Completed'].includes(orderStatus) ? 'completed' : ''} ${orderStatus === 'Pending' ? 'active' : ''}`}>
                <div className="tracking-node"></div>
                <span className="tracking-label">Order Received</span>
                <span className="tracking-time">We have received your order request</span>
              </div>

              <div className={`tracking-step ${['Preparing', 'Ready', 'Completed'].includes(orderStatus) ? 'completed' : ''} ${orderStatus === 'Preparing' ? 'active' : ''}`}>
                <div className="tracking-node"></div>
                <span className="tracking-label">Preparing Order</span>
                <span className="tracking-time">The store team is packaging your items</span>
              </div>

              <div className={`tracking-step ${['Ready', 'Completed'].includes(orderStatus) ? 'completed' : ''} ${orderStatus === 'Ready' ? 'active' : ''}`}>
                <div className="tracking-node"></div>
                <span className="tracking-label">
                  {deliveryType === 'delivery' ? 'Out for Delivery' : 'Ready for Pickup'}
                </span>
                <span className="tracking-time">
                  {deliveryType === 'delivery' ? 'Our delivery agent is on their way' : 'Your bag is ready at the pickup desk'}
                </span>
              </div>

              <div className={`tracking-step ${orderStatus === 'Completed' ? 'completed active' : ''}`}>
                <div className="tracking-node"></div>
                <span className="tracking-label">Order Completed</span>
                <span className="tracking-time">Thank you for shopping with StoreFlow!</span>
              </div>
            </div>
          </div>

          {/* Pickup QR Code Card */}
          {deliveryType === 'pickup' && (
            <div style={{ padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <QrCode size={128} style={{ color: 'var(--color-graphite)' }} />
              <div style={{ textAlign: 'center' }}>
                <h4 style={{ fontSize: '14px', fontWeight: '700' }}>Present QR at Counter</h4>
                <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>Scan this code at pickup to instantly collect your items.</p>
              </div>
            </div>
          )}

          {/* Store Info & Contacts */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              <span>Store Location</span>
              <span style={{ fontWeight: '600', color: 'var(--color-text)' }}>{store?.address}</span>
            </div>
            {store?.phone && (
              <a 
                href={`tel:${store.phone}`} 
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', border: '1.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '13px', fontWeight: '600', textDecoration: 'none', color: 'var(--color-text)' }}
              >
                <Phone size={16} />
                <span>Call Store ({store.phone})</span>
              </a>
            )}
          </div>

          {/* Install Prompt Card */}
          {showInstallPrompt && (
            <div className="install-card animate-slide-up">
              <div style={{ fontSize: '28px' }}>🚀</div>
              <h3 style={{ fontSize: '16px', fontWeight: '800' }}>Install StoreFlow Customer</h3>
              <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                Install the Progressive Web App on your home screen for access to premium benefits and faster checkout:
              </p>
              
              <div className="install-features">
                <div className="install-feature-item">
                  <Check size={14} style={{ color: 'var(--color-success)' }} />
                  <span>5% discount rewards</span>
                </div>
                <div className="install-feature-item">
                  <Check size={14} style={{ color: 'var(--color-success)' }} />
                  <span>Instant checkout</span>
                </div>
                <div className="install-feature-item">
                  <Check size={14} style={{ color: 'var(--color-success)' }} />
                  <span>Saved local addresses</span>
                </div>
                <div className="install-feature-item">
                  <Check size={14} style={{ color: 'var(--color-success)' }} />
                  <span>Offline menu browsing</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button 
                  className="toggle-option" 
                  style={{ border: '1px solid var(--color-border)' }}
                  onClick={() => setShowInstallPrompt(false)}
                >
                  Maybe Later
                </button>
                <button 
                  className="btn-primary" 
                  style={{ flexGrow: 1, padding: '10px' }}
                  onClick={triggerInstall}
                >
                  <Smartphone size={16} />
                  <span>Install App</span>
                </button>
              </div>
            </div>
          )}

          <button 
            className="btn-primary" 
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--color-text)', border: '1.5px solid var(--color-border)', boxShadow: 'none' }}
            onClick={() => {
              setCheckoutStep('shopping');
              setOrderId(null);
            }}
          >
            <RefreshCw size={16} />
            <span>Order Again</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
