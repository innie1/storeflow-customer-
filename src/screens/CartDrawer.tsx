import type { CartItem, Product } from '../types';
import ProductImageWithFallback from '../components/ProductImageWithFallback';

/**
 * The cart, checkout details and payment steps, as one bottom sheet.
 *
 * Order submission itself stays in App — this component collects the details
 * and calls back. Nothing here builds the payload sent to place_order_atomic.
 */
interface CartDrawerProps {
  // ── Cart contents and pricing ──────────────────────────────────────────
  cart: CartItem[];
  setCart: (cart: CartItem[]) => void;
  addToCart: (product: Product, qty?: number) => void;
  setCartQuantity: (product: Product, qty: number) => void;
  getPrice: (product: Product) => number;
  subtotal: number;
  total: number;
  totalItemsCount: number;
  deliveryFee: number;
  onlineDiscount: number;
  minimumOrder: number;
  belowMinimumOrder: boolean;

  // ── The store being ordered from ───────────────────────────────────────
  store: any;
  fulfilment: { pickup: boolean; delivery: boolean };
  paymentMethodsList: Array<{ key: string; icon: string; label: string; sub: string }>;
  loyaltyBalance: { enabled: boolean; points: number; redeemThreshold: number; redeemValueNaira: number } | null;
  redeemLoyalty: boolean;
  setRedeemLoyalty: (value: boolean) => void;

  // ── Checkout details ───────────────────────────────────────────────────
  checkoutStep: 'shopping' | 'checkout' | 'payment';
  setCheckoutStep: (step: 'shopping' | 'checkout' | 'payment') => void;
  customerName: string;
  setCustomerName: (value: string) => void;
  customerPhone: string;
  setCustomerPhone: (value: string) => void;
  customerEmail: string;
  setCustomerEmail: (value: string) => void;
  deliveryType: 'pickup' | 'delivery';
  setDeliveryType: (value: 'pickup' | 'delivery') => void;
  deliveryAddress: string;
  setDeliveryAddress: (value: string) => void;
  deliveryLandmark: string;
  setDeliveryLandmark: (value: string) => void;
  specialInstructions: string;
  setSpecialInstructions: (value: string) => void;
  paymentMethod: 'cash' | 'transfer' | 'opay';
  setPaymentMethod: (value: 'cash' | 'transfer' | 'opay') => void;
  normalizeNigerianPhone: (value: string) => string;

  // ── Submission — owned by App, called from here ────────────────────────
  orderSubmitting: boolean;
  submitOrder: (overrides?: any) => void;
  applyItsMeToCheckout: () => void;
  applySameAsBeforeAndSubmit: () => void;
  hasSameAsBeforeData: () => boolean;

  setIsCartOpen: (open: boolean) => void;
}

export default function CartDrawer(props: CartDrawerProps) {
  const {
    cart,
    setCart,
    addToCart,
    setCartQuantity,
    getPrice,
    subtotal,
    total,
    totalItemsCount,
    deliveryFee,
    onlineDiscount,
    minimumOrder,
    belowMinimumOrder,
    store,
    fulfilment,
    paymentMethodsList,
    loyaltyBalance,
    redeemLoyalty,
    setRedeemLoyalty,
    checkoutStep,
    setCheckoutStep,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    customerEmail,
    setCustomerEmail,
    deliveryType,
    setDeliveryType,
    deliveryAddress,
    setDeliveryAddress,
    deliveryLandmark,
    setDeliveryLandmark,
    specialInstructions,
    setSpecialInstructions,
    paymentMethod,
    setPaymentMethod,
    normalizeNigerianPhone,
    orderSubmitting,
    submitOrder,
    applyItsMeToCheckout,
    applySameAsBeforeAndSubmit,
    hasSameAsBeforeData,
    setIsCartOpen,
  } = props;

  return (
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
                    <ProductImageWithFallback
                      src={item.product.image}
                      alt={item.product.name}
                      className="w-full h-full object-contain p-1"
                      productName={item.product.name}
                      category={item.product.category}
                      unit={item.product.unit}
                      isService={item.product.isService}
                    />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <h4 className="font-bold text-sm text-[#1A1C1E] truncate">{item.product.name}</h4>
                    <span className="text-xs text-gray-400 mt-0.5 block font-semibold">
                      ₦{getPrice(item.product).toLocaleString()} {item.product.unit && item.product.unit !== 'pcs' ? `/ ${item.product.unit}` : 'each'}
                    </span>
                  </div>
                  {item.product.unit && item.product.unit !== 'pcs' ? (
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      value={item.quantity}
                      onChange={e => setCartQuantity(item.product, Number(e.target.value) || 0)}
                      className="w-16 text-right font-black text-sm text-[#1A1C1E] bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-200 shrink-0"
                    />
                  ) : (
                    <div className="flex items-center gap-3 bg-gray-50 rounded-full p-1 border border-gray-100 shrink-0">
                      <button onClick={() => addToCart(item.product, -1)} className="w-8 h-8 bg-white text-[#1A1C1E] rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer border border-gray-100">
                        <span className="material-symbols-outlined text-sm font-bold">remove</span>
                      </button>
                      <span className="font-black text-sm text-[#1A1C1E] w-4 text-center">{item.quantity}</span>
                      <button onClick={() => addToCart(item.product, 1)} className="w-8 h-8 bg-[#1A1C1E] text-[#FFD23F] rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-transform cursor-pointer">
                        <span className="material-symbols-outlined text-sm font-black">add</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100 pt-4 mt-4 text-[#1A1C1E]">
              <div className="space-y-2 mb-5 text-left">
                <div className="flex justify-between text-xs text-gray-400 font-bold">
                  <span>Subtotal</span><span>₦{subtotal.toLocaleString()}</span>
                </div>
                {onlineDiscount > 0 && (
                  <div className="flex justify-between text-xs text-emerald-600 font-bold">
                    <span>Online Discount ({store?.data?.marketplaceSettings?.onlineDiscount}%)</span>
                    <span>−₦{onlineDiscount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-gray-400 font-bold">
                  <span>Delivery Fee</span><span>{deliveryFee === 0 ? 'FREE' : `₦${deliveryFee.toLocaleString()}`}</span>
                </div>
                <div className="h-[1px] bg-gray-105 my-2"></div>
                <div className="flex justify-between text-base font-black text-[#1A1C1E]">
                  <span>Total</span><span>₦{total.toLocaleString()}</span>
                </div>
              </div>
              {belowMinimumOrder && (
                <p className="mb-3 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-left">
                  This store has a ₦{minimumOrder.toLocaleString()} minimum order. Add ₦{(minimumOrder - subtotal).toLocaleString()} more to check out.
                </p>
              )}
              <button
                disabled={cart.length === 0 || belowMinimumOrder}
                onClick={() => setCheckoutStep('checkout')}
                className="w-full py-4 rounded-full font-black uppercase tracking-wider text-xs shadow-md transition-all cursor-pointer bg-black text-[#FFD23F] hover:bg-black/90 disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed"
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

            {/* ─── It'sMe Prefill Button + Same as Before ─── */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={applyItsMeToCheckout}
                className="w-full py-2.5 px-2 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-xl flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98] transition-transform cursor-pointer border border-[#FFD23F]/20 hover:border-[#FFD23F]/40"
              >
                <span className="text-sm">✨</span>
                <span className="text-[11px] truncate">Fill with It'sMe</span>
              </button>
              {hasSameAsBeforeData() && (
                <button
                  onClick={applySameAsBeforeAndSubmit}
                  disabled={orderSubmitting}
                  className="w-full py-2.5 px-2 bg-white text-[#1A1C1E] font-black rounded-xl flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98] transition-transform cursor-pointer border-2 border-[#1A1C1E] disabled:opacity-60"
                  title="Reuses your last order's address, phone, and payment method, and places the order immediately"
                >
                  <span className="text-sm">⚡</span>
                  <span className="text-[11px] truncate">Same as Before</span>
                </button>
              )}
            </div>
            <div className="space-y-2 text-left">
              <label className="text-xs font-black text-gray-400 uppercase tracking-wider">Order Option</label>
              <div className={`grid gap-2 bg-gray-50 rounded-full p-1 border border-gray-100 ${fulfilment.pickup && fulfilment.delivery ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {fulfilment.pickup && (
                  <button onClick={() => setDeliveryType('pickup')} className={`py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${deliveryType === 'pickup' ? 'bg-[#1A1C1E] text-white shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}>
                    Store Pickup
                  </button>
                )}
                {fulfilment.delivery && (
                  <button onClick={() => setDeliveryType('delivery')} className={`py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${deliveryType === 'delivery' ? 'bg-[#1A1C1E] text-white shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}>
                    Home Delivery
                  </button>
                )}
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

            {loyaltyBalance?.enabled && loyaltyBalance.points >= loyaltyBalance.redeemThreshold && (
              <div
                onClick={() => setRedeemLoyalty(!redeemLoyalty)}
                className={`p-3.5 rounded-2xl border-2 cursor-pointer flex items-center justify-between transition-all ${redeemLoyalty ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}
              >
                <div>
                  <p className="text-xs font-black text-[#1A1C1E]">🪙 Redeem {loyaltyBalance.redeemThreshold} points</p>
                  <p className="text-[10px] text-gray-400 font-semibold mt-0.5">Get ₦{loyaltyBalance.redeemValueNaira.toLocaleString()} off this order</p>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${redeemLoyalty ? 'bg-amber-500' : 'bg-gray-200'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${redeemLoyalty ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </div>
            )}

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
              onClick={() => submitOrder()}
              className="w-full bg-[#1A1C1E] hover:bg-black text-[#FFD23F] py-4 rounded-full font-black uppercase tracking-wider text-xs shadow-md active:scale-98 transition-all cursor-pointer"
            >
              {redeemLoyalty && loyaltyBalance?.enabled && loyaltyBalance.points >= loyaltyBalance.redeemThreshold
                ? `Place Order (₦${Math.max(0, total - loyaltyBalance.redeemValueNaira).toLocaleString()})`
                : `Place Order (₦${total.toLocaleString()})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
