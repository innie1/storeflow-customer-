import { useState, useEffect } from 'react';

const SEARCH_PLACEHOLDER_PHRASES = [
  'Search for products...',
  'Search for stores...',
  'Search for brands...',
  'Search groceries near you...',
];

/**
 * The home search box types its own placeholder.
 *
 * This deliberately owns the animation state itself. It used to live in App,
 * where a `setState` every 40-100ms re-rendered the entire application — every
 * product grid, store card and modal — around twenty times a second, forever,
 * for a decorative placeholder. Keeping it here means the animation repaints
 * one input and nothing else. It also stops once the customer starts typing,
 * and never runs at all for people who ask for reduced motion.
 */
export default function SearchPlaceholderInput({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  ariaLabel: string;
}) {
  const [placeholder, setPlaceholder] = useState(SEARCH_PLACEHOLDER_PHRASES[0]);
  const paused = value.length > 0;

  useEffect(() => {
    if (paused) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setPlaceholder(SEARCH_PLACEHOLDER_PHRASES[0]);
      return;
    }

    let phraseIdx = 0;
    let charIdx = SEARCH_PLACEHOLDER_PHRASES[0].length;
    let isDeleting = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const phrase = SEARCH_PLACEHOLDER_PHRASES[phraseIdx];
      charIdx += isDeleting ? -1 : 1;
      setPlaceholder(phrase.slice(0, charIdx));

      let speed = isDeleting ? 40 : 100;
      if (!isDeleting && charIdx === phrase.length) {
        speed = 2000;
        isDeleting = true;
      } else if (isDeleting && charIdx === 0) {
        isDeleting = false;
        phraseIdx = (phraseIdx + 1) % SEARCH_PLACEHOLDER_PHRASES.length;
        speed = 300;
      }
      timer = setTimeout(tick, speed);
    };

    timer = setTimeout(tick, 1000);
    return () => clearTimeout(timer);
  }, [paused]);

  return (
    <input
      className={className}
      placeholder={placeholder}
      aria-label={ariaLabel}
      type="search"
      enterKeyHint="search"
      autoComplete="off"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  );
}
