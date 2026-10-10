import { z } from 'zod';

import { AllergenSchema } from './dietary';

// Request/response shapes from plan/backend/README.md (API contract), camelCased.
// Move to server/src/contracts when the backend exists.

export const categoryValues = [
  'produce',
  'bakery',
  'meat',
  'seafood',
  'dairy',
  'frozen',
  'pantry',
  'snacks',
  'beverages',
  'household',
  'other',
] as const;
export const CategorySchema = z.enum(categoryValues);
export type Category = z.infer<typeof CategorySchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  zipCode: z.string().nullable(),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const AuthResponseSchema = z.object({ token: z.string(), user: UserSchema });
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const RoleSchema = z.enum(['owner', 'member']);
export type Role = z.infer<typeof RoleSchema>;

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: RoleSchema, // the caller's role
  memberCount: z.number(),
  createdAt: z.string(),
});
export type Group = z.infer<typeof GroupSchema>;

export const MemberSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  role: RoleSchema,
  allergens: z.array(AllergenSchema), // see DECISIONS.md: needed for the Household tab
});
export type Member = z.infer<typeof MemberSchema>;

export const GroupDetailSchema = GroupSchema.extend({ members: z.array(MemberSchema) });
export type GroupDetail = z.infer<typeof GroupDetailSchema>;

export const InviteSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  email: z.string(),
  status: z.enum(['pending', 'accepted', 'declined', 'revoked']),
  invitedBy: z.object({ id: z.string(), displayName: z.string() }).nullable(),
  createdAt: z.string(),
});
export type Invite = z.infer<typeof InviteSchema>;

export const MyInviteSchema = InviteSchema.extend({
  group: z.object({ id: z.string(), name: z.string(), memberCount: z.number() }),
});
export type MyInvite = z.infer<typeof MyInviteSchema>;

export const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: CategorySchema,
  allergens: z.array(AllergenSchema), // items.default_allergens
});
export type Item = z.infer<typeof ItemSchema>;

export const ItemSearchSchema = z.object({
  match: z.enum(['exact', 'suggested', 'none']),
  results: z.array(ItemSchema),
});
export type ItemSearch = z.infer<typeof ItemSearchSchema>;

export const RecurrenceSchema = z.enum(['staple', 'one_time']);
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const PreferenceSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  userId: z.string(),
  itemId: z.string(),
  item: ItemSchema,
  quantityText: z.string().nullable(),
  recurrence: RecurrenceSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type Preference = z.infer<typeof PreferenceSchema>;

export const StockStatusSchema = z.enum(['in_stock', 'running_low']);
export type StockStatus = z.infer<typeof StockStatusSchema>;

export const CabinetItemSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  itemId: z.string(),
  item: ItemSchema,
  status: StockStatusSchema,
  quantityText: z.string().nullable(),
  location: z.enum(['fridge', 'freezer', 'pantry', 'other']).nullable(),
  purchasedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  expirationSource: z.enum(['manual', 'estimated']).nullable(),
  addedBy: z.string().nullable(),
});
export type CabinetItem = z.infer<typeof CabinetItemSchema>;

export const AllergenFlagSchema = z.object({ userId: z.string(), displayName: z.string(), allergen: AllergenSchema });
export type AllergenFlag = z.infer<typeof AllergenFlagSchema>;

export const ShoppingListItemSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  itemId: z.string(),
  item: ItemSchema,
  reason: z.enum(['preference', 'manual']),
  wantedBy: z.array(z.string()), // user IDs
  quantityText: z.string().nullable(),
  allergenFlags: z.array(AllergenFlagSchema),
  checked: z.boolean(),
  checkedBy: z.string().nullable(),
  checkedAt: z.string().nullable(),
  addedBy: z.string().nullable(),
});
export type ShoppingListItem = z.infer<typeof ShoppingListItemSchema>;

export const RanOutResultSchema = z.object({ requeued: z.boolean() });
export type RanOutResult = z.infer<typeof RanOutResultSchema>;

export const CompleteResultSchema = z.object({ movedToCabinet: z.number() });
export type CompleteResult = z.infer<typeof CompleteResultSchema>;
