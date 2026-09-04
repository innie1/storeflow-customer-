/** Shown when a scanned code or deep link does not resolve to an active
 *  partner store. */
export default function StoreNotFoundScreen({ onGoHome }: { onGoHome: () => void }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-background text-on-surface">
      <div className="max-w-md w-full p-8 bg-surface-container rounded-3xl border border-outline-variant/10 shadow-xl space-y-6 animate-scale">
        <div className="w-20 h-20 bg-error-container text-error rounded-[28%] flex items-center justify-center mx-auto shadow-md">
          <span className="material-symbols-outlined text-4xl font-bold">storefront</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black tracking-tight text-on-background font-headline-xl">Store Not Found</h1>
          <p className="text-sm text-secondary leading-relaxed max-w-[280px] mx-auto">
            The link or QR code you scanned does not correspond to an active partner merchant on StoreFlow.
          </p>
        </div>
        <div className="pt-2">
          <button
            onClick={onGoHome}
            className="w-full h-14 bg-primary text-on-primary font-bold rounded-full shadow-lg active:scale-98 hover:bg-primary/95 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">home</span>
            <span>Go to Home Page</span>
          </button>
        </div>
      </div>
    </main>
  );
}
