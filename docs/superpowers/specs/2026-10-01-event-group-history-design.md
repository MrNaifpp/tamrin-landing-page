# Event page: the group's past events — design

Date: 2026-10-01
Repo: `tamrin-landing-page` (Netlify, branch `main`)
Surface: the admin dashboard event page (`/admin.html#event/<id>`)
Builds on: `docs/superpowers/specs/2026-09-26-event-details-page-design.md`

## 1. Goal

From an event's page, an admin can see every past event of the same group and,
for any of them, who registered and how they paid — without leaving the page.

## 2. Decisions (agreed 2026-10-01)

- **Scope:** past events of the same workspace as the open event.
- **Registrants:** expand inline under each past event; click a member to open
  the player profile sheet.
- **Data:** a light list RPC plus the existing `admin_event_details` on expand.
- **SQL delivery:** a migration in the app repo only (`~/Documents/tamrin`), no
  copy in this repo.

## 3. What counts as "past"

- `events.workspace_id = <the open event's workspace_id>`
- `published_at is not null`
- `coalesce(end_date, start_date) < now()`
- Cancelled events are **included** and flagged «ملغاة».
- No member-count filter (that filter is for the dashboard-wide active list).
- Order: `start_date desc`, then `id` for a stable page boundary.

## 4. Data

### New RPC

`admin_list_workspace_past_events(p_workspace_id uuid, p_page integer default 1,
p_page_size integer default 10) returns json` — same `admin_*` rules as the rest:
`security definer`, `stable`, `set search_path = public, pg_temp`, gated by
`is_current_user_admin()` (errcode `42501`), `revoke … from public, anon; grant …
to authenticated`. Page clamped to ≥ 1, page size to 1–50.

```jsonc
{
  "rows": [ { "id", "name", "location", "start_date", "end_date",
              "max_participants", "price_per_person", "cancelled_at",
              "participant_count", "paid_count", "waived_count" } ],
  "total": 23
}
```

`paid_count` counts `payment_status = 'confirmed'`, `waived_count` counts
`'waived'` (values verified on prod 2026-09-26).

Delivered as `supabase/migrations/20261001100000_admin_workspace_past_events.sql`
on branch `admin/event-details` in the app repo (which already holds
`20260926100000_admin_event_details.sql`). The human checks
`supabase migration list` against prod before `supabase db push`.

### Existing RPC reused

`admin_event_details(p_event_id)` — already live — supplies `event.workspace_id`
for the open event and the participants of a past event when its row expands.

### Data layer

`TamrinData.pastEvents({ workspaceId, page, pageSize }) -> { rows, total }`.
Mock mode: each mock event gets a `workspace_id`; each mock workspace gets
deterministic past events (some cancelled), and `eventDetails` resolves both
active and past mock ids.

## 5. UI

### Tabs
Under the event header, a two-tab switch reusing the `.seg` style:
**هذه الفعالية** (everything shown today) and **فعاليات المجموعة السابقة (N)**.
`N` comes from page 1 of the list, fetched in the background when the event
loads. The tab is not in the URL; a reload shows «هذه الفعالية».

### Past-events list
- One card per past event, newest first: date, name, «ملغاة» badge when
  cancelled, registered/max (or just registered when there is no max), paid /
  registered, and «معفى N» when `waived_count > 0`.
- The card header is a `<button aria-expanded aria-controls>`; Enter/Space work
  natively.
- 10 per page; «عرض المزيد» appends the next page while `page × pageSize < total`.
  Rows are merged by `id` so a shifted page never shows a duplicate.

### Expanded card
- First expand calls `eventDetails(id)`; the result is cached for the session of
  that event page, so collapsing and re-expanding does not refetch.
- Shows the registrant table with the same row markup as the member list (name,
  position, registered at, payment badge, guest / added-by badges). Real members
  are `tr.row-link` and open `TamrinPlayer.open(user_id)` through the event
  view's existing delegation.

### States
- List: loading skeleton, empty «لا فعاليات سابقة لهذه المجموعة», error with
  retry.
- Expanded card: loading line, «لم يسجّل أحد» when empty, error with retry.
- Opening another event (or leaving) discards in-flight list and expand
  responses (sequence counter, as elsewhere).

## 6. Code units

- `assets/admin-event-parts.js` — `TamrinEventParts`: shared row markup moved
  out of `admin-event.js` (`esc`, `num`, `asWhen`, `who`, `payTag`, `badges`,
  `memberRow`) so both views render members identically.
- `assets/admin-event-history.js` — `TamrinEventHistory`: `mount(container,
  { workspaceId, onCount })`, `reset()`. Owns list paging and expand state.
- `assets/admin-event.js` — renders the tabs and the two panes; mounts the
  history pane; resets it on load/close.
- `assets/admin-event-calc.js` — adds pure `hasMore(page, pageSize, total)` and
  `mergeById(existing, incoming)`.
- `assets/admin-data.js` — `pastEvents(...)` + mock data.
- `assets/admin-event.css` — tab spacing and history card styles.

## 7. Testing

- `tests/admin-event.test.html`: `hasMore` (exact boundary, zero total, bad
  input) and `mergeById` (append, drop duplicates, keep order, empty inputs).
- Browser, mock mode, desktop and mobile: switch tabs, count in the label,
  expand / collapse / re-expand without refetch, «عرض المزيد», open a player from
  an expanded card, cancelled badge, empty group, back button still works.
- After `db push`: on prod, open an event whose group has history and compare an
  expanded past event with its own counts in the row.

## 8. Out of scope

Past events across groups, filtering or searching past events, attendance
statistics ("regulars"), putting the tab in the URL.
