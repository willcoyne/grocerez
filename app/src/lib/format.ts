import type { Member } from '@contracts/models';

/** "tree_nuts" → "Tree nuts", "dairy" → "Dairy". */
export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Lowercase label for allergens inside sentences: "tree_nuts" → "tree nuts". */
export function allergenLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

/** "you" for the current user, otherwise the member's display name. */
export function nameFor(userId: string, meId: string | undefined, members: Pick<Member, 'id' | 'displayName'>[]): string {
  if (userId === meId) return 'you';
  return members.find((m) => m.id === userId)?.displayName ?? 'someone';
}

/** Joins user IDs as "you, Carson, Maya". */
export function namesFor(userIds: string[], meId: string | undefined, members: Pick<Member, 'id' | 'displayName'>[]): string {
  return userIds.map((id) => nameFor(id, meId, members)).join(', ');
}

/** "1 item" / "3 items". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Stable small hash for avatar colors. */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}
