import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  HybridBinarizer,
  BinaryBitmap
} from '@zxing/library';
import jsQR from 'jsqr';

const ctx: Worker = self as any;

let reader: MultiFormatReader | null = null;

const initReader = () => {
  if (reader) return reader;
  reader = new MultiFormatReader();
  const hints = new Map();
  const formats = [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.PDF_417,
    BarcodeFormat.AZTEC
  ];
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  // TRY_HARDER makes ZXing re-attempt each frame at extra rotations and
  // scales. On a live 15fps camera feed that is wasted work: the next frame
  // arrives before the extra effort pays off, and it was the single largest
  // cost in the decode path. A code that misses one frame is caught on the
  // next one instead.
  hints.set(DecodeHintType.TRY_HARDER, false);
  reader.setHints(hints);
  return reader;
};

/**
 * Decode order matters.
 *
 * Almost every scan in this app is a StoreFlow store QR code, and jsQR reads
 * QR codes roughly an order of magnitude faster than a full ZXing
 * MultiFormatReader pass. Running ZXing first meant every QR scan paid for a
 * twelve-format search that was going to fail anyway before the cheap decoder
 * was even tried. jsQR now goes first and ZXing is the fallback that handles
 * the retail barcode formats (EAN/UPC/CODE_128/...) jsQR cannot read.
 */
ctx.onmessage = (e: MessageEvent) => {
  const { dataArray, width, height } = e.data;
  const data = new Uint8ClampedArray(dataArray);

  let resultText: string | null = null;
  let resultFormat: string | null = null;

  try {
    const qrResult = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
    if (qrResult?.data) {
      resultText = qrResult.data;
      resultFormat = 'QR_CODE';
    }
  } catch {
    // jsQR failed on this frame; fall through to ZXing.
  }

  if (!resultText) {
    try {
      const r = initReader();
      const len = width * height;
      const luminances = new Uint8ClampedArray(len);
      // The frame arrives already greyscaled by the canvas filter, so the red
      // channel is the luminance and the three-channel average is redundant.
      for (let i = 0; i < len; i++) {
        luminances[i] = data[i * 4];
      }

      const luminanceSource = new RGBLuminanceSource(luminances, width, height);
      const binarizer = new HybridBinarizer(luminanceSource);
      const binaryBitmap = new BinaryBitmap(binarizer);

      const decodeResult = r.decode(binaryBitmap);
      if (decodeResult) {
        resultText = decodeResult.getText();
        resultFormat = decodeResult.getBarcodeFormat().toString();
      }
    } catch {
      // No barcode in this frame — normal, the next frame is already coming.
    }
  }

  ctx.postMessage({ result: resultText, format: resultFormat });
};
