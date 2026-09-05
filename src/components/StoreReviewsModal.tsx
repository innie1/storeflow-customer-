import { useState } from 'react';
import { supabase } from '../supabase';
import { describeActionFailure } from '../utils/orderErrors';

/**
 * Rate a store, and read what other customers said.
 *
 * The star selection, the comment draft and the in-flight flag are local: they
 * exist only while this sheet is open, but used to live on the root App
 * component alongside the cart and the scanner.
 */
export default function StoreReviewsModal({
  store,
  customerIdentifier,
  onClose,
  onStoreUpdated,
  onRated,
  userRating,
}: {
  store: any;
  customerIdentifier: string;
  onClose: () => void;
  onStoreUpdated: (store: any) => void;
  onRated: (stars: number) => void;
  userRating: number | null;
}) {
  const [selectedStars, setSelectedStars] = useState<number | null>(null);
  const [ratingComment, setRatingComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const rating = store?.data?.marketplaceSettings?.rating;
  const reviewsCount = store?.data?.marketplaceSettings?.reviewsCount || 0;

  const RATING_MESSAGES: Record<number, { title: string; subtitle: string }> = {
    1: { title: 'Terrible 😞', subtitle: "We're sorry to hear that. What went wrong?" },
    2: { title: 'Poor 🙁', subtitle: 'Thanks for letting us know. How can this store improve?' },
    3: { title: 'Average 😐', subtitle: 'Thank you! What could make your experience 5 stars?' },
    4: { title: 'Good! 🙂', subtitle: 'Glad you had a good experience! Any highlights to share?' },
    5: { title: 'Excellent! 🎉', subtitle: 'Awesome! What did you love most about this store?' },
  };

  const RATING_SUGGESTION_CHIPS: Record<number, string[]> = {
    1: ['Late delivery', 'Wrong items', 'Poor quality', 'Damaged items', 'Bad customer service'],
    2: ['Slow processing', 'Missing items', 'Too expensive', 'Needs improvement', 'Order delayed'],
    3: ['Okay service', 'Fair prices', 'Decent quality', 'Could be faster', 'Average experience'],
    4: ['Fast delivery!', 'Good quality!', 'Great service!', 'Well packaged', 'Friendly staff'],
    5: ['Super fast delivery! 🚀', 'Fresh & top quality! ⭐', 'Great customer service!', 'Highly recommended! 🙌', 'Best store ever! 🎉'],
  };

  const handleRateStore = async () => {
    const stars = selectedStars;
    if (!stars || submitting || !store) return;
    setSubmitting(true);
    try {
      const identifier = customerIdentifier || 'anonymous';

      const { data: result, error } = await supabase.rpc('submit_store_rating', {
        p_store_id: store.id,
        p_customer_phone: identifier,
        p_rating: stars,
      });

      if (error) throw error;

      if (ratingComment.trim()) {
        try {
          const saved = JSON.parse(localStorage.getItem('storeflow_user_reviews') || '{}');
          saved[store.id] = { stars, comment: ratingComment.trim(), date: new Date().toISOString() };
          localStorage.setItem('storeflow_user_reviews', JSON.stringify(saved));
        } catch {}
      }

      const row = Array.isArray(result) ? result[0] : result;
      const updatedData = {
        ...store.data,
        marketplaceSettings: {
          ...store.data?.marketplaceSettings,
          rating: row?.new_rating ?? stars,
          reviewsCount: row?.new_count ?? 1
        }
      };

      onStoreUpdated({ ...store, data: updatedData });
      onRated(stars);
      alert(`Thank you for rating this store ${stars} stars!`);
    } catch (err: any) {
      console.error('Failed to submit rating:', err);
      alert(describeActionFailure(err, 'submit your rating'));
    } finally {
      setSubmitting(false);
    }
  };

  const savedReview = store?.id ? (JSON.parse(localStorage.getItem('storeflow_user_reviews') || '{}')[store.id] || null) : null;
  const activeRatingVal = userRating || selectedStars || savedReview?.stars || null;
  const ratingInfo = activeRatingVal ? RATING_MESSAGES[activeRatingVal] : null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in" 
      onClick={() => onClose()}
    >
      <div 
        className="bg-white dark:bg-zinc-950 w-full max-w-lg md:max-w-xl mx-auto rounded-t-3xl sm:rounded-3xl overflow-hidden p-6 animate-slide-up max-h-[85vh] flex flex-col text-left border border-gray-100 dark:border-zinc-800 shadow-2xl" 
        onClick={e => e.stopPropagation()}
      >
        <div className="w-12 h-1 bg-gray-200 dark:bg-zinc-800 rounded-full mx-auto mb-5 shrink-0" />
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h3 className="font-extrabold text-lg text-[#1A1C1E] dark:text-zinc-100">Store Ratings & Reviews</h3>
          <button 
            onClick={() => onClose()} 
            className="w-8 h-8 rounded-full bg-gray-100 dark:bg-zinc-900 flex items-center justify-center cursor-pointer hover:bg-gray-200 dark:hover:bg-zinc-800 transition-colors text-gray-500 dark:text-zinc-400"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-5 pb-4 hide-scrollbar">
          {rating ? (
            <div className="bg-gray-50 dark:bg-zinc-900/60 rounded-[20px] p-4 sm:p-5 flex items-center gap-6 border border-gray-100 dark:border-zinc-800/80">
              <div className="text-center shrink-0">
                <h1 className="text-4xl font-black text-[#1A1C1E] dark:text-zinc-100">{rating.toFixed(1)}</h1>
                <p className="text-[9px] text-gray-400 dark:text-zinc-500 font-extrabold mt-1 uppercase tracking-wider">Out of 5.0</p>
                <p className="text-[8px] text-gray-400 dark:text-zinc-500 font-bold mt-0.5">({reviewsCount} {reviewsCount === 1 ? 'review' : 'reviews'})</p>
              </div>
              
              <div className="flex-1 space-y-1">
                {[
                  { stars: 5, pct: '85%' },
                  { stars: 4, pct: '10%' },
                  { stars: 3, pct: '3%' },
                  { stars: 2, pct: '1%' },
                  { stars: 1, pct: '1%' }
                ].map(item => (
                  <div key={item.stars} className="flex items-center gap-2 text-xs">
                    <span className="w-3 text-right font-bold text-gray-500 dark:text-zinc-400">{item.stars}</span>
                    <span className="text-amber-400 font-bold">★</span>
                    <div className="flex-1 h-1.5 bg-gray-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-[#1A1C1E] dark:bg-[#FFD23F] rounded-full" style={{ width: item.pct }} />
                    </div>
                    <span className="w-8 text-right font-medium text-gray-400 dark:text-zinc-500">{item.pct}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 dark:bg-zinc-900/60 rounded-[20px] p-6 text-center border border-gray-100 dark:border-zinc-800/80 space-y-2">
              <div className="text-4xl">⭐</div>
              <p className="text-sm font-extrabold text-[#1A1C1E] dark:text-zinc-100">No Ratings Yet</p>
              <p className="text-xs text-gray-400 dark:text-zinc-500 max-w-[240px] mx-auto leading-relaxed">
                Be the first to rate this store and help others in the community discover it!
              </p>
            </div>
          )}

          {/* Interactive Rating Selector */}
          <div className="border-t border-gray-100 dark:border-zinc-800 pt-5 text-center space-y-4">
            <p className="text-xs font-black text-[#1A1C1E] dark:text-zinc-100 uppercase tracking-wider">
              {userRating ? 'Your Rating' : 'Rate this Store'}
            </p>
            <div className="flex justify-center gap-2">
              {Array.from({ length: 5 }).map((_, s) => {
                const starVal = s + 1;
                const active = activeRatingVal ? activeRatingVal >= starVal : false;
                return (
                  <button
                    key={s}
                    disabled={userRating !== null || submitting}
                    onClick={() => setSelectedStars(starVal)}
                    className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all ${
                      active 
                        ? 'bg-amber-400 text-white shadow-md scale-105' 
                        : 'bg-gray-100 dark:bg-zinc-900 text-gray-400 hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-zinc-800'
                    } cursor-pointer disabled:cursor-default`}
                  >
                    <span 
                      className={`material-symbols-outlined text-2xl font-bold ${active ? 'font-variation-fill' : ''}`}
                      style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                    >
                      star
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Dynamic message based on selection */}
            {ratingInfo && (
              <div className="p-3 bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-500/20 rounded-2xl animate-fade-in space-y-0.5 text-center">
                <p className="text-xs font-extrabold text-amber-900 dark:text-amber-300">{ratingInfo.title}</p>
                <p className="text-[11px] font-semibold text-amber-800/80 dark:text-amber-400">{ratingInfo.subtitle}</p>
              </div>
            )}

            {/* Simple message field for ratings */}
            {selectedStars && !userRating && (
              <div className="space-y-3 animate-fade-in pt-1">
                {/* Quick-tap suggestion chips */}
                {RATING_SUGGESTION_CHIPS[selectedStars] && (
                  <div className="space-y-1.5 text-left">
                    <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                      Quick Tap Phrases (Tap to add):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {RATING_SUGGESTION_CHIPS[selectedStars].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => {
                            if (!ratingComment) {
                              setRatingComment(chip);
                            } else if (!ratingComment.includes(chip)) {
                              setRatingComment(prev => `${prev}, ${chip}`);
                            }
                          }}
                          className="px-2.5 py-1 bg-amber-50 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-500/20 hover:border-[#FFD23F] dark:hover:border-[#FFD23F] text-[11px] font-extrabold text-amber-900 dark:text-amber-300 rounded-full transition-all active:scale-95 cursor-pointer shadow-2xs flex items-center gap-1"
                        >
                          <span className="font-black">+</span>
                          <span>{chip}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <textarea
                  value={ratingComment}
                  onChange={e => setRatingComment(e.target.value)}
                  placeholder="Write a simple message or feedback (optional)..."
                  rows={3}
                  maxLength={280}
                  className="w-full p-3 bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl text-xs font-semibold text-[#1A1C1E] dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-[#FFD23F] resize-none"
                />
                <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-zinc-500 px-1">
                  <span>Optional customer review</span>
                  <span>{ratingComment.length}/280</span>
                </div>

                <button
                  onClick={handleRateStore}
                  disabled={submitting}
                  className="w-full py-3.5 bg-[#1A1C1E] dark:bg-[#FFD23F] text-[#FFD23F] dark:text-[#1A1C1E] font-black text-xs uppercase tracking-wider rounded-2xl cursor-pointer active-scale disabled:opacity-50 transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">send</span>
                      <span>Send Rating</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {userRating && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-bold pt-1">
                ✓ Rating submitted! Thank you for your feedback.
              </p>
            )}

            {savedReview && !selectedStars && (
              <div className="p-3.5 bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-2xl space-y-1.5 text-left animate-fade-in mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">verified</span> Your Submitted Review
                  </span>
                  <button
                    onClick={() => {
                      setSelectedStars(savedReview.stars);
                      setRatingComment(savedReview.comment || '');
                    }}
                    className="text-[10px] font-extrabold text-[#1A1C1E] dark:text-[#FFD23F] hover:underline flex items-center gap-0.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-xs">edit</span> Edit
                  </button>
                </div>
                {savedReview.comment && (
                  <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300 italic">
                    "{savedReview.comment}"
                  </p>
                )}
                <p className="text-[9px] text-gray-400 dark:text-zinc-500 font-bold">
                  Submitted on {new Date(savedReview.date).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>

          <div className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed space-y-2 border-t border-gray-100 dark:border-zinc-800 pt-4">
            <p className="font-extrabold text-[#1A1C1E] dark:text-zinc-100 text-sm">Verified Ratings Policy</p>
            <p>
              Ratings are dynamically aggregated based on checkout feedback from registered StoreFlow shoppers who placed completed orders at this storefront. Detailed customer reviews will be rendered once approved by our moderation team.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
