import { useState } from 'react';

/**
 * The customer's saved delivery addresses.
 *
 * The draft input and which address is being edited are local to this screen;
 * only the list itself and the current selection belong to the app.
 */
export default function LocationScreen({
  savedAddresses,
  onBack,
  onSelect,
  onDelete,
  onSaveList,
  onUseGPS,
}: {
  savedAddresses: string[];
  onBack: () => void;
  onSelect: (address: string) => void;
  onDelete: (address: string) => void;
  onSaveList: (addresses: string[], select: string) => void;
  onUseGPS: () => void;
}) {
  const [newAddressInput, setNewAddressInput] = useState('');
  const [editingAddress, setEditingAddress] = useState<string | null>(null);

  const commitAddress = () => {
    const value = newAddressInput.trim();
    if (!value) return;
    const list = editingAddress
      ? savedAddresses.map(a => (a === editingAddress ? value : a))
      : [value, ...savedAddresses.filter(a => a !== value)];
    setEditingAddress(null);
    setNewAddressInput('');
    onSaveList(list, value);
  };

  return (
    <div className="flex-1 p-6 max-w-md md:max-w-2xl lg:max-w-3xl mx-auto w-full flex flex-col justify-between">
      <header className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-white border border-gray-100 flex items-center justify-center cursor-pointer active-scale text-[#1A1C1E] shadow-sm">
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
                commitAddress();
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
                onClick={commitAddress}
                className="px-3.5 py-1.5 bg-[#1A1C1E] dark:bg-[#FFD23F] text-[#FFD23F] dark:text-[#1A1C1E] font-black rounded-lg text-xs cursor-pointer active:scale-95 transition"
              >
                {editingAddress ? 'Save' : 'Add'}
              </button>
            </div>
          )}
        </div>

        {/* GPS inline row */}
        <button 
          onClick={onUseGPS} 
          className="w-full py-3.5 bg-white dark:bg-[#18191b] border border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/30 rounded-2xl flex items-center justify-center gap-2 text-xs font-black cursor-pointer active-scale text-[#1A1C1E] dark:text-gray-200 shadow-sm transition-colors"
        >
          <span className="material-symbols-outlined text-[#FFD23F] text-lg font-bold">my_location</span>
          <span>Use Current Location (GPS)</span>
        </button>

        {/* Saved Addresses list - unified divide list */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-wider px-1">Saved Addresses</h3>
          <div className="bg-white dark:bg-[#18191b] border border-gray-100 dark:border-zinc-800 rounded-3xl overflow-hidden divide-y divide-gray-100/50 dark:divide-zinc-800/50 shadow-sm">
            {savedAddresses.length === 0 && (
              <p className="py-8 px-5 text-center text-xs font-semibold text-gray-400 dark:text-zinc-500">
                No saved addresses yet. Add one below so checkout can fill it in for you.
              </p>
            )}
            {savedAddresses.map(addr => (
              <div
                key={addr}
                className="w-full flex items-center justify-between transition-colors hover:bg-gray-50/50 dark:hover:bg-zinc-800/20 group"
              >
                {/* Selectable click area */}
                <div
                  onClick={() => onSelect(addr)}
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
                    onClick={e => { e.stopPropagation(); onDelete(addr); }}
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
  );
}
