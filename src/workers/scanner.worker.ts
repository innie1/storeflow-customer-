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
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  return reader;
};

ctx.onmessage = (e: MessageEvent) => {
  const { dataArray, width, height } = e.data;
  const data = new Uint8ClampedArray(dataArray);

  let resultText: string | null = null;
  let resultFormat: string | null = null;

  // 1. Try Decoder 1: ZXing
  try {
    const r = initReader();
    const len = width * height;
    const luminances = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i++) {
      // Calculate luminance: (R + G + B) / 3
      luminances[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
    }

    const luminanceSource = new RGBLuminanceSource(luminances, width, height);
    const binarizer = new HybridBinarizer(luminanceSource);
    const binaryBitmap = new BinaryBitmap(binarizer);

    const decodeResult = r.decode(binaryBitmap);
    if (decodeResult) {
      resultText = decodeResult.getText();
      resultFormat = decodeResult.getBarcodeFormat().toString();
    }
  } catch (err) {
    // ZXing failed
  }

  // 2. Try Decoder 2: jsQR Fallback (only if ZXing failed)
  if (!resultText) {
    try {
      const qrResult = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
      if (qrResult && qrResult.data) {
        resultText = qrResult.data;
        resultFormat = 'QR_CODE';
      }
    } catch (err) {
      // jsQR failed
    }
  }

  ctx.postMessage({ result: resultText, format: resultFormat });
};
