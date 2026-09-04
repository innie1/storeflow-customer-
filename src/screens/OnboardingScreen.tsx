import heroImage from '../assets/hero.png';
import { safeSetItem } from '../utils/safeStorage';

/**
 * First-launch welcome. Every exit from here marks the customer as onboarded,
 * so the flag is set in one place rather than repeated on each button.
 */
export default function OnboardingScreen({ onFinish }: { onFinish: (next: 'home' | 'login') => void }) {
  const finish = (next: 'home' | 'login') => {
    safeSetItem('storeflow_onboarded', 'true');
    onFinish(next);
  };

  return (
        <div className="bg-[#F8F9FA] min-h-screen text-[#1A1C1E] flex flex-col justify-between p-6 max-w-md mx-auto">
          <div className="flex justify-end pt-4">
            <button onClick={() => finish('home')} className="text-sm font-bold text-gray-400 hover:text-black cursor-pointer">Skip</button>
          </div>
          <main className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl font-black text-[#1A1C1E] font-headline-xl">Welcome to StoreFlow</h1>
              <p className="text-sm text-gray-500 max-w-xs mx-auto leading-relaxed font-semibold">
                Connect to nearby stores, select products, and check out in under a minute.
              </p>
            </div>
            <div className="relative w-72 h-72 bg-white border border-gray-100 rounded-[40px] shadow-sm overflow-hidden flex items-center justify-center p-6">
              <img className="w-full h-full object-cover rounded-3xl" src={heroImage} alt="" width={288} height={288} fetchPriority="high" decoding="async" />
            </div>
            <div className="flex justify-center space-x-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-gray-200"></div>
              <div className="h-1.5 w-6 rounded-full bg-[#1A1C1E]"></div>
              <div className="h-1.5 w-1.5 rounded-full bg-gray-200"></div>
            </div>
          </main>
          <footer className="space-y-4 pb-8">
            <button onClick={() => finish('login')} className="w-full h-14 bg-[#1A1C1E] text-white font-bold rounded-xl active-scale cursor-pointer hover:bg-black transition-colors shadow-sm">
              Get Started
            </button>
            <button onClick={() => finish('home')} className="w-full h-14 bg-white border border-gray-200 text-[#1A1C1E] font-bold rounded-xl active-scale cursor-pointer hover:bg-gray-50 transition-colors shadow-sm">
              Explore as Guest
            </button>
          </footer>
        </div>
  );
}
