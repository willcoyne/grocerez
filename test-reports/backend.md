# Backend API break test report

Branch: `worktree-agent-a96502bc7fdd2ae59`, based on `25cc1e9`. The tests are in `server/test/break/` (`npm run test:break`, config
`server/test/break/vitest.config.ts`). They are excluded from `npm test`, which still passes 146/146.
They ran against a separate local Postgres (`grocerez_test` on port 5434). Every external service was stubbed. Google ID tokens are
checked by the real google-auth-library against a locally generated RSA key; only the certificate download is stubbed. SmartLabel
fetches go to a local 127.0.0.1 server.

**Result: 33 tests, 30 pass, 3 fail. Each failing test is a finding. No Critical issues were found.**

## Summary

| ID | Severity | Area | Title | Test file |
|---|---|---|---|---|
| API-AUTH-1 | Medium | Auth | With `DEMO_KEY` set in production, `/dev/login-as` issues a token for **any** user id, including real Google accounts, not only the seeded demo users | `auth.test.ts` |
| API-INV-1 | Low | Invites | Pending invites sent by a member stay valid after the owner removes that member | `invites.test.ts` |
| API-AUTH-2 | Low | Auth | A validly signed JWT whose `sub` is not a UUID returns 500 instead of 401 | `auth.test.ts` |

## Findings

### API-AUTH-1 (Medium): the demo key can impersonate real users
- **Repro:** set `NODE_ENV=production` and `DEMO_KEY=k`, then send `POST /api/dev/login-as/<id of a real, non-seeded user>` with `x-demo-key: k`.
- **Expected:** 404. Plan backend/12 step 4 and database/10 limit this route to the seeded demo users.
- **Actual:** 200 with a session token for that user. User ids are visible to every group member (`GET /groups/:id` → `members[].id`),
  so anyone who has the shared demo key can sign in as any account.
- **Fix:** in `usersService.loginAs`, only allow the seeded ids (`google_sub LIKE 'seed-user-%'`), and compare the demo key in constant time.

### API-INV-1 (Low): a removed member's invites still work
- **Repro:** member M invites `x@…`. The owner removes M (`DELETE /groups/:g/members/:M`). Then `x` sends `POST /invites/:id/accept`.
- **Expected:** 404. Removing someone should cut off access they granted. The plan doesn't say this explicitly; backend/03 step 12 only revokes the removed person's own invite.
- **Actual:** 200, and `x` joins the household.
- **Fix:** in `removeMember` (and possibly `leave`), also revoke the pending invites where `invited_by = target`.

### API-AUTH-2 (Low): a JWT `sub` that isn't a UUID causes a 500
- **Repro:** sign a token `{sub:"not-a-uuid"}` with `JWT_SECRET`, then call `GET /api/me`.
- **Expected:** `401 UNAUTHENTICATED`.
- **Actual:** `500 INTERNAL`, because Prisma rejects the uuid. This needs the secret, so it is a hardening issue.
- **Fix:** in `verifyAppToken`, accept the token only when `sub` passes `z.uuid()`.

## Covered (all passing except the findings above)
- **Cross-household access:** a user from household B tried 27 group routes on household A's path, and 11 `:id` routes with household A's ids placed under household B's path
  (preferences, cabinet, ran-out, list rows, invites, recall-match dismiss, member removal). The calls returning group data were checked too.
  Every request got 404, household A's data was unchanged, and responses for a real foreign group and an unknown group were identical.
  Owner/member role checks (403) passed, and a removed member got 404 everywhere.
- **Auth:** missing or malformed headers, expired tokens, wrong signature, `alg:none`, HS512, a tampered payload, and a deleted user all got 401.
  For Google sign-in, a wrong audience, wrong issuer, expired token, foreign key, or HS256/PEM confusion got 401. `email_verified` set to
  false, `"true"` or missing got `EMAIL_NOT_VERIFIED` and created no user row. The 20/min rate limit works. With `NODE_ENV=production` and no `DEMO_KEY`, `/dev/login-as` is not reachable.
- **Invites:** a different account can't accept someone else's invite. Different casing or whitespace still matches the invited account, and look-alike addresses don't.
  Revoked, declined and already-accepted invites return 404. Inviting a member returns 409. Responses for known and unknown emails have the
  same status, body and headers, and their timing is within 15 ms. After removal the old invite is dead and a new invite works.
  Revoke permissions work (403 or 204). The 21st invite in an hour returns 429, including across groups.
- **SSRF (`/products/scan`):** 30 disallowed QR URLs were refused with `400 HOST_NOT_ALLOWED` before any fetch. They include localhost, 127.0.0.1 in
  decimal and hex, `[::1]`, 169.254.169.254, RFC 1918 addresses, `file:`, `gopher:`, `data:`, userinfo and fragment tricks, look-alike hosts, a non-443 port, and IDN dot tricks.
  11 redirect targets from an allowlisted page were refused, and the target was never fetched. They include local and metadata IPs, an https→http downgrade, a port, credentials,
  `file:`, a protocol-relative URL, and an external host. A redirect loop returns a clean 502.

## Not covered
- **Removed when the scope was cut:** the fast-check property tests of the shopping list engine, concurrency, input-validation fuzzing,
  realtime, AI output handling, uploads, and log leaks. Those tests had been written and run once before the cut, then deleted, so they are not in this commit.
  That run passed the shopping list engine property test (100 random runs). It also showed these problems:
  - The recipe allergen re-check ignores `steps`, `summary` and `allergenWarnings`.
  - The recipe allergen re-check misses common foods (pasta/bread → wheat, parmesan → milk, mayo/aioli → eggs, pesto, calamari, hummus, Worcestershire).
  - NUL bytes in text fields return 500.
  - Impossible dates return 500 (`2026-13-01`) or are silently rolled over (`2026-02-30` is stored as `2026-03-02`).
  - Content-Encoding errors from body-parser return 500.
  - SmartLabel bodies are fully buffered before the 2 MB "cap" is applied.
  - Non-string JSON-LD fields and malformed Open Food Facts JSON return 500.
  - A `group:join` that races with removing that member leaves the socket in the room.
  - Concurrent duplicate invites, scans and dietary PUTs return 409.
  - The presigned PUT has no size limit.

  These need a fresh run before they are treated as confirmed.
- **Never attempted:** DNS rebinding and subdomain takeover of the allowlisted `*.smartlabel.org` hosts (they need real DNS), and X-Forwarded-For handling behind the real proxy.
