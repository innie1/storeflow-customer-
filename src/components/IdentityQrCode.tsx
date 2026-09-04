import { useEffect, useState } from 'react';

/**
 * Renders the customer's It'sMe identity as a QR code, generated on the device.
 *
 * This used to be an <img> pointed at api.qrserver.com with the customer's
 * identity UUID in the query string, so every view of the It'sMe screen handed
 * that identifier to an unrelated third party, and the code simply failed to
 * appear whenever that service was slow, down or blocked.
 *
 * @zxing/library is already a dependency (the scanner uses it to read codes; it
 * can write them too). It is imported dynamically so the encoder is fetched
 * only when someone actually opens this screen, keeping it out of the main
 * bundle.
 */
export default function IdentityQrCode({ value, size = 160 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    if (!value) return;

    (async () => {
      try {
        // Deep import: pulling BrowserQRCodeSvgWriter off the package barrel
        // drags in every reader and decoder ZXing ships (~410 kB). This path
        // is just the QR writer.
        const { BrowserQRCodeSvgWriter } = await import('@zxing/library/esm/browser/BrowserQRCodeSvgWriter.js');
        const element = new BrowserQRCodeSvgWriter().write(value, size, size);
        if (cancelled) return;
        setSvg(new XMLSerializer().serializeToString(element));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => { cancelled = true; };
  }, [value, size]);

  if (failed) {
    return (
      <div
        className="bg-white rounded-2xl mx-auto flex items-center justify-center text-center p-3"
        style={{ width: size, height: size }}
      >
        <span className="text-[10px] font-bold text-gray-400 break-all">{value}</span>
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label="Your It'sMe identity QR code"
      className="bg-white p-2.5 rounded-2xl mx-auto [&>svg]:w-full [&>svg]:h-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
