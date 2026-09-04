import { useState } from 'react';
import { supabase } from '../supabase';

/**
 * Email/password and phone-OTP sign-in.
 *
 * All of the form state (mode, email, password, phone, OTP, whether the OTP
 * field is showing) used to live on the root App component alongside the cart,
 * the scanner and the order history, even though nothing outside this screen
 * ever read it. It lives here now; App only learns that someone signed in.
 */
export default function LoginScreen({
  initialName,
  errorText,
  onBack,
  onAuthenticated,
  onError,
}: {
  initialName: string;
  errorText: string | null;
  onBack: () => void;
  onAuthenticated: (user: any) => void;
  onError: (message: string | null) => void;
}) {
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [profileName, setProfileName] = useState(initialName);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authOTP, setAuthOTP] = useState('');
  const [showOTPField, setShowOTPField] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleEmailAuth = async () => {
    setLoading(true);
    onError(null);
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
          options: { data: { full_name: profileName || 'Customer' } },
        });
        if (error) throw error;
        alert('Account created! Please log in.');
        setAuthMode('login');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        if (data.user) onAuthenticated(data.user);
      }
    } catch (e: any) {
      onError(e.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneOTPAuth = async () => {
    setLoading(true);
    onError(null);
    try {
      if (!showOTPField) {
        const { error } = await supabase.auth.signInWithOtp({ phone: authPhone });
        if (error) throw error;
        setShowOTPField(true);
        alert('OTP sent to phone!');
      } else {
        const { data, error } = await supabase.auth.verifyOtp({
          phone: authPhone,
          token: authOTP,
          type: 'sms',
        });
        if (error) throw error;
        if (data.user) onAuthenticated(data.user);
      }
    } catch (e: any) {
      onError(e.message || 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] p-6 flex flex-col justify-between max-w-md mx-auto relative z-10">
      <header className="h-14 flex items-center">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-white border border-gray-100 flex items-center justify-center cursor-pointer active-scale text-[#1A1C1E] shadow-sm">
          <span className="material-symbols-outlined text-lg">arrow_back</span>
        </button>
      </header>

      <main className="flex-1 flex flex-col justify-center space-y-6 pt-6">
        <div className="text-center md:text-left">
          <h1 className="text-3xl font-extrabold text-[#1A1C1E] font-headline-xl">
            {authMode === 'login' ? 'Welcome back 👋' : 'Create Account 🚀'}
          </h1>
          <p className="text-sm text-gray-500 mt-1 font-semibold">
            {authMode === 'login' ? 'Log in to your StoreFlow account' : 'Register to save addresses and track orders'}
          </p>
        </div>

        {errorText && (
          <div className="p-3.5 bg-red-50 text-red-700 text-xs rounded-xl font-bold border border-red-200">
            {errorText}
          </div>
        )}

        <form className="space-y-4" onSubmit={e => e.preventDefault()}>
          {authMode === 'signup' && (
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase px-1 tracking-wider">Full Name</label>
              <input
                type="text"
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold shadow-sm"
                placeholder="Enter full name"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase px-1 tracking-wider">Email Address</label>
            <input
              type="email"
              value={authEmail}
              onChange={e => setAuthEmail(e.target.value)}
              className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold shadow-sm"
              placeholder="name@example.com"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase px-1 tracking-wider">Password</label>
            <input
              type="password"
              value={authPassword}
              onChange={e => setAuthPassword(e.target.value)}
              className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold shadow-sm"
              placeholder="••••••••••••"
            />
          </div>

          <button
            onClick={handleEmailAuth}
            disabled={loading}
            className="w-full h-14 bg-[#1A1C1E] hover:bg-black text-white font-bold rounded-xl active-scale cursor-pointer transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Please wait...' : authMode === 'login' ? 'Log In' : 'Sign Up'}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-[1px] bg-gray-200" />
          <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">or phone OTP</span>
          <div className="flex-1 h-[1px] bg-gray-200" />
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase px-1 tracking-wider">Phone Number</label>
            <input
              type="tel"
              value={authPhone}
              onChange={e => setAuthPhone(e.target.value)}
              className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold shadow-sm"
              placeholder="+2348012345678"
            />
          </div>

          {showOTPField && (
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase px-1 tracking-wider">6-digit OTP Code</label>
              <input
                type="text"
                value={authOTP}
                onChange={e => setAuthOTP(e.target.value)}
                className="w-full px-4 h-12 bg-white text-[#1A1C1E] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A1C1E]/20 text-sm font-semibold text-center tracking-widest shadow-sm"
                placeholder="000000"
              />
            </div>
          )}

          <button
            onClick={handlePhoneOTPAuth}
            disabled={loading}
            className="w-full h-12 bg-[#FFD23F] text-slate-950 font-bold rounded-xl active-scale cursor-pointer flex items-center justify-center gap-2 shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-lg font-bold">sms</span>
            {showOTPField ? 'Verify OTP' : 'Send Phone OTP'}
          </button>
        </div>
      </main>

      <footer className="py-6 text-center">
        <button onClick={() => setAuthMode(m => m === 'login' ? 'signup' : 'login')} className="text-sm font-bold text-[#1A1C1E] cursor-pointer hover:underline">
          {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </button>
      </footer>
    </div>
  );
}
