# 08 — Item Details, Expiration & Alerts

**Goal:** Show everything about an item, let users fix expiration dates, and surface expiring items and recall alerts.
**Board:** "ELEVATED FEATURES — EXPIRATION DATE TRACKING, FOOD OUTBREAKS — track based on the smart label" · "smart label contains … when it expires"

**Depends on:** 05, 07, `backend/09-expiration-recalls`

## Steps

1. **ItemDetail modal** (opened from cabinet rows): name, product info from the scan (if any; same layout as the scanner result sheet),
   location, purchased date, and **expiration**:
   - Shows "Expires Oct 14 (estimated)" or "(you set this)".
   - "Edit date" → native date picker → `PATCH cabinet {expiresAt}`.
   - Actions: Running low / Ran out / Remove (same as `05`).
2. **After "Finish trip"** (`06`): an optional sheet "Check expiration dates?" listing the newly added items with their estimated dates,
   each editable inline. Skipping keeps the estimates.
3. **Alerts** (on the Group tab, with a badge count on the tab icon): `GET /groups/:gid/alerts`.
   - **Expiring soon:** items expiring within 3 days (red if already expired). Tap → ItemDetail. Inline "Find recipes" → `09`.
   - **Possible recalls:** card with the recall reason, class, firm, date, and "View FDA notice". Copy says
     "This *may* match your {item}. Check the package." [Dismiss] → `POST …/dismiss`.
4. **Local notifications** (`expo-notifications`):
   - Ask for permission after the first finish trip (not on launch).
   - When the cabinet query loads, (re)schedule one local notification per item for 9am on the day before `expires_at`
     ("Milk expires tomorrow"). Cancel and reschedule when cabinet data changes. Keep at most 20 scheduled.
   - Recalls: show a banner in the app when a new match appears (server push notifications are a stretch goal).

## Done when

- [ ] Every cabinet item shows an expiration pill and can be edited
- [ ] The seeded recall shows in Alerts and can be dismissed
- [ ] A test item expiring tomorrow produces a local notification
