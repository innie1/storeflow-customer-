import type { ItsMe } from '../lib/itsMe';
import type { Order, Store } from '../types';
import StoreBrandMark from '../components/StoreBrandMark';
import IdentityQrCode from '../components/IdentityQrCode';

interface Draft {
  name: string;
  phone: string;
  email: string;
  instructions: string;
  address: string;
  landmark: string;
}

/**
 * "It'sMe" — the customer's local identity, used to prefill checkout at every
 * storefront. The editable fields are held as a draft by App so a half-typed
 * value is not committed until Save.
 */
export default function ItsMeScreen({
  profile,
  stores,
  orders,
  draft,
  onDraftChange,
  onClose,
  onSaveProfile,
  onPhotoUpload,
  onAutofill,
  onOpenStore,
  onOpenOrders,
  signedIn,
}: {
  profile: ItsMe;
  stores: Store[];
  orders: Order[];
  draft: Draft;
  onDraftChange: { [K in keyof Draft]: (value: string) => void };
  onClose: () => void;
  onSaveProfile: (profile: ItsMe) => void;
  onPhotoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAutofill: () => void;
  onOpenStore: (storeId: string) => void;
  onOpenOrders: () => void;
  signedIn: boolean;
}) {
  const saveAndClose = () => {
    onSaveProfile({
      ...profile,
      displayName: draft.name,
      phone: draft.phone,
      email: draft.email,
      deliveryInstructions: draft.instructions,
    });
    onClose();
  };

  return (
    <div className="absolute inset-0 z-[200] bg-[#F8F9FA] dark:bg-zinc-950 text-[#1A1C1E] dark:text-zinc-100 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-950 border-b border-gray-100 dark:border-zinc-800 px-4 h-16 flex items-center justify-between shrink-0">
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-900 text-[#1A1C1E] dark:text-zinc-100 cursor-pointer active:scale-95 transition"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
        </button>
        <div className="text-center">
          <p className="text-[#FFD23F] font-black text-base tracking-tight leading-none">It'sMe</p>
          <p className="text-[10px] text-gray-400 font-semibold">Your secure StoreFlow identity</p>
        </div>
        <button
          onClick={saveAndClose}
          className="px-3 py-1.5 bg-[#1A1C1E] text-[#FFD23F] text-xs font-black rounded-full cursor-pointer hover:bg-black active:scale-95 transition"
        >
          Save
        </button>
      </div>

      <div className="overflow-y-auto flex-1 px-4 py-5 space-y-5 pb-10">

        {/* Identity Hero Card */}
        <div className="relative overflow-hidden bg-[#1A1C1E] rounded-2xl p-4 shadow-md">
          <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-[#FFD23F]/10 blur-2xl pointer-events-none" />
          <div className="relative z-10 flex flex-col items-center text-center gap-2">
            {/* Avatar with Photo Upload */}
            <div className="relative group w-14 h-14">
              {profile.profilePhoto ? (
                <img loading="lazy" decoding="async" src={profile.profilePhoto} className="w-14 h-14 rounded-xl object-cover border border-[#FFD23F]/30" alt="" />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-[#FFD23F]/20 border border-[#FFD23F]/30 flex items-center justify-center text-xl font-black text-[#FFD23F]">
                  {profile.displayName ? profile.displayName.charAt(0).toUpperCase() : '✦'}
                </div>
              )}
              <label htmlFor="itsme-photo-upload-input" className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-xl cursor-pointer transition-opacity">
                <span className="material-symbols-outlined text-[#FFD23F] text-base font-bold">photo_camera</span>
              </label>
              <input
                type="file"
                id="itsme-photo-upload-input"
                accept="image/*"
                onChange={onPhotoUpload}
                className="hidden"
              />
            </div>
            <div>
              <div className="flex items-center justify-center gap-1.5">
                <span className="text-white font-black text-sm">{profile.displayName || 'Your Name'}</span>
                <span className="text-[8px] bg-[#FFD23F]/15 text-[#FFD23F] border border-[#FFD23F]/25 px-1.5 py-0.5 rounded-full font-black uppercase tracking-wider">It'sMe</span>
              </div>
              <p className="text-white/40 text-[9px] font-mono mt-0.5 select-all">{profile.customerId}</p>
            </div>
            {/* Quick stats row */}
            <div className="w-full grid grid-cols-3 gap-2 mt-1 pt-3 border-t border-white/10">
              <div className="text-center">
                <p className="text-[#FFD23F] font-black text-sm">{profile.addresses.length}</p>
                <p className="text-white/40 text-[8px] font-bold uppercase tracking-wider mt-0.5">Addresses</p>
              </div>
              <div className="text-center">
                <p className="text-[#FFD23F] font-black text-sm">{orders.length}</p>
                <p className="text-white/40 text-[8px] font-bold uppercase tracking-wider mt-0.5">Orders</p>
              </div>
              <div className="text-center">
                <p className="text-[#FFD23F] font-black text-sm capitalize">{profile.preferredPayment.slice(0,4)}</p>
                <p className="text-white/40 text-[8px] font-bold uppercase tracking-wider mt-0.5">Payment</p>
              </div>
            </div>
          </div>
        </div>

        {/* QR Code Identity Card */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl p-5 shadow-sm flex flex-col items-center justify-center text-center space-y-3">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Your Personal QR Code</p>
          <div className="bg-[#1A1C1E] p-4 rounded-[24px] shadow-md border border-white/5">
            <IdentityQrCode value={profile.customerId} size={160} />
          </div>
          <p className="text-[11px] text-gray-400 font-semibold max-w-[240px]">Scan this code at checkout counters or share it with partner stores to link your identity instantly.</p>
        </div>

        {/* Contact Info */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Contact Info</h3>
            <button onClick={onAutofill} className="text-[10px] text-[#1A1C1E] font-black flex items-center gap-1 cursor-pointer hover:text-gray-600">
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
                value={draft.name}
                onChange={e => onDraftChange.name(e.target.value)}
                className="w-full px-4 py-3 bg-[#F8F9FA] dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 focus:border-[#FFD23F] focus:outline-none text-[#1A1C1E] dark:text-zinc-100 rounded-xl text-sm font-semibold"
                placeholder="Your full name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Phone Number</label>
              <input
                type="tel"
                autoComplete="tel"
                value={draft.phone}
                onChange={e => onDraftChange.phone(e.target.value)}
                className="w-full px-4 py-3 bg-[#F8F9FA] dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 focus:border-[#FFD23F] focus:outline-none text-[#1A1C1E] dark:text-zinc-100 rounded-xl text-sm font-semibold"
                placeholder="+234 xxx xxx xxxx"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Email</label>
              <input
                type="email"
                autoComplete="email"
                value={draft.email}
                onChange={e => onDraftChange.email(e.target.value)}
                className="w-full px-4 py-3 bg-[#F8F9FA] dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 focus:border-[#FFD23F] focus:outline-none text-[#1A1C1E] dark:text-zinc-100 rounded-xl text-sm font-semibold"
                placeholder="your@email.com"
              />
            </div>
          </div>
        </div>

        {/* Delivery Addresses */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl p-5 shadow-sm space-y-4">
          <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Saved Addresses</h3>
          {profile.addresses.map((addr, i) => (
            <div key={i} className="flex items-center justify-between bg-[#F8F9FA] rounded-2xl px-4 py-3 border border-gray-100">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="material-symbols-outlined text-[#FFD23F] text-base">location_on</span>
                <span className="text-xs text-[#1A1C1E] dark:text-zinc-100 font-semibold truncate">{addr}</span>
              </div>
              <button
                onClick={() => {
                  const newList = profile.addresses.filter((_, idx) => idx !== i);
                  onSaveProfile({ ...profile, addresses: newList });
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
              value={draft.address}
              onChange={e => onDraftChange.address(e.target.value)}
              className="flex-1 px-4 py-2.5 bg-[#F8F9FA] dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 focus:border-[#FFD23F] focus:outline-none text-[#1A1C1E] dark:text-zinc-100 rounded-xl text-sm font-semibold"
              placeholder="Add new address…"
              onKeyDown={e => {
                if (e.key === 'Enter' && draft.address.trim()) {
                  const newList = [...profile.addresses, draft.address.trim()];
                  onSaveProfile({ ...profile, addresses: newList });
                  onDraftChange.address('');
                }
              }}
            />
            <button
              onClick={() => {
                if (!draft.address.trim()) return;
                const newList = [...profile.addresses, draft.address.trim()];
                onSaveProfile({ ...profile, addresses: newList });
                onDraftChange.address('');
              }}
              className="px-4 py-2.5 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-xl text-xs cursor-pointer hover:bg-black active:scale-95 transition"
            >
              Add
            </button>
          </div>
        </div>

        {/* Landmarks */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl p-5 shadow-sm space-y-4">
          <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Saved Landmarks</h3>
          {profile.landmarks.map((lm, i) => (
            <div key={i} className="flex items-center justify-between bg-[#F8F9FA] rounded-2xl px-4 py-3 border border-gray-100">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="material-symbols-outlined text-[#FFD23F] text-base">place</span>
                <span className="text-xs text-[#1A1C1E] dark:text-zinc-100 font-semibold truncate">{lm}</span>
              </div>
              <button
                onClick={() => {
                  const newList = profile.landmarks.filter((_, idx) => idx !== i);
                  onSaveProfile({ ...profile, landmarks: newList });
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
              value={draft.landmark}
              onChange={e => onDraftChange.landmark(e.target.value)}
              className="flex-1 px-4 py-2.5 bg-[#F8F9FA] dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 focus:border-[#FFD23F] focus:outline-none text-[#1A1C1E] dark:text-zinc-100 rounded-xl text-sm font-semibold"
              placeholder="e.g. Near GTBank, after bridge…"
              onKeyDown={e => {
                if (e.key === 'Enter' && draft.landmark.trim()) {
                  const newList = [...profile.landmarks, draft.landmark.trim()];
                  onSaveProfile({ ...profile, landmarks: newList });
                  onDraftChange.landmark('');
                }
              }}
            />
            <button
              onClick={() => {
                if (!draft.landmark.trim()) return;
                const newList = [...profile.landmarks, draft.landmark.trim()];
                onSaveProfile({ ...profile, landmarks: newList });
                onDraftChange.landmark('');
              }}
              className="px-4 py-2.5 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-xl text-xs cursor-pointer hover:bg-black active:scale-95 transition"
            >
              Add
            </button>
          </div>
        </div>

        {/* Delivery Instructions */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl p-5 shadow-sm space-y-3">
          <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Preferred Delivery Instructions</h3>
          <textarea
            value={draft.instructions}
            onChange={e => onDraftChange.instructions(e.target.value)}
            rows={3}
            className="w-full px-4 py-3 bg-[#F8F9FA] dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 focus:border-[#FFD23F] focus:outline-none text-[#1A1C1E] dark:text-zinc-100 rounded-xl text-sm font-semibold resize-none"
            placeholder="e.g. Call me 5 minutes before arrival…"
          />
        </div>

        {/* Payment Preference */}
        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl p-5 shadow-sm space-y-3">
          <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Preferred Payment</h3>
          <div className="grid grid-cols-3 gap-2">
            {(['cash', 'transfer', 'opay'] as const).map(method => (
              <button
                key={method}
                onClick={() => {
                  onSaveProfile({ ...profile, preferredPayment: method });
                }}
                className={`py-3 rounded-2xl font-black text-xs capitalize transition-all cursor-pointer border ${profile.preferredPayment === method ? 'bg-[#1A1C1E] text-[#FFD23F] border-[#1A1C1E] shadow-md' : 'bg-[#F8F9FA] text-gray-500 border-gray-100 hover:border-gray-300'}`}
              >
                {method === 'opay' ? 'OPay' : method === 'transfer' ? 'Transfer' : 'Cash'}
              </button>
            ))}
          </div>
        </div>

        {/* Recent Orders */}
        {orders.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Recent Orders</h3>
              <button onClick={onOpenOrders} className="text-[10px] font-black text-[#1A1C1E] cursor-pointer hover:text-gray-500">
                View all →
              </button>
            </div>
            {orders.slice(0, 3).map(o => (
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
          const favStores = stores.filter(s => localStorage.getItem('storeflow_fav_store_' + s.id) === 'true');
          if (favStores.length === 0) return null;
          return (
            <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Favourite Stores</h3>
              {favStores.map(s => (
                <div
                  key={s.id}
                  onClick={() => { onClose(); onOpenStore(s.id); }}
                  className="flex items-center gap-3 bg-[#F8F9FA] rounded-2xl px-4 py-3 border border-gray-100 cursor-pointer hover:border-gray-200 transition"
                >
                  <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                    <StoreBrandMark store={s} />
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
        <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl p-5 shadow-sm space-y-3">
          <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">Identity Details</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center py-2 border-b border-gray-50">
              <span className="text-xs text-gray-400 font-semibold">Customer ID</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[#1A1C1E] font-bold">···{profile.customerId.slice(-8)}</span>
                <button onClick={() => { navigator.clipboard.writeText(profile.customerId); }} className="p-1 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer active:scale-95 transition">
                  <span className="material-symbols-outlined text-xs text-gray-500">content_copy</span>
                </button>
              </div>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-50">
              <span className="text-xs text-gray-400 font-semibold">Date Joined</span>
              <span className="text-xs font-bold text-[#1A1C1E]">{new Date(profile.dateJoined).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-xs text-gray-400 font-semibold">Last Updated</span>
              <span className="text-xs font-bold text-[#1A1C1E]">{new Date(profile.lastUpdated).toLocaleDateString()}</span>
            </div>
          </div>
          {!signedIn && (
            <div className="p-3.5 bg-amber-50 border border-amber-100 rounded-2xl text-[10px] text-amber-900 leading-relaxed font-semibold">
              💡 <strong>Tip:</strong> Sign in to sync your It'sMe profile across all your devices.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
