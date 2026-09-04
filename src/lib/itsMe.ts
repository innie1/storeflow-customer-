import { safeGetItem, safeSetItem, safeGetJSON, safeSetJSON } from '../utils/safeStorage';

/**
 * "It'sMe" is the customer's local identity: the name, phone, addresses and
 * delivery preferences that prefill checkout across every storefront. It lives
 * on the device — checking out never requires an account.
 */

export interface ItsMe {
  customerId: string;
  displayName: string;
  phone: string;
  email: string;
  profilePhoto?: string;
  addresses: string[];
  landmarks: string[];
  deliveryInstructions: string;
  preferredPayment: string;
  dateJoined: string;
  lastUpdated: string;
}

export function loadItsMeProfile(): ItsMe {
  const parsed = safeGetJSON<ItsMe | null>('storeflow_itsme', null);
  if (parsed && typeof parsed === 'object') return parsed;

  const id = safeGetItem('storeflow_customer_uuid') || crypto.randomUUID();
  safeSetItem('storeflow_customer_uuid', id);
  return {
    customerId: id,
    displayName: safeGetItem('storeflow_saved_checkout_name') || '',
    phone: safeGetItem('storeflow_saved_checkout_phone') || '',
    email: '',
    addresses: safeGetItem('storeflow_pref_address') ? [safeGetItem('storeflow_pref_address')!] : [],
    landmarks: safeGetItem('storeflow_saved_checkout_landmark') ? [safeGetItem('storeflow_saved_checkout_landmark')!] : [],
    deliveryInstructions: safeGetItem('storeflow_saved_checkout_notes') || '',
    preferredPayment: safeGetItem('storeflow_pref_payment_method') || 'cash',
    dateJoined: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

export function saveItsMeProfile(profile: ItsMe) {
  const updated = { ...profile, lastUpdated: new Date().toISOString() };
  safeSetJSON('storeflow_itsme', updated);
  return updated;
}
