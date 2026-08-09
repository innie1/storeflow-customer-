import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  action?: ReactNode;
}

/** Shared, additive Home-screen primitives. Keeps the existing Home logic intact. */
export function StoreFlowSectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-base sm:text-lg font-black tracking-tight text-[#1A1C1E]">{title}</h2>
      {action}
    </div>
  );
}

export function StoreFlowHomeSearchShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-full rounded-2xl bg-white border border-gray-200 shadow-sm transition-shadow focus-within:shadow-md focus-within:border-gray-300">
      {children}
    </div>
  );
}

export function StoreFlowQuickAction({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 px-4 py-3 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center justify-center gap-2 text-xs font-extrabold text-[#1A1C1E] hover:border-gray-200 hover:bg-gray-50 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD23F] focus-visible:ring-offset-2"
    >
      <span className="material-symbols-outlined text-base text-[#1A1C1E]">{icon}</span>
      {label}
    </button>
  );
}
