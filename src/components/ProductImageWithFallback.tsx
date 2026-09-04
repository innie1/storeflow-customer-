import { useState } from 'react';
import { getProductCategoryType } from '../lib/productCategories';

/** A product photo, falling back to a drawn icon for the item's packaging
 *  type — most merchant catalogs have no images at all. */
export default function ProductImageWithFallback({
  src,
  alt = '',
  className = '',
  productName = '',
  category = '',
  unit = '',
  isService = false,
}: {
  src?: string;
  alt?: string;
  className?: string;
  productName?: string;
  category?: string;
  unit?: string;
  isService?: boolean;
}) {
  const [hasError, setHasError] = useState(false);

  if (src && !hasError) {
    return (
      <img loading="lazy" decoding="async"
        src={src}
        alt={alt || productName}
        className={className}
        onError={() => setHasError(true)}
      />
    );
  }

  const type = isService
    ? 'service'
    : getProductCategoryType(productName, category, unit);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center group-hover:scale-105 transition-transform">
      {type === 'bottle' && (
        <svg className="w-10 h-10 text-amber-500/80 dark:text-amber-400/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 2h4v3a2 2 0 0 0 .5 1.3l1.8 2.2a3 3 0 0 1 .7 1.9V20a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9.6a3 3 0 0 1 .7-1.9l1.8-2.2A2 2 0 0 0 10 5V2z" fill="currentColor" fillOpacity="0.15" />
          <line x1="8" y1="13" x2="16" y2="13" strokeDasharray="2 2" />
          <rect x="9" y="1" width="6" height="2" rx="0.5" fill="currentColor" />
        </svg>
      )}
      {type === 'sachet' && (
        <svg className="w-10 h-10 text-emerald-500/80 dark:text-emerald-400/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="currentColor" fillOpacity="0.15" />
          <line x1="5" y1="6" x2="19" y2="6" />
          <line x1="5" y1="18" x2="19" y2="18" />
          <rect x="8.5" y="9.5" width="7" height="5" rx="1" fill="currentColor" fillOpacity="0.2" />
        </svg>
      )}
      {type === 'box' && (
        <svg className="w-10 h-10 text-sky-500/80 dark:text-sky-400/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" fill="currentColor" fillOpacity="0.15" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      )}
      {type === 'can' && (
        <svg className="w-10 h-10 text-rose-500/80 dark:text-rose-400/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <ellipse cx="12" cy="5" rx="7" ry="3" fill="currentColor" fillOpacity="0.2" />
          <path d="M5 5v14c0 1.66 3.13 3 7 3s7-1.34 7-3V5" />
          <ellipse cx="12" cy="12" rx="7" ry="2" strokeDasharray="2 2" />
        </svg>
      )}
      {type === 'fresh' && (
        <svg className="w-10 h-10 text-emerald-600/80 dark:text-emerald-300/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="13" r="7" fill="currentColor" fillOpacity="0.15" />
          <path d="M12 6c.5-2 2-3.5 4-3.5 0 2-1.5 3.5-4 3.5z" fill="currentColor" />
          <path d="M12 6c-.5-2-2-3.5-4-3.5 0 2 1.5 3.5 4 3.5z" />
        </svg>
      )}
      {type === 'service' && (
        <svg className="w-10 h-10 text-purple-500/80 dark:text-purple-400/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8" />
          <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.2" />
        </svg>
      )}
      {type === 'general' && (
        <svg className="w-10 h-10 text-indigo-500/80 dark:text-indigo-400/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" fill="currentColor" fillOpacity="0.15" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      )}
      <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mt-1 truncate max-w-[90%]">
        {type}
      </span>
    </div>
  );
}
