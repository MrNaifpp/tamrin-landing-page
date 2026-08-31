# Global player search + player profile sheet — design

Date: 2026-08-31
Repo: `tamrin-landing-page` (Netlify, branch `main`)
Surface: the admin dashboard (`/admin`) — one responsive build

## 1. Goal

Let an admin find any user in the system from anywhere in the dashboard, open that
player's full profile, and understand at a glance how the player is rated and
exactly who rated them with what score. An admin can also delete an individual
rating.

## 2. Current state

The dashboard is a static Arabic-RTL page with a strict three-layer split:

- `admin.html` — markup
- `assets/admin.js` — UI logic; knows nothing about where data comes from
- `assets/admin-data.js` — the sole server touchpoint (`TamrinData`), with a
  `USE_MOCK` path that must keep working
- `supabase/admin-dashboard.sql` — `admin_*` security-definer RPCs, all `stable`
  reads, each gated by `is_current_user_admin()`

Two facts that shape this work:

1. **Search reach already exists.** `admin_list_users(p_search, p_page, p_page_size)`
   does a server-side `ILIKE` over `users.name` and `users.stc_pay_number` across
   all users. "Global" in this spec means *reachable from anywhere in the UI*, not
   new search reach.
2. **The dashboard has never written to the database.** Every existing `admin_*`
   function is `stable`. The delete action introduces the first write.

## 3. Verified backend reality (prod `timrin-prod`, ref `hzsxwnmbdkrmipjtfzlp`)

Ratings shipped after this project's earlier notes were written. Verified via
`supabase gen types typescript --project-id hzsxwnmbdkrmipjtfzlp` on 2026-08-31:

```
player_ratings(
  rater_id, ratee_id, workspace_id,
  pace, shooting, passing, defending, stamina, awareness,
  created_at, updated_at
)
```

- **No `id` column.** A rating's identity is the composite
  `(rater_id, ratee_id, workspace_id)`.
- **No comment/notes field.** Six numeric attributes, nothing else.
- Only FK is `workspace_id → workspaces.id`. `rater_id` and `ratee_id` have **no
  FK to `users`**, so every join to `users` must be a `LEFT JOIN` with a fallback
  label — same deliberate pattern as `creator_name` in `admin_list_active_events`.
- **Ratings are scoped per workspace.** A player in three groups has three
  independent overalls from three independent sets of raters. There is no global
  overall in this data model.

Related functions:

- `player_rating_overall(p_position, p_pace, p_shooting, p_passing, p_defending,
  p_stamina, p_awareness) → number` — the overall is **computed, not stored**, and
  is **position-weighted** using the ratee's `users.postion`. Not granted to
  `anon`.
- `get_player_rating(p_user_id, p_workspace_id)` — the app's own reader. **Cannot
  be reused here:** it is workspace-member scoped, and an admin is not a member.
- `submit_player_rating(...)` — app-side writer, out of scope.

`users.postion` (sic — typo is in the schema) is a free-text string, one global
position per user, not an enum. Consequence: **position is not snapshotted on the
rating row**, so if a player changes position every historical overall recomputes.

## 4. Decisions

| Question | Decision |
|---|---|
| Surface | This repo's admin dashboard only. One responsive build: side sheet on desktop, bottom sheet on mobile. No iOS work. |
| Rating scope | Per-group sections. One overall per workspace, each with its own rater list. No invented cross-group number. |
| "My rating" | Rows where `rater_id = auth.uid()`, with an explicit empty state when the admin hasn't rated the player. |
| Delete | Single rating, hard delete, behind an inline confirm. Plus an audit-log snapshot (§6.3). |

## 5. Files

| File | Status | Owns | Depends on |
|---|---|---|---|
| `assets/admin-search.js` | new | Palette: trigger, overlay, debounce, keyboard nav, result rows | `TamrinData.users()` + one selection callback. Knows nothing about ratings. |
| `assets/admin-player.js` | new | Profile sheet: fetch, render, ratings sections, delete flow | `TamrinData.playerProfile()` / `.deleteRating()`. Knows nothing about search. |
| `assets/admin-sheet.css` | new | Palette + sheet styles, responsive switch | Tokens from `site.css`; redefines none |
| `assets/admin-data.js` | extend | 2 new `TamrinData` methods + mock rating fixtures | — |
| `admin.html` | extend | Palette trigger in `.admin-top`; script/style tags | — |
| `supabase/admin-player-ratings.sql` | new | New `admin_*` RPCs + audit table, additive | `supabase/admin-dashboard.sql` left untouched |

Each new module is an IIFE exposing one global — `TamrinSearch.open()` and
`TamrinPlayer.open(userId)` — matching the existing convention. Neither module
imports the other; `admin-search.js` reaches the profile only through the
callback it is given, so either can be changed or tested without the other.

**Wiring lives in `admin.js`**, the app shell: it binds the palette trigger and
the keyboard shortcut, and passes `TamrinSearch` a callback that calls
`TamrinPlayer.open(userId)`. Neither new module self-wires to the DOM outside its
own element, so there is exactly one place that knows both exist.

**Avatars render as initials**, via the existing `initials()` helper and `.avatar`
class. `avatar_url` is carried in the payload for later use but is not rendered:
the current dashboard shows initials everywhere, and rendering remote images would
add broken-image and CORS handling for no gain here.

**Cache busting is mandatory.** `netlify.toml` serves `/assets/*` with
`max-age=31536000, immutable`. Bump `admin.css`, `admin-data.js`, `admin.js` to
`?v=5` in `admin.html`; new files enter at `?v=1`.

## 6. Server contract

New file `supabase/admin-player-ratings.sql`, in the style of the existing SQL:
`begin; … commit;`, Arabic comments explaining *why*, explicit
`revoke … from public, anon` then `grant … to authenticated`, and an
`is_current_user_admin()` gate raising `42501` at the top of every function.

### 6.1 `admin_get_player_profile(p_user_id uuid) → json`

`security definer`, `stable`, admin-gated. One round trip so the sheet never
renders half-populated.

```json
{
  "user":  { "user_id", "name", "postion", "avatar_url", "stc_pay_number", "created_at" },
  "scale": { "min", "max" },
  "my_ratings": [
    { "workspace_id", "workspace_name", "pace", "shooting", "passing",
      "defending", "stamina", "awareness", "overall", "created_at", "updated_at" }
  ],
  "groups": [
    {
      "workspace_id", "name", "overall", "rater_count",
      "averages": { "pace", "shooting", "passing", "defending", "stamina", "awareness" },
      "raters": [
        { "rater_id", "name", "avatar_url", "is_me", "overall",
          "pace", "shooting", "passing", "defending", "stamina", "awareness",
          "created_at", "updated_at" }
      ]
    }
  ],
  "activity": { "workspace_count", "events_joined", "events_created" }
}
```

Rules:

- **Every `overall` is produced by calling `player_rating_overall`**, never
  reimplemented in SQL or JS. The dashboard therefore cannot drift from the app
  if the weighting changes.
- `my_ratings` is an **array**, not a single object: the admin may have rated the
  same player in more than one workspace. Empty array when they haven't rated at
  all.
- `groups` includes **only workspaces where `rater_count > 0`**. Membership with
  no ratings is reflected in `activity.workspace_count` instead, so the sheet
  never shows a stack of empty sections.
- Raters whose `users` row is missing or soft-deleted **still count toward the
  averages** (the rating row exists, and the app counts it — excluding them would
  make the dashboard disagree with the app). They display as «مستخدم محذوف».
- `scale` ships in the payload so the UI never hardcodes a maximum (§8).

### 6.2 `admin_delete_player_rating(p_rater_id uuid, p_ratee_id uuid, p_workspace_id uuid) → json`

`security definer`, **`volatile`**, admin-gated. Deletes exactly one row matched
on the full composite. Returns `{ "deleted": 1 }`. Raises if no row matched, so a
stale sheet cannot silently report success.

### 6.3 `admin_audit_log`

Because the accepted delete has no undo, the delete snapshots what it destroyed:

```sql
create table if not exists public.admin_audit_log (
  id             bigserial primary key,
  actor_id       uuid not null,
  action         text not null,
  target_user_id uuid,
  payload        jsonb,
  created_at     timestamptz not null default now()
);
```

RLS enabled with **no policies**, and `revoke all … from anon, authenticated` —
the same invisibility pattern `admin_users` uses. The security-definer function
bypasses RLS to insert. `payload` holds the six deleted values plus the rater and
workspace ids, so a mistaken delete is reconstructable by hand.

### 6.4 Data-layer contract (`admin-data.js`)

```
playerProfile(userId)                            -> profile object (§6.1)
deleteRating({ raterId, rateeId, workspaceId })  -> { deleted }
```

Both route through the existing `rpc()` helper, inheriting its 401-refresh-retry
and its 401/403 → «غير مصرّح» mapping. Both need `USE_MOCK` implementations, and
`MOCK_USERS` needs seeded rating fixtures — otherwise the feature breaks the
demo-data path that the `demoBanner` advertises.

## 7. UX

### 7.1 Global search palette

- **Trigger** in `.admin-top` beside the brand, visible on every tab.
- **Keyboard**: `⌘K` / `Ctrl+K` / `/` opens; `Esc` closes; `↑`/`↓` move; `Enter`
  selects. `/` must not fire while focus is in a text input.
- **Query**: `TamrinData.users({ search, page: 1, pageSize: 8 })`, debounced
  220ms to match the existing `#userSearch` behaviour. No new server work.
- **Result row**: avatar initial, name, position tag, group count — all fields
  `admin_list_users` already returns.
- **Layout**: centered dialog on desktop; full-width sheet anchored to the top on
  mobile.
- **States**: idle («اكتب للبحث في كل المستخدمين»), no results
  («لا نتائج» + «لا يوجد مستخدم يطابق «{q}».»), error («تعذّر البحث» + «تحقّق من
  الاتصال وحاول مجددًا.») — matching existing copy voice.
- Selecting a row closes the palette and calls the callback with `user_id`.

### 7.2 Profile sheet

One component, responsive at the existing **720px** breakpoint (`admin.css`):

- **≥ 720px** — side sheet, full height, pinned with `inset-inline-end: 0` (the
  left edge on this `dir="rtl"` page) — the mirror of the conventional LTR
  right-hand detail panel.
- **< 720px** — bottom sheet, rounded top corners, `max-height: 90vh`,
  scrollable body.

Shared: backdrop, `role="dialog"` + `aria-modal="true"`, labelled by the player's
name, focus trap, `Esc` to close, focus returned to the trigger on close, body
scroll lock while open. Loading state is a skeleton, reusing the existing `.skel`
class.

**RTL care point:** the page is `dir="rtl"` and the codebase uses logical
properties throughout (`inset-inline-*`, `padding-inline`, `border-block-end`).
Positioning must stay logical, but **CSS `transform: translateX()` is not
logical** — its axis does not flip in RTL. The slide-in transform needs an
explicit RTL case; do not assume the mirror is automatic.

**Content order — ratings-forward:**

1. **Header** — avatar, name, position tag, joined date, STC Pay number rendered
   `dir="ltr"` like the existing table cell.
2. **تقييمي (my rating)** — one card per entry in `my_ratings` (group name +
   overall + six attributes). When `my_ratings` is empty: «لم تُقيّم هذا اللاعب.»
3. **التقييمات بحسب المجموعة** — one section per group: group name, that group's
   overall as the headline number, the six attribute averages as bars, rater
   count («{n} مقيّم»), then every rater as a row with name, their overall, their
   exact six values, when they rated, an «أنت» badge where `is_me`, and a delete
   button.
4. **النشاط** — groups / events joined / events created. Deliberately secondary.
5. **No ratings in any group** — a single empty state («لا تقييمات بعد» + «لم
   يقيّم أحد هذا اللاعب حتى الآن.»), not a stack of empty sections.

Attribute labels: السرعة (pace), التسديد (shooting), التمرير (passing), الدفاع
(defending), التحمّل (stamina), الوعي (awareness). Numbers use the existing
`ar-SA-u-nu-latn` formatters. All user-supplied strings pass through the existing
`esc()` before insertion.

**Attribute bars are sized as `value / scale.max`**, reading `scale` from the
payload (§6.1). No maximum is hardcoded in JS or CSS. If `scale` is absent or
zero, fall back to rendering the numbers without bars rather than guessing a
denominator.

### 7.3 Delete flow

1. Delete button on the rater's row.
2. **Inline two-step confirm in that same row** — «تأكيد الحذف؟» with «حذف» /
   «إلغاء». Chosen over a typed confirmation so the rater's name and their exact
   scores stay on screen at the moment of confirming: it shows *what* is being
   destroyed rather than asking the admin to prove intent. Not `window.confirm`.
3. On confirm, call `deleteRating`, then **refetch the profile** rather than
   patching the DOM — the group overall and averages change, and a client-side
   patch would show a stale number.
4. Success: «حُذف التقييم.» Failure: restore the row and show «تعذّر حذف
   التقييم.»

The delete changes the player's overall in the live app immediately.

## 8. Assumptions to verify before calling this done

1. **Group overall formula.** This spec computes it as
   `player_rating_overall(position, avg(pace), avg(shooting), …)`. If the app
   instead averages each rater's individual overall, the two disagree wherever
   the function rounds or clamps. Verify by computing both for one real player
   and diffing against `get_player_rating` for that player+workspace.
2. **`scale.max`.** The check constraint on `player_ratings` could not be read
   from this environment: there are no DB credentials here, and
   `player_rating_overall` is not granted to `anon` (probing it returns `42501`).
   The SQL file must carry the query to confirm the constraint, and the UI reads
   `scale` from the payload — so a wrong guess cannot reach the rendered bars.

## 9. Verification

There is **no test harness in this repo** — no `package.json`, no build step. So:

1. **Mock pass** — serve via the `tamrin-site` preview config (`python3 -m
   http.server 4173`) with mock rating fixtures. Covers: palette open/close,
   keyboard nav, all three palette states, sheet on both sides of the 720px
   breakpoint, RTL slide direction, focus trap and focus restore, every sheet
   state (loading, no-ratings, my-rating present and absent), and the delete
   confirm/success/failure paths.
2. **Real pass** — against `timrin-prod` with an admin account: profile of a
   player rated in multiple groups, a player with no ratings, and the two
   assumptions in §8.
3. **SQL** — a verification query block in the file's trailing comments, as
   `supabase/admin-dashboard.sql` already does.

## 10. Out of scope

- Editing or creating ratings from the dashboard (`submit_player_rating` stays
  app-only).
- Bulk delete of all ratings for a player.
- Soft-delete / restore of ratings.
- Rating history or trend over time.
- Any iOS app change.
- Drag-to-dismiss on the bottom sheet.

## 11. Privacy note

Showing each rater's name next to their exact score is the explicit goal here and
is the owner's call. Recorded for the record: if the app presents ratings to
players as anonymous, this dashboard makes that untrue for whoever holds admin
access.
