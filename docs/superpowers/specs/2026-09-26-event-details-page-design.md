# Event details page — design

Date: 2026-09-26
Repo: `tamrin-landing-page` (Netlify, branch `main`)
Surface: the admin dashboard (`/admin`) — one responsive build

## 1. Goal

Clicking an active event in the dashboard opens a full event page that shows who
is registered (the member list, the main section) plus the insights an admin needs
to judge how the event is going: seats, payment, how the group responded, the
waitlist, and how fast it filled.

## 2. Current state

- `admin.html` / `assets/admin.js` / `assets/admin-data.js` keep a strict split:
  markup, UI logic, and the sole server touchpoint (`TamrinData`, with a `USE_MOCK`
  path that must keep working).
- The active-events table (`eventsBody`) renders rows from
  `admin_list_active_events()`; rows are not clickable today.
- The player profile sheet (`TamrinPlayer.open(userId)`) already exists and is
  reused here.
- As of 2026-09-26 the active-events list and overview only include events whose
  workspace has more than 3 members counting the owner.

## 3. Backend reality (prod `timrin-prod`, ref `hzsxwnmbdkrmipjtfzlp`)

From `supabase gen types` on 2026-09-26:

- `event_participants(id, event_id, user_id?, guest_name?, guest_only,
  added_manually, added_by?, payment_status, paid_price_per_person?,
  payment_group_size?, payment_declared_at?, created_at, …)`. `user_id` is null
  for guests.
- `event_waitlist(event_id, user_id, joined_at)`.
- `event_member_responses(event_id, user_id, status, reason_code?, reason_text?,
  responded_at?, invited_at?, invited_by?, updated_at)`.
- `workspace_members(workspace_id, user_id, joined_at)`; `workspaces.owner_id`.
  The owner may have no `workspace_members` row.

### Status values (verified on prod 2026-09-26)

| column | value | count | meaning here |
| --- | --- | --- | --- |
| `event_participants.payment_status` | `confirmed` | 117 | paid |
| | `waived` | 70 | excused — owes nothing, collected nothing |
| | `pending` | 46 | not paid yet |
| `event_member_responses.status` | `invited` | 148 | invited, no answer yet |
| | `declined` | 19 | declined |

Any other `payment_status` value that appears later is treated as `pending` and
shown with its raw value. Registration is read from `event_participants`, not from
responses: a registered member counts as registered whatever their response row
says.

## 4. Data: one RPC

`admin_event_details(p_event_id uuid) returns json` — `security definer`, `stable`,
`set search_path = public, pg_temp`, gated by `is_current_user_admin()` (errcode
`42501`), `revoke … from public, anon; grant … to authenticated`. Does **not**
apply the >3-members filter: it is opened by id. Returns `null` when the event
does not exist.

```jsonc
{
  "event": { "id", "name", "description", "workspace_id", "workspace_name",
             "creator_name", "location", "start_date", "end_date",
             "price_per_person", "total_price", "max_participants",
             "registration_locked", "published_at", "cancelled_at" },
  "participants": [ { "id", "user_id", "name", "avatar_url", "postion",
                      "is_guest", "added_manually", "added_by_name",
                      "payment_status", "paid_amount", "registered_at" } ],
  "waitlist":     [ { "user_id", "name", "avatar_url", "joined_at" } ],
  "declined":     [ { "user_id", "name", "avatar_url", "reason_code", "reason_text", "responded_at" } ],
  "no_reply":     [ { "user_id", "name", "avatar_url" } ],
  "group_size": 12
}
```

- `name` for a guest is `guest_name`; for a user, `users.name` via `LEFT JOIN`
  with `'—'` fallback (same pattern as `creator_name`).
- `paid_amount` = `coalesce(paid_price_per_person, price_per_person)` for
  `payment_status = 'confirmed'`, else `0` (so `waived` and `pending` add nothing).
- `group_size` = non-owner members + 1 (same counting rule as the list filter).
- `declined` = response rows with `status = 'declined'` whose user is not a
  participant.
- `no_reply` = group members (owner included) who are not participants, not on
  the waitlist, and not in `declined` — whether they have an `invited` row or no
  row at all.
- Participants ordered by `created_at`, waitlist by `joined_at`.

Delivery: added to `supabase/admin-dashboard.sql` in this repo **and** as a
migration in the app repo (`~/Documents/tamrin/supabase/migrations`), per the
2026-09-26 decision to track admin SQL as migrations.

## 5. UI

### Navigation
- Each active-events row is clickable and keyboard-reachable (`tabindex="0"`,
  Enter/Space). It sets `location.hash = 'event/<id>'`.
- A `hashchange` router in `admin.js`: `#event/<id>` hides the dashboard content
  (stats, tabs, panels) and shows the event view; empty hash restores the
  dashboard with the Events tab selected. Works on refresh and pasted links
  (after sign-in).
- Back button «رجوع» calls `history.back()` when the previous entry is the
  dashboard, otherwise clears the hash.

### Layout (RTL, top to bottom)
1. **Header** — name, group, organiser, date/time, location, price per person,
   «مقفل» badge when registration is locked.
2. **Insight cards** (reuse `stat-grid` styling):
   - Seats: `filled / max` + fill bar; filled counts every participant row
     (guests included). No max → show filled only.
   - Payment: paid · waived · pending counts, and collected vs expected
     (`sum(paid_amount)` vs `price_per_person × (registered − waived)`).
     Expected excludes waived so a fully settled event reads 100%.
   - Group response: registered · declined · no reply, of `group_size`.
   - Waitlist: count.
3. **Member list** (main) — table: avatar, name, position, registered at, payment
   badge (مدفوع / معفى / لم يدفع); badges «ضيف» for guests and «أضافه <name>»
   for manually added. Filter chips: الكل · مدفوع · معفى · لم يدفع · ضيوف, with counts. Clicking a real member opens
   `TamrinPlayer.open(user_id)`; guest rows are not clickable.
4. **Declined** — name + reason (`reason_text`, else a label for `reason_code`).
5. **No reply** — group members who have not responded.
6. **Waitlist** — in join order.
7. **Pace** — "filled in <duration> after publishing" when `filled >= max`
   (time from `published_at` to the registration that reached max), else "last
   registration <relative time>". Hidden when there are no participants.

Empty sections render a short muted line, not an empty table.

### States
- Loading: skeletons in header, cards and table.
- Not found (`null`): «الفعالية غير موجودة» + back button.
- Error: «تعذّر جلب الفعالية» + retry.
- Stale response guard: a sequence counter, as in `admin-player.js`.

## 6. Code units

- `assets/admin-event-calc.js` — `TamrinEventCalc`, pure functions only:
  `summary(details)` (cards), `filterParticipants(list, filter)`,
  `paceText(details, now)`. No DOM. Tested.
- `assets/admin-event.js` — `TamrinEvent.init()`, `open(id)`, `close()`; renders
  the view, knows nothing about the router.
- `assets/admin-data.js` — `eventDetails(id)`; mock mode builds details for the
  mock events from `MOCK_USERS` (deterministic via `seeded`).
- `assets/admin.js` — row click + hash router + wiring to `TamrinPlayer`.
- `admin.html` — `#eventView` container; styles in `assets/admin-event.css`
  reusing existing tokens.

## 7. Testing

- `tests/admin-event.test.html` for `TamrinEventCalc`, same harness style as
  `tests/admin-ratings.test.html`: seat fill with/without max, guests counted,
  paid / waived / pending split with an unknown status falling to pending,
  collected sum and expected excluding waived, filter chips, pace
  when full / not full / no participants.
- Browser preview in mock mode, desktop and mobile widths: row click, back,
  refresh on `#event/<id>`, filters, opening a player from the list, not-found id.
- After the SQL is applied on prod: open one real event and compare counts with
  the list row (participants, paid, waitlist).

## 8. Out of scope

Editing participants, marking payments, messaging no-reply members, past or
cancelled events.
