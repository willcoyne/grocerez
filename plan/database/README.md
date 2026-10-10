# Database Development

PostgreSQL 16, managed with Prisma (`server/prisma/schema.prisma`). Raw SQL migrations are used
for extensions, partial indexes, and functions. The schema is the source of truth for both the
backend and the frontend's types.

## Features (build in order)

| Folder | Covers | Milestone |
|---|---|---|
| [01-setup-migrations](./01-setup-migrations) | Local Postgres, Prisma, extensions, migration workflow | M1 |
| [02-users](./02-users) | Users, diets, allergens | M1 |
| [03-groups-invites](./03-groups-invites) | Groups, members, email invite list | M2 |
| [04-item-catalog-fuzzy-matching](./04-item-catalog-fuzzy-matching) | Shared item catalog, aliases, Levenshtein + trigram search | M2 |
| [05-preferences](./05-preferences) | Per-user wanted items for a group | M2 |
| [06-cabinet](./06-cabinet) | Shared "what we have" set + status + expiration | M2 |
| [07-shopping-list](./07-shopping-list) | Computed list, check-offs, allergen flags | M2 |
| [08-product-data-cache](./08-product-data-cache) | SmartLabel / barcode product data, cached globally | M3 |
| [09-recalls-price-cache](./09-recalls-price-cache) | openFDA recalls, recall matches, price estimates | M3–M4 |
| [10-seed-data](./10-seed-data) | Demo data (the board's 4-user example) | Demo |
| [11-security-backups](./11-security-backups) | Roles, SSL, backups, data hygiene | Demo |

## Entity overview

```
users ─┬─< group_members >─┬─ groups ─┬─< group_invites (by email)
       │                    │          ├─< preferences >── items ──< item_aliases
       ├─< user_diets       │          ├─< cabinet_items >── items
       └─< user_allergens   │          ├─< shopping_list_items >── items
                                       └─< recall_matches >── recalls
items ──< products (one item, many branded products; global cache)
price_estimates (item × zip code, cache)
```

## Conventions

- Primary keys: `uuid` (`gen_random_uuid()`). Timestamps: `timestamptz`, named `created_at` and `updated_at`.
- Every row belonging to a group has a `group_id` column and an index on it. The backend filters every query by group.
- Table names are snake_case plural. Prisma models are PascalCase singular using `@@map`.
- Never edit a migration that has already been applied. Add a new one.
