import Svg, { Rect } from 'react-native-svg';

import { color } from '@/theme';

/** 56×56 rounded square in primary with three shelf lines (DESIGN.md §4.1). Decorative. */
export function LogoMark({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 56 56" accessible={false}>
      <Rect width={56} height={56} rx={14} fill={color.primary} />
      <Rect x={14} y={17} width={28} height={3.5} rx={1.75} fill={color.onPrimary} />
      <Rect x={14} y={26.25} width={28} height={3.5} rx={1.75} fill={color.onPrimary} opacity={0.8} />
      <Rect x={14} y={35.5} width={20} height={3.5} rx={1.75} fill={color.onPrimary} opacity={0.6} />
    </Svg>
  );
}
