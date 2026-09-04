/**
 * How a store presents itself: its brand mark, its business-type label, and
 * whether it is currently open.
 *
 * `computeStoreOpen` in particular has to be shared — the Home store cards and
 * the store detail page both show an open/closed dot, and when they each had
 * their own copy of the rule they disagreed, showing "Closed" on Home and
 * "Open" on the storefront for the same shop.
 */

export function isLogoImageUrl(logo?: string | null): boolean {
  if (!logo) return false;
  return logo.startsWith('http://') || logo.startsWith('https://') || logo.startsWith('data:');
}

// STOREFLOW_BRANDING_PATCH_V2
export const STORE_TYPE_LABELS: Record<string, string> = {
  provision: 'Provision / Supermarket', pharmacy: 'Pharmacy / Chemist', clothing: 'Clothing / Fashion', electronics: 'Electronics', food: 'Food Business', laundry: 'Laundry / Dry Cleaning', barber: 'Barber Shop', salon: 'Salon / Beauty', tailoring: 'Tailoring / Fashion Design', repair: 'Repair Shop', printing: 'Printing / Cyber Cafe', cyber_cafe: 'Cyber Cafe', car_wash: 'Car Wash', photography: 'Photography', cleaning: 'Cleaning Service', spa: 'Spa / Wellness', gas_filling: 'Gas Filling', games: 'Gaming Centre', gaming: 'Gaming Centre', restaurant: 'Restaurant / Food', retail: 'Retail Store'
};
export function getStoreBusinessTypeLabel(s: any): string {
  const t = s?.data?.businessTemplate;
  const label = t?.label || t?.name;
  if (typeof label === 'string' && label.trim()) return label.trim();
  const type = String(t?.type || s?.data?.storeType || s?.business_type || s?.storeType || s?.category || '').trim().toLowerCase();
  return STORE_TYPE_LABELS[type] || (type ? type.replace(/_/g, ' ').replace(/\b\w/g, (m: string) => m.toUpperCase()) : 'Business');
}
export function getStoreLogoStyle(s: any): string {
  const value = s?.data?.profile?.logoStyle || s?.data?.logoStyle || s?.data?.businessTemplate?.logoStyle || (!isLogoImageUrl(s?.logo) ? s?.logo : null) || 'minimalist';
  return String(value).toLowerCase();
}
export function getStoreLogoUrl(s: any): string | null {
  const values = [s?.logo, s?.data?.profile?.logo, s?.data?.logo, s?.data?.marketplaceSettings?.logo];
  return values.find((v: any) => isLogoImageUrl(v)) || null;
}
export function getStoreBrandSvg(name: string, style: string): string {
  const safe = name.replace(/[&<>"']/g, '');
  const initial = safe.charAt(0).toUpperCase() || 'S';
  if (style === 'premium') return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="65" r="42" fill="none" stroke="#D97706" stroke-width="3"/><text x="120" y="80" text-anchor="middle" fill="#D97706" font-family="Arial" font-size="42" font-weight="700">' + initial + '</text><text x="120" y="135" text-anchor="middle" fill="#D97706" font-family="Arial" font-size="16" font-weight="800">' + safe + '</text></svg>';
  if (style === 'modern') return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="60" r="40" fill="none" stroke="#10B981" stroke-width="4"/><path d="M98 50h44l-5 30h-34z" fill="none" stroke="#10B981" stroke-width="4"/><text x="120" y="135" text-anchor="middle" fill="#0F172A" font-family="Arial" font-size="16" font-weight="800">' + safe + '</text></svg>';
  if (style === 'bold') return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="42" fill="#DC2626"/><text x="120" y="78" text-anchor="middle" fill="#fff" font-family="Arial" font-size="40" font-weight="900">' + initial + '</text><text x="120" y="135" text-anchor="middle" fill="#1E3A8A" font-family="Arial" font-size="16" font-weight="900">' + safe + '</text></svg>';
  if (style === 'professional') return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="40" fill="none" stroke="#064E3B" stroke-width="4"/><path d="M100 48h40v34h-40z" fill="none" stroke="#064E3B" stroke-width="4"/><text x="120" y="135" text-anchor="middle" fill="#064E3B" font-family="Arial" font-size="16" font-weight="800">' + safe + '</text></svg>';
  if (style === 'creative') return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="42" fill="#EC4899"/><text x="120" y="78" text-anchor="middle" fill="#fff" font-family="Arial" font-size="40" font-weight="900">' + initial + '</text><text x="120" y="135" text-anchor="middle" fill="#5B21B6" font-family="Arial" font-size="16" font-weight="800">' + safe + '</text></svg>';
  return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><path d="M96 54h48l-5 30h-38zM96 54l24-25 24 25" fill="none" stroke="#0F172A" stroke-width="4"/><text x="120" y="135" text-anchor="middle" fill="#0F172A" font-family="Arial" font-size="16" font-weight="800">' + safe + '</text></svg>';
}
export function computeStoreOpen(s: any): boolean {
  // NOTE: the stores table has no "status" column — it's "subscription_status".
  // Using store?.status here always evaluated to undefined, which made every
  // store appear closed regardless of merchant settings.
  if (s?.subscription_status === 'inactive' || s?.subscription_status === 'cancelled') return false;
  
  const ms = s?.data?.marketplaceSettings;
  if (ms && typeof ms === 'object') {
    if (ms.enabled === false || ms.storeOpen === false || ms.temporaryClosure === true || ms.temporarilyHidden === true) return false;
    if (!ms.openingTime || !ms.closingTime) return true;
    const now = new Date();
    if (Array.isArray(ms.businessDays) && !ms.businessDays.includes(now.getDay())) return false;
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    if (timeStr < ms.openingTime || timeStr > ms.closingTime) return false;
  }
  return true;
}

export const SERVICE_BUSINESS_TYPES = new Set(['laundry','barber','salon','tailoring','repair','printing','cyber_cafe','car_wash','photography','cleaning','spa','games','gaming','restaurant']);
export function getStoreBusinessType(storeData: any): string { return String(storeData?.data?.businessTemplate?.type || storeData?.data?.storeType || storeData?.storeType || storeData?.business_type || '').toLowerCase(); }
export function isServiceStore(storeData: any): boolean { const type=getStoreBusinessType(storeData); const modes=storeData?.data?.businessTemplate?.modes; return SERVICE_BUSINESS_TYPES.has(type) || (Array.isArray(modes) && modes.includes('services')); }
