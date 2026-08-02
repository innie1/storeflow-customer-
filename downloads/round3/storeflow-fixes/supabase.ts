import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://jawfalghkftldvkopuaw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cbI7g6UDfa9kVg9iRxBHyQ_qks36Ooj";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Previously false/false — the app calls signUp/signInWithPassword/
    // signInWithOtp and reads the session back on every mount via
    // checkSession(), but with persistSession off that session only ever
    // lived in memory. Any reload (or a mobile browser reclaiming a
    // backgrounded tab) silently logged the customer out. Persisting it
    // to localStorage and letting it auto-refresh is what makes "logged
    // in" actually mean logged in across visits.
    persistSession: true,
    autoRefreshToken: true,
  }
});
