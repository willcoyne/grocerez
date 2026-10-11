/**
 * One scanning session: camera results / typed barcodes → POST /products/scan → the product (or a friendly message).
 * Repeats of the same code are ignored for a while, and scanning pauses while a request is in flight or a result is shown.
 */
import type { Product, ScanBody } from "@contracts/products";
import { useCallback, useRef, useState } from "react";

import { errorMessage } from "@/api/client";
import { useScanProduct } from "@/api/hooks/products";
import { BAD_BARCODE, NOT_FOUND, scanErrorMessage, scanRequestFor } from "@/lib/scan";

/** Same code again within this window is ignored. */
export const REPEAT_MS = 2500;
/** After "Scan another", the code that was just shown is ignored a bit longer (it's probably still in view). */
export const AFTER_RESULT_MS = 5000;

export type ScanSession = ReturnType<typeof useScanSession>;

export function useScanSession() {
  const scan = useScanProduct();
  const [product, setProduct] = useState<Product | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const last = useRef<{ data: string; until: number } | null>(null);
  const inFlight = useRef(false);
  const shown = useRef(false);

  const lookup = useCallback(
    (body: ScanBody) => {
      inFlight.current = true;
      setMessage(null);
      setNotFound(false);
      scan.mutate(body, {
        onSuccess: (p) => {
          shown.current = true;
          setProduct(p);
        },
        onError: (e) => {
          const msg = scanErrorMessage(e, body);
          setNotFound(msg === NOT_FOUND);
          setMessage(msg ?? errorMessage(e));
        },
        onSettled: () => {
          inFlight.current = false;
        },
      });
    },
    [scan],
  );

  /** Camera callback ({type, data} from expo-camera). */
  const onScanned = useCallback(
    ({ type, data }: { type: string; data: string }) => {
      if (inFlight.current || shown.current) return;
      const now = Date.now();
      if (last.current && last.current.data === data && now < last.current.until) return;
      last.current = { data, until: now + REPEAT_MS };
      const req = scanRequestFor(type, data);
      if ("error" in req) {
        setNotFound(false);
        setMessage(req.error);
        return;
      }
      lookup(req.body);
    },
    [lookup],
  );

  /** Typed barcode digits (manual fallback). */
  const submitDigits = useCallback(
    (raw: string) => {
      if (inFlight.current) return;
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 8) {
        setNotFound(false);
        setMessage(BAD_BARCODE);
        return;
      }
      const req = scanRequestFor("ean13", digits);
      if ("error" in req) {
        setNotFound(false);
        setMessage(req.error);
        return;
      }
      shown.current = false;
      setProduct(null);
      lookup(req.body);
    },
    [lookup],
  );

  /** Back to scanning ("Scan another"). */
  const reset = useCallback(() => {
    if (last.current) last.current = { data: last.current.data, until: Date.now() + AFTER_RESULT_MS };
    shown.current = false;
    setProduct(null);
    setMessage(null);
    setNotFound(false);
  }, []);

  return {
    product,
    message,
    notFound,
    pending: scan.isPending,
    /** True while the camera should report codes. */
    scanning: !product && !scan.isPending,
    onScanned,
    submitDigits,
    reset,
    setMessage,
  };
}
