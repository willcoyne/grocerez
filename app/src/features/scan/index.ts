// Scanning SmartLabel QR codes / barcodes and showing label data (shopping, lookup). Mount these in screens.
export { ScanSheet, type ScanSheetProps } from "./ScanSheet";
export type { ScanContext } from "./types";
export { ProductCard, FactsPanel, type ProductCardProps } from "./ProductCard";
export { useAllergenAudience, labelConflicts, type AllergenAudience, type AllergenHit } from "./allergens";
export { productLabelView, type LabelFacts, type LabelView } from "./labelView";
export { listRowFor } from "./ScanActions";
export { useScanSession, type ScanSession } from "./useScanSession";
