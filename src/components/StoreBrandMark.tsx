import { getStoreLogoUrl, getStoreLogoStyle, getStoreBrandSvg } from '../lib/storeIdentity';

/**
 * A store's logo, or a generated brand mark when the merchant has not uploaded
 * one (most pick a built-in style like "minimalist" or "bold" rather than
 * supplying an image).
 *
 * This is the only thing that should draw a store's identity. An external
 * script used to reach into the rendered DOM and repaint these boxes by hand,
 * which is how store names ended up near-white on white cards.
 */
export default function StoreBrandMark({ store }: { store: any }) {
  const url = getStoreLogoUrl(store);
  if (url) {
    return (
      <img
        loading="lazy"
        decoding="async"
        src={url}
        className="w-full h-full object-cover"
        alt=""
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div
      className="w-full h-full bg-white flex items-center justify-center"
      dangerouslySetInnerHTML={{ __html: getStoreBrandSvg(store?.business_name || 'Store', getStoreLogoStyle(store)) }}
    />
  );
}
