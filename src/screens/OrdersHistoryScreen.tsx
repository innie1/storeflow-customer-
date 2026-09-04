import type { Order, Store } from '../types';
import { isLogoImageUrl } from '../lib/storeIdentity';

/** The customer's past and in-flight orders. */
export default function OrdersHistoryScreen({
  orders,
  visibleOrders,
  stores,
  activeStatuses,
  searchQuery,
  onSearchChange,
  onBack,
  onOpenOrder,
  onReorder,
}: {
  orders: Order[];
  visibleOrders: Order[];
  stores: Store[];
  activeStatuses: string[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onBack: () => void;
  onOpenOrder: (order: any) => void;
  onReorder: (order: any) => void;
}) {
  return (
    <div className="bg-[#F8F9FA] dark:bg-zinc-950 min-h-screen text-[#1A1C1E] dark:text-zinc-100 pb-32">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md flex justify-between items-center w-full h-16 border-b border-gray-100 dark:border-zinc-800 px-4 text-[#1A1C1E] dark:text-zinc-100">
        <button 
          onClick={onBack} 
          className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-900 text-[#1A1C1E] dark:text-zinc-100 active:scale-95 transition cursor-pointer"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
        </button>
        <span className="text-sm font-black tracking-wider uppercase">Orders History</span>
        <div className="w-10 h-10" />
      </header>

      <main className="mt-6 px-4 md:px-8 max-w-md md:max-w-2xl lg:max-w-3xl mx-auto space-y-4 text-left">
        {orders.length > 0 && (
          <div className="relative w-full h-11 bg-white rounded-xl flex items-center px-4 border border-gray-200 shadow-sm">
            <span className="material-symbols-outlined text-gray-400 text-sm mr-2.5">search</span>
            <input
              type="text"
              placeholder="Search by store, item, order ID, or date..."
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              className="bg-transparent border-none text-xs focus:ring-0 focus:outline-none w-full text-[#1A1C1E] placeholder:text-gray-400"
            />
            {searchQuery && (
              <button onClick={() => onSearchChange('')} className="text-gray-400 cursor-pointer">
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            )}
          </div>
        )}
        {orders.length === 0 ? (
          <div className="text-center py-16 text-gray-400 flex flex-col items-center justify-center gap-3">
            <span className="material-symbols-outlined text-5xl text-gray-300">receipt_long</span>
            <p className="text-sm font-black uppercase tracking-wider text-[#1A1C1E]">No orders placed yet</p>
            <p className="text-xs text-gray-500 font-medium max-w-xs leading-relaxed">
              When you place an order, it will appear here instantly with live tracking updates.
            </p>
          </div>
        ) : visibleOrders.length === 0 ? (
          <div className="text-center py-16 text-gray-400 flex flex-col items-center justify-center gap-3">
            <span className="material-symbols-outlined text-5xl text-gray-300">search_off</span>
            <p className="text-sm font-black uppercase tracking-wider text-[#1A1C1E]">No matching orders</p>
            <p className="text-xs text-gray-500 font-medium max-w-xs leading-relaxed">
              Try a different search term, or clear the search to see all your orders.
            </p>
          </div>
        ) : (
          visibleOrders.map((o: any, idx: number) => {
            // Section divider right where active orders end and finished ones begin
            const isFirstFinished = activeStatuses.includes(o.status) === false &&
              idx > 0 && activeStatuses.includes(visibleOrders[idx - 1]?.status);
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
                name: oi.item_name || oi.product?.name || 'Product',
                quantity: oi.quantity,
                price: oi.price
              }));
            }

            const totalQty = itemsSummary.reduce((sum: number, item: any) => sum + Number(item.quantity || 1), 0);

            const cardStore = stores.find((s: any) => s.id === o.store_id);
            storeNameText = cardStore?.business_name || storeNameText;

            return (
              <div key={o.id} className="space-y-4">
              {isFirstFinished && (
                <div className="flex items-center gap-3 pt-2 pb-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Order History</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl p-5 shadow-sm space-y-4 text-left">
                {/* Header: Store Logo, Name & Date */}
                <div className="flex justify-between items-start border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                      {isLogoImageUrl(cardStore?.logo) ? (
                        <img loading="lazy" decoding="async" src={cardStore!.logo} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <span className="text-sm">🏪</span>
                      )}
                    </div>
                    <div className="text-left min-w-0">
                      <h4 className="font-extrabold text-sm text-[#1A1C1E] truncate max-w-[160px]">{storeNameText}</h4>
                      <p className="text-[10px] text-gray-400 font-mono mt-0.5">#{o.order_number}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] text-gray-400 font-bold block">{new Date(o.created_at).toLocaleDateString()}</span>
                    <span className="text-[10px] text-gray-400 font-semibold block">{new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
                    onClick={() => onOpenOrder(o)}
                    className="flex-1 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-[#1A1C1E] rounded-xl text-center cursor-pointer uppercase tracking-wider transition shadow-sm"
                  >
                    Track Status
                  </button>
                  <button
                    onClick={() => onReorder(o)}
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
  );
}
