import type { Store } from '../types';
import { computeStoreOpen } from '../lib/storeIdentity';
import StoreBrandMark from '../components/StoreBrandMark';

/** Every partner store, searchable. */
export default function ExploreScreen({
  stores,
  searchQuery,
  onSearchChange,
  onOpenStore,
  onScan,
}: {
  stores: Store[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onOpenStore: (storeId: string) => void;
  onScan: () => void;
}) {
  return (
    <div className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] pb-28">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md h-16 flex items-center justify-between border-b border-gray-100 px-4 text-[#1A1C1E]">
        <h1 className="text-base font-black tracking-tight text-[#1A1C1E]">Explore Stores</h1>
        <button onClick={onScan} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 transition-colors rounded-full cursor-pointer text-[#1A1C1E]">
          <span className="material-symbols-outlined text-xl">qr_code_scanner</span>
        </button>
      </header>

      <main className="px-4 md:px-8 max-w-5xl lg:max-w-6xl mx-auto mt-4 space-y-5">
        {/* Search */}
        <div className="relative w-full h-13 bg-white rounded-full flex items-center px-4 border border-gray-200 focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 transition-all shadow-sm">
          <span className="material-symbols-outlined text-gray-400 mr-3">search</span>
          <input
            className="bg-transparent border-none focus:ring-0 focus:outline-none w-full text-sm outline-none text-[#1A1C1E] placeholder:text-gray-400 py-3"
            placeholder="Search stores near you..."
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => onSearchChange('')} className="mr-2 cursor-pointer text-gray-400 hover:text-black">
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
        {stores.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <span className="material-symbols-outlined text-5xl text-gray-200">store</span>
            <p className="text-sm text-gray-400 font-semibold">No partner stores found in your area yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {stores
              .filter(s => !searchQuery || s.business_name.toLowerCase().includes(searchQuery.toLowerCase()) || (s.address?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false))
              .map(s => (
                <div
                  key={s.id}
                  onClick={() => onOpenStore(s.id)}
                  className="p-4 bg-white border border-gray-100 hover:border-gray-200 rounded-[24px] flex gap-4 cursor-pointer active-scale transition-all shadow-sm"
                >
                  {/* Same brand mark the Home cards and the store page use.
                      Explore was the last place still falling back to a
                      generic shop emoji for a store with no uploaded logo. */}
                  <div className="w-16 h-16 bg-[#F8F9FA] border border-gray-50 rounded-xl overflow-hidden shrink-0 flex items-center justify-center shadow-sm">
                    <StoreBrandMark store={s} />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <h4 className="font-extrabold text-base text-[#1A1C1E] truncate">{s.business_name}</h4>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="material-symbols-outlined text-gray-300 text-sm">location_on</span>
                      <p className="text-xs text-gray-400 truncate font-semibold">{s.address || 'Partner Store'}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider">
                        <span className={`w-1.5 h-1.5 rounded-full ${computeStoreOpen(s) ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                        <span className={computeStoreOpen(s) ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          {computeStoreOpen(s) ? 'Open' : 'Closed'}
                        </span>
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
  );
}
