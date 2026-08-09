import type { ReactNode } from 'react';

interface ExploreSectionHeaderProps {
  title: string;
  action?: ReactNode;
}

/**
 * Additive Explore primitives. They intentionally own presentation only so the
 * existing search, filtering, navigation, and Supabase logic stays unchanged.
 */
export function StoreFlowExploreSectionHeader({
  title,
  action,
}: ExploreSectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-base sm:text-lg font-black tracking-tight text-[#1A1C1E] dark:text-white">
        {title}
      </h2>
      {action}
    </div>
  );
}

export function StoreFlowExploreSearchShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="relative w-full rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-sm transition-shadow focus-within:shadow-md focus-within:border-gray-300 dark:focus-within:border-zinc-700">
      {children}
    </div>
  );
}

export function StoreFlowExploreFilterChip({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        'min-h-10 shrink-0 rounded-full px-4 py-2 text-xs font-extrabold transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD23F] focus-visible:ring-offset-2',
        active
          ? 'bg-[#1A1C1E] text-white dark:bg-white dark:text-[#1A1C1E]'
          : 'bg-white text-[#1A1C1E] border border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:bg-zinc-900 dark:text-white dark:border-zinc-800 dark:hover:border-zinc-700',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export function StoreFlowExploreResultCount({
  count,
  label = 'results',
}: {
  count: number;
  label?: string;
}) {
  return (
    <p className="text-xs font-bold text-gray-500 dark:text-zinc-400" aria-live="polite">
      {count.toLocaleString()} {label}
    </p>
  );
}

export function StoreFlowExploreEmptyState({
  title = 'Nothing found',
  message = 'Try a different search or filter.',
  action,
}: {
  title?: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-zinc-800">
        <span className="material-symbols-outlined text-xl text-gray-500 dark:text-zinc-400" aria-hidden="true">
          search_off
        </span>
      </div>
      <h3 className="text-sm font-black text-[#1A1C1E] dark:text-white">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
