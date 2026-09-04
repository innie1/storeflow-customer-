import type { ItsMe } from '../lib/itsMe';

/** Guest/account hub: identity, appearance and shortcuts. */
export default function ProfileScreen({
  currentUser,
  profileName,
  profileEmail,
  itsMeProfile,
  darkMode,
  onToggleDarkMode,
  onProfileNameChange,
  onSaveDisplayName,
  onBack,
  onOpenItsMe,
  onOpenOrders,
  onLogout,
  onInstall,
  onSignIn,
  ordersCount,
}: {
  currentUser: any;
  profileName: string;
  profileEmail: string;
  itsMeProfile: ItsMe;
  darkMode: boolean;
  onToggleDarkMode: (value: boolean) => void;
  onProfileNameChange: (value: string) => void;
  onSaveDisplayName: (value: string) => void;
  onBack: () => void;
  onOpenItsMe: () => void;
  onOpenOrders: () => void;
  onLogout: () => void;
  onInstall: (() => void) | null;
  onSignIn: () => void;
  ordersCount: number;
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
        <span className="text-sm font-black tracking-wider uppercase text-[#1A1C1E] dark:text-zinc-100">Profile Hub</span>
        <div className="w-10 h-10" />
      </header>

      <main className="mt-6 px-4 md:px-8 max-w-md md:max-w-2xl lg:max-w-3xl mx-auto space-y-6 text-left">
        {/* User credentials details */}
        <div className="p-5 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-3xl flex items-center gap-4 shadow-sm">
          <div className="w-14 h-14 bg-[#FFD23F] rounded-full flex items-center justify-center font-black text-slate-950 text-xl uppercase shadow-sm">
            {profileName ? profileName.slice(0, 2) : 'GS'}
          </div>
          <div className="space-y-0.5 text-left">
            <h4 className="font-extrabold text-base text-[#1A1C1E] dark:text-zinc-100">{profileName || 'Guest Shopper'}</h4>
            <p className="text-xs text-gray-400 dark:text-zinc-500 font-semibold">{profileEmail || 'Shopping anonymously'}</p>
            {currentUser ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20 mt-1">
                Registered Member
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 mt-1">
                Guest Account
              </span>
            )}
          </div>
        </div>

        {/* ─── It'sMe Identity Card ─── */}
        <button
          onClick={onOpenItsMe}
          className="w-full text-left"
        >
          <div className="relative overflow-hidden bg-[#1A1C1E] border border-[#FFD23F]/20 rounded-2xl p-3.5 shadow-md group cursor-pointer">
            {/* Decorative glow */}
            <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-[#FFD23F]/10 blur-2xl pointer-events-none" />

            <div className="relative z-10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-xl bg-[#FFD23F]/20 border border-[#FFD23F]/30 flex items-center justify-center shrink-0 text-sm font-black text-[#FFD23F]">
                  {itsMeProfile.displayName ? itsMeProfile.displayName.charAt(0).toUpperCase() : '✦'}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#FFD23F] font-black text-sm tracking-tight">It'sMe</span>
                    <span className="text-[8px] bg-[#FFD23F]/15 text-[#FFD23F] border border-[#FFD23F]/25 px-1.5 py-0.5 rounded-full font-black uppercase tracking-wider shrink-0">Identity</span>
                  </div>
                  <p className="text-white/60 text-[11px] font-semibold truncate">
                    {itsMeProfile.displayName || 'Tap to set up your identity'}
                  </p>
                </div>
              </div>
              <span className="material-symbols-outlined text-white/30 group-hover:text-[#FFD23F]/60 transition-colors text-lg shrink-0">chevron_right</span>
            </div>
          </div>
        </button>

        {/* Compact profile overview — additive only, existing data sources unchanged */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: ordersCount, label: 'Orders', icon: 'receipt_long' },
            { value: itsMeProfile.addresses.length, label: 'Addresses', icon: 'location_on' },
            { value: itsMeProfile.preferredPayment || 'Cash', label: 'Payment', icon: 'payments' },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 p-3 text-center shadow-sm">
              <span className="material-symbols-outlined text-[#FFD23F] text-base">{item.icon}</span>
              <p className="mt-1 text-xs font-black text-[#1A1C1E] dark:text-zinc-100 truncate">{item.value}</p>
              <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">{item.label}</p>
            </div>
          ))}
        </div>

        {/* Form actions */}
        <div className="space-y-4 text-left">
          <div className="p-4.5 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl shadow-sm space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-gray-400 dark:text-zinc-400 uppercase tracking-wider">Display Name</label>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-100 dark:border-emerald-500/20 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Synced with It'sMe
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={profileName}
                onChange={e => onProfileNameChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onSaveDisplayName(profileName);
                  }
                }}
                placeholder="Enter your display name..."
                // min-w-0: a flex item defaults to min-width:auto, so this
                // input refused to shrink below its intrinsic width and
                // pushed the (shrink-0) Save button off the right edge of
                // the screen on a phone.
                className="flex-1 min-w-0 px-4 h-12 bg-[#F8F9FA] dark:bg-zinc-950 text-[#1A1C1E] dark:text-zinc-100 rounded-xl border border-gray-200 dark:border-zinc-800 focus:outline-none focus:border-[#FFD23F] text-xs font-extrabold shadow-inner"
              />
              <button
                type="button"
                onClick={() => onSaveDisplayName(profileName)}
                className="px-4 h-12 bg-[#1A1C1E] dark:bg-zinc-900 border border-[#FFD23F]/30 hover:border-[#FFD23F]/60 text-[#FFD23F] font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer active-scale hover:bg-black transition-colors shrink-0 shadow-sm flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base font-bold text-[#FFD23F]">check</span>
                <span className="text-[#FFD23F]">Save Name</span>
              </button>
            </div>

            <p className="text-[10px] text-gray-400 dark:text-zinc-500 font-semibold px-0.5">
              Your display name matches your It'sMe identity across all storefronts and order receipts.
            </p>
          </div>

          {/* Dark mode toggler */}
          <div className="flex items-center justify-between p-4 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl shadow-sm">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">{darkMode ? 'dark_mode' : 'light_mode'}</span>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">{darkMode ? 'Dark Mode' : 'Light Mode'}</span>
            </div>
            <button
              onClick={() => onToggleDarkMode(!darkMode)}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-10 h-10 rounded-full bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 flex items-center justify-center cursor-pointer active:scale-90 transition-all focus:outline-none"
            >
              <span className="material-symbols-outlined text-lg text-[#1A1C1E] dark:text-zinc-100">{darkMode ? 'light_mode' : 'dark_mode'}</span>
            </button>
          </div>

          {/* Saved list options */}
          <button 
            onClick={onOpenOrders} 
            className="w-full p-4 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl text-left font-extrabold text-xs uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800 active:scale-98 transition text-[#1A1C1E] dark:text-zinc-100 shadow-sm"
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">receipt_long</span>
              <span>My Orders History</span>
            </span>
            <span className="material-symbols-outlined text-gray-400 text-lg">chevron_right</span>
          </button>

          {/* PWA Installer */}
          {onInstall && (
            <button 
              onClick={onInstall!} 
              className="w-full p-4 bg-[#FFD23F]/10 border border-[#FFD23F]/20 rounded-2xl text-left font-extrabold text-xs uppercase tracking-wider flex items-center justify-between cursor-pointer hover:bg-[#FFD23F]/15 active:scale-98 transition text-[#1A1C1E] dark:text-zinc-100"
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
          <button onClick={onLogout} className="w-full h-14 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-2xl active-scale transition cursor-pointer uppercase tracking-wider text-xs">
            Log Out Account
          </button>
        ) : (
          <button onClick={onSignIn} className="w-full h-14 bg-[#1A1C1E] dark:bg-zinc-900 border border-[#FFD23F]/30 hover:border-[#FFD23F]/60 text-[#FFD23F] font-black rounded-2xl active-scale transition cursor-pointer uppercase tracking-wider text-xs hover:bg-black flex items-center justify-center shadow-md">
            Sign In / Register
          </button>
        )}
      </footer>
    </div>
  );
}
