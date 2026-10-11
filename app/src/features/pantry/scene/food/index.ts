export { FoodItem, foodKindFor, isTap, TAP_SLOP_PX, HIGHLIGHT_INTRO_S, FLIP_DURATION_S, flipEase, flipPose, stepFlip, type FoodItemProps } from "./FoodItem";
export { FoodGallery, GALLERY_ITEMS } from "./FoodGallery";
export { foodVariantFor, truncateLabel, normalizeFoodText, type FoodVariant } from "./foodKind";
export { foodColorsFor, hashString } from "./palette";
export { getTextGeometry, getFoodFont, textWidth, buildFlatTextGeometry } from "./text";
export { ALLERGEN_RED, GLOW_PERIOD, glowPulse } from "./materials";
export { BackLabel } from "./BackLabel";
export { backLabelContent, layoutBackLabel, wrapText, layoutSegments, isFreshProduce, type BackLabelContent, type BackLayout } from "./backLabelLayout";
export { measureText, sanitizeLabelText } from "./fontMetrics";
