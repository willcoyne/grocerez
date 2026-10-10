import { MeView } from '@/features/me/MeView';
import { useMeScreen } from '@/features/me/useMeScreen';

/** Me tab — DESIGN.md §4.7. Data hook + presentational view (§9). */
export default function MeScreen() {
  return <MeView model={useMeScreen()} />;
}
