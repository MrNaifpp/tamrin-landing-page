# Event Page Group History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a «فعاليات المجموعة السابقة» tab to the admin event page that lists the group's past events and expands each one inline to show who registered.

**Architecture:** A new paged RPC `admin_list_workspace_past_events` returns light rows; expanding a row reuses the live `admin_event_details`. `TamrinEventHistory` owns the tab's list/expand state, and the member-row markup moves to a shared `TamrinEventParts` so both tabs render members identically.

**Tech Stack:** Static HTML/CSS/vanilla JS (no build), Supabase Postgres (plpgsql via PostgREST RPC), Supabase CLI migrations in the app repo, Python `http.server` preview on port 4173.

Spec: `docs/superpowers/specs/2026-10-01-event-group-history-design.md`

## Global Constraints

- Arabic RTL UI; Latin digits via `Intl.NumberFormat('ar-SA-u-nu-latn')`; dates via `'ar-SA-u-ca-gregory-nu-latn'`.
- Every user-supplied string goes through `esc()` before HTML.
- Only `assets/admin-data.js` talks to the server; `USE_MOCK` must keep working and must never be committed as `true` (the committed line is exactly `  const USE_MOCK = !SUPABASE_ANON_KEY;     // يتحوّل تلقائيًا عند وضع المفتاح`).
- "Past" = same `workspace_id`, `published_at is not null`, `coalesce(end_date, start_date) < now()`; cancelled included.
- Payment: `confirmed` = paid, `waived` = waived, anything else = pending.
- `admin_*` RPC rules: `security definer`, `stable`, `set search_path = public, pg_temp`, `is_current_user_admin()` check raising `42501`, `revoke … from public, anon; grant … to authenticated`.
- App-repo migrations have **no** `begin;` / `commit;` (the CLI wraps each file in a transaction).
- SQL lives only in the app repo (`~/Documents/tamrin`, branch `admin/event-details`). No SQL copy in this repo. Never run `supabase db push` — the human does.
- Bump `?v=` on every changed asset tag in `admin.html`.
- Script load order: `admin-event-calc.js` → `admin-event-parts.js` → `admin-event-history.js` → `admin-event.js` → `admin.js`.

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `~/Documents/tamrin/supabase/migrations/20261001100000_admin_workspace_past_events.sql` | create | The list RPC. |
| `~/Documents/tamrin/supabase/migrations/20260926100000_admin_event_details.sql` | modify | Drop `begin;`/`commit;`. |
| `assets/admin-event-calc.js` | modify | Add `hasMore`, `mergeById`. |
| `tests/admin-event.test.html` | modify | Tests for the two helpers. |
| `assets/admin-data.js` | modify | `pastEvents()`, mock `workspace_id`, mock past events. |
| `assets/admin-event-parts.js` | create | `TamrinEventParts` — shared member markup. |
| `assets/admin-event-history.js` | create | `TamrinEventHistory` — the tab's list and expand logic. |
| `assets/admin-event.js` | modify | Use parts; render tabs + panes; mount/reset history. |
| `assets/admin-event.css` | modify | Tab and history card styles. |
| `admin.html` | modify | Script tags and versions. |

---

### Task 1: The list RPC as a migration

**Files:**
- Create: `~/Documents/tamrin/supabase/migrations/20261001100000_admin_workspace_past_events.sql`
- Modify: `~/Documents/tamrin/supabase/migrations/20260926100000_admin_event_details.sql`

**Interfaces:**
- Consumes: `public.is_current_user_admin()`.
- Produces: `public.admin_list_workspace_past_events(p_workspace_id uuid, p_page integer default 1, p_page_size integer default 10) returns json` →
  `{ "rows": [ { id, name, location, start_date, end_date, max_participants, price_per_person, cancelled_at, participant_count, paid_count, waived_count } ], "total": int }`.

The app repo's working checkout is on the user's branch `duf-2-1.5`; do all work in a temporary worktree so that checkout is untouched.

- [ ] **Step 1: Open a worktree on `admin/event-details`**

```bash
cd ~/Documents/tamrin && git worktree add "$TMPDIR/tamrin-admin" admin/event-details
```

Expected: `Preparing worktree (checking out 'admin/event-details')`.

- [ ] **Step 2: Write the migration**

Create `$TMPDIR/tamrin-admin/supabase/migrations/20261001100000_admin_workspace_past_events.sql`:

```sql
-- Admin dashboard: a group's past events, for the event page's history tab.
--
-- Additive: one read-only admin_* function; no table, policy or app RPC changes.
-- "Past" = published and coalesce(end_date, start_date) < now(). Cancelled
-- events are included and carry cancelled_at so the dashboard can flag them.
-- payment_status values verified on prod 2026-09-26: confirmed · waived · pending.

create or replace function public.admin_list_workspace_past_events(
  p_workspace_id uuid,
  p_page         integer default 1,
  p_page_size    integer default 10
)
returns json
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_offset integer;
  v_total  integer;
  v_rows   json;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  p_page      := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 10), 1), 50);
  v_offset    := (p_page - 1) * p_page_size;

  select count(*) into v_total
  from public.events e
  where e.workspace_id = p_workspace_id
    and e.published_at is not null
    and coalesce(e.end_date, e.start_date) < now();

  select coalesce(json_agg(r order by r.start_date desc, r.id), '[]'::json) into v_rows
  from (
    select
      e.id,
      e.name,
      e.location,
      e.start_date,
      e.end_date,
      e.max_participants,
      e.price_per_person,
      e.cancelled_at,
      (select count(*) from public.event_participants p
        where p.event_id = e.id)                                    as participant_count,
      (select count(*) from public.event_participants p
        where p.event_id = e.id and p.payment_status = 'confirmed') as paid_count,
      (select count(*) from public.event_participants p
        where p.event_id = e.id and p.payment_status = 'waived')    as waived_count
    from public.events e
    where e.workspace_id = p_workspace_id
      and e.published_at is not null
      and coalesce(e.end_date, e.start_date) < now()
    order by e.start_date desc, e.id
    limit p_page_size offset v_offset
  ) r;

  return json_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke execute on function public.admin_list_workspace_past_events(uuid, integer, integer) from public, anon;
grant  execute on function public.admin_list_workspace_past_events(uuid, integer, integer) to authenticated;
```

- [ ] **Step 3: Drop `begin;`/`commit;` from the event-details migration**

```bash
cd "$TMPDIR/tamrin-admin" && sed -i '' -e '/^begin;$/d' -e '/^commit;$/d' supabase/migrations/20260926100000_admin_event_details.sql && grep -c -E '^(begin|commit);$' supabase/migrations/*.sql | grep -v ':0$'
```

Expected: no output (no migration contains a bare `begin;`/`commit;` line).

- [ ] **Step 4: Commit and remove the worktree**

```bash
cd "$TMPDIR/tamrin-admin" && git add supabase/migrations && git commit -m "Add admin_list_workspace_past_events; drop explicit transaction from admin_event_details" && cd ~/Documents/tamrin && git worktree remove "$TMPDIR/tamrin-admin" && git branch --show-current
```

Expected: a commit hash, then `duf-2-1.5`.

- [ ] **Step 5: Hand off to the human (do not run these yourself)**

From `~/Documents/tamrin` on branch `admin/event-details`:

```bash
supabase migration list --db-url "postgresql://postgres.hzsxwnmbdkrmipjtfzlp:<password>@<pooler-host>:5432/postgres"
```

- If `20260926100000` shows as not applied on remote: `supabase migration repair --status applied 20260926100000 --db-url "…"` (it was applied by hand).
- If the only pending migration is `20261001100000`: `supabase db push --db-url "…"`.
- If anything else is pending: stop and report the list.

Then verify: `select proname, prosecdef from pg_proc where proname = 'admin_list_workspace_past_events';` → one row, `true`. Tasks 2–5 run on mock data and do not wait.

---

### Task 2: `hasMore` and `mergeById` + tests

**Files:**
- Modify: `assets/admin-event-calc.js` (add two functions and export them)
- Test: `tests/admin-event.test.html` (add six tests before `window.__results = results;`)

**Interfaces:**
- Produces on `window.TamrinEventCalc`:
  - `hasMore(page, pageSize, total) -> boolean` — `page × pageSize < total`; `false` for any non-positive or non-numeric input.
  - `mergeById(existing, incoming) -> array` — concatenation keeping the first occurrence of each `id`, skipping `null`/`undefined` entries; never mutates inputs.

- [ ] **Step 1: Add the failing tests** — insert right before `    window.__results = results;`:

```js
    test('hasMore is true while pages remain', function () {
      eq(C.hasMore(1, 10, 23), true, 'page 1 of 3');
      eq(C.hasMore(2, 10, 23), true, 'page 2 of 3');
    });

    test('hasMore is false on the exact last page', function () {
      eq(C.hasMore(3, 10, 23), false, 'page 3 of 3');
      eq(C.hasMore(2, 10, 20), false, 'exact boundary');
      eq(C.hasMore(1, 10, 10), false, 'single full page');
    });

    test('hasMore is false for empty or unusable input', function () {
      eq(C.hasMore(1, 10, 0), false, 'zero total');
      eq(C.hasMore(0, 10, 5), false, 'page 0');
      eq(C.hasMore(1, 0, 5), false, 'size 0');
      eq(C.hasMore(1, 10, 'x'), false, 'non-numeric');
      eq(C.hasMore(null, 10, 5), false, 'null page');
    });

    test('mergeById appends in order', function () {
      eq(C.mergeById([{ id: 'a' }], [{ id: 'b' }, { id: 'c' }]).map(function (r) { return r.id; }),
         ['a', 'b', 'c']);
    });

    test('mergeById drops later duplicates and keeps the first', function () {
      const out = C.mergeById([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], [{ id: 'b', v: 2 }, { id: 'c', v: 2 }]);
      eq(out.map(function (r) { return r.id + r.v; }), ['a1', 'b1', 'c2']);
    });

    test('mergeById tolerates empty, null and holes without mutating', function () {
      const a = [{ id: 'a' }];
      eq(C.mergeById(null, undefined), [], 'both missing');
      eq(C.mergeById(a, [null, { id: 'b' }]).map(function (r) { return r.id; }), ['a', 'b'], 'null entry');
      eq(a.length, 1, 'input untouched');
    });
```

- [ ] **Step 2: Run to verify they fail**

```
mcp__Claude_Browser__preview_start  { "name": "tamrin-site" }
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/tests/admin-event.test.html?t2a" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "({ passed: __results.passed, failed: __results.failed, first: __results.failures[0] })" }
```

Expected: `passed: 16, failed: 6`, first failure mentions `C.hasMore is not a function`.

- [ ] **Step 3: Implement** — in `assets/admin-event-calc.js`, add before `  global.TamrinEventCalc = {`:

```js
  /* هل بقيت صفحات؟ أي مُدخل غير صالح يعني «لا» بدل زرّ لا يجلب شيئًا. */
  function hasMore(page, pageSize, total) {
    const p = Number(page), s = Number(pageSize), t = Number(total);
    if (!(p > 0) || !(s > 0) || !(t > 0)) return false;
    return p * s < t;
  }

  /* دمج صفحة جديدة بلا تكرار: إن انزاحت الصفحات بين طلبين (فعالية انتهت
     للتوّ) يبقى أول ظهور للصف فقط. */
  function mergeById(existing, incoming) {
    const seen = new Set();
    const out = [];
    (existing || []).concat(incoming || []).forEach((r) => {
      if (!r || seen.has(r.id)) return;
      seen.add(r.id);
      out.push(r);
    });
    return out;
  }
```

and extend the export object with:

```js
    pace: pace,
    hasMore: hasMore,
    mergeById: mergeById
```

(replacing the existing last line `    pace: pace`).

- [ ] **Step 4: Run to verify they pass**

```
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/tests/admin-event.test.html?t2b" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "window.__results" }
```

Expected: `{ "passed": 22, "failed": 0, "failures": [] }`.

- [ ] **Step 5: Commit**

```bash
git add assets/admin-event-calc.js tests/admin-event.test.html
git commit -m "Add paging helpers for the event history list"
```

---

### Task 3: `TamrinData.pastEvents` and mock past events

**Files:**
- Modify: `assets/admin-data.js` — contract comment, `MOCK_EVENTS`, new `MOCK_PAST_EVENTS`, `mockEventDetails`, new `pastEvents`, export.

**Interfaces:**
- Consumes: `rpc`, `USE_MOCK`, `wait`, `seeded`, `MOCK_WORKSPACES`, `MOCK_USERS`, `now`, `DAY`, `dayStart`.
- Produces: `TamrinData.pastEvents({ workspaceId, page = 1, pageSize = 10 }) -> Promise<{ rows, total }>`; mock events and `eventDetails(id).event.workspace_id` now carry `w-1`…`w-5`.

- [ ] **Step 1: Contract line** — after the `eventDetails(eventId)` line in the header comment add:

```
     pastEvents({ workspaceId, page, pageSize }) -> { rows, total }
```

- [ ] **Step 2: Give mock events a `workspace_id`**

In `MOCK_EVENTS`, replace

```js
      workspace_name: WORKSPACES[Math.floor(seeded(i + 11) * WORKSPACES.length)],
```

with

```js
      workspace_id: MOCK_WORKSPACES[Math.floor(seeded(i + 11) * WORKSPACES.length)].id,
      workspace_name: WORKSPACES[Math.floor(seeded(i + 11) * WORKSPACES.length)],
```

- [ ] **Step 3: Add `MOCK_PAST_EVENTS` and a shared status helper** — insert right after the `MOCK_EVENTS` declaration (after its `.sort(...)` line), before `function mockEventDetails`:

```js
  /* فعاليات سابقة تجريبية لأول أربع مجموعات؛ الخامسة بلا تاريخ حتى تظهر
     حالة الفراغ. بعضها ملغى. */
  const MOCK_PAST_EVENTS = Array.from({ length: 44 }, (_, k) => {
    const ws = MOCK_WORKSPACES[k % 4];
    const capacity = [10, 12, 14, 16][Math.floor(seeded(k + 201) * 4)];
    const cancelled = seeded(k + 203) > 0.86;
    const joined = cancelled ? Math.floor(seeded(k + 205) * 4) : Math.max(4, Math.floor(seeded(k + 207) * (capacity + 1)));
    const price = [25, 30, 35, 40][Math.floor(seeded(k + 209) * 4)];
    const hour = [18, 19, 20, 21][Math.floor(seeded(k + 211) * 4)];
    const start = dayStart - (1 + Math.floor(k / 4) * 6 + Math.floor(seeded(k + 213) * 5)) * DAY + hour * 3600000;
    return {
      id: `p-${String(k + 1).padStart(3, '0')}`,
      name: ['تمرين الأسبوع', 'مباراة ودية', 'تمرين اللياقة', 'مباراة الحي'][Math.floor(seeded(k + 215) * 4)],
      workspace_id: ws.id,
      workspace_name: ws.name,
      creator_name: `${FIRST[Math.floor(seeded(k + 217) * FIRST.length)]} ${LAST[Math.floor(seeded(k + 219) * LAST.length)]}`,
      location: LOCATIONS[Math.floor(seeded(k + 221) * LOCATIONS.length)],
      start_date: new Date(start).toISOString(),
      end_date: new Date(start + 7200000).toISOString(),
      price_per_person: price,
      total_price: price * joined,
      max_participants: capacity,
      participant_count: joined,
      waitlist_count: 0,
      paid_count: Math.floor(joined * (0.5 + seeded(k + 223) * 0.5)),
      registration_locked: true,
      published_at: new Date(start - 3 * DAY).toISOString(),
      cancelled_at: cancelled ? new Date(start - DAY).toISOString() : null
    };
  });

  // بذرة الفعالية: النشطة e-001 → 1، والسابقة p-001 → 501 حتى لا تتكرّر البيانات
  const mockSeed = (id) => Number(id.slice(2)) + (id[0] === 'p' ? 500 : 0);

  // حالة الدفع للمقعد k — مشتركة بين التفاصيل وصفّ القائمة حتى تتطابق الأعداد
  function mockPayStatus(ev, k) {
    if (k < ev.paid_count) return 'confirmed';
    return seeded(mockSeed(ev.id) * 17 + k) > 0.6 ? 'waived' : 'pending';
  }
```

- [ ] **Step 4: Point `mockEventDetails` at both lists and the shared helpers**

In `mockEventDetails`:

- replace `    const ev = MOCK_EVENTS.find((e) => e.id === id);` with
  `    const ev = MOCK_EVENTS.concat(MOCK_PAST_EVENTS).find((e) => e.id === id);`
- replace `    const i = Number(id.slice(2));` with `    const i = mockSeed(id);`
- replace the whole `const status = (k) => …;` statement (two lines, starting `    const status = (k) => (k < ev.paid_count ? 'confirmed'`) with
  `    const status = (k) => mockPayStatus(ev, k);`
- replace these three lines

```js
    const span = Math.max(now - published, 6 * 3600000);
    const step = span / (ev.participant_count + ev.waitlist_count + 4);
    const base = now - span;
```

with

```js
    // نهاية النافذة: الآن للفعالية القادمة، وموعدها للسابقة
    const until = Math.min(now, Date.parse(ev.start_date));
    const span = Math.max(until - published, 6 * 3600000);
    const step = span / (ev.participant_count + ev.waitlist_count + 4);
    const base = until - span;
```

- in the returned `event` object replace `workspace_id: null,` with `workspace_id: ev.workspace_id,` and `published_at: ev.published_at, cancelled_at: null` with `published_at: ev.published_at, cancelled_at: ev.cancelled_at || null`.

- [ ] **Step 5: Add `pastEvents` right after `eventDetails()`**

```js
  async function pastEvents({ workspaceId, page = 1, pageSize = 10 } = {}) {
    if (USE_MOCK) {
      await wait(280);
      const all = MOCK_PAST_EVENTS
        .filter((e) => e.workspace_id === workspaceId)
        .sort((a, b) => b.start_date.localeCompare(a.start_date) || a.id.localeCompare(b.id));
      const rows = all.slice((page - 1) * pageSize, page * pageSize).map((e) => {
        let waived = 0;
        for (let k = 0; k < e.participant_count; k++) if (mockPayStatus(e, k) === 'waived') waived++;
        return {
          id: e.id, name: e.name, location: e.location,
          start_date: e.start_date, end_date: e.end_date,
          max_participants: e.max_participants, price_per_person: e.price_per_person,
          cancelled_at: e.cancelled_at,
          participant_count: e.participant_count, paid_count: e.paid_count, waived_count: waived
        };
      });
      return { rows, total: all.length };
    }
    return rpc('admin_list_workspace_past_events', {
      p_workspace_id: workspaceId, p_page: page, p_page_size: pageSize
    });
  }
```

- [ ] **Step 6: Export** — change `overview, users, activeEvents, eventDetails,` to `overview, users, activeEvents, eventDetails, pastEvents,`.

- [ ] **Step 7: Verify counts line up (mock on temporarily)**

Set `const USE_MOCK = true;` (keep the spacing and comment), then:

```
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/admin.html?t3" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "await TamrinData.signIn('a@b.c','x'); const out = {}; for (const w of ['w-1','w-2','w-3','w-4','w-5']) { const p1 = await TamrinData.pastEvents({ workspaceId: w, page: 1, pageSize: 10 }); let rows = p1.rows; for (let p = 2; (p - 1) * 10 < p1.total; p++) rows = rows.concat((await TamrinData.pastEvents({ workspaceId: w, page: p, pageSize: 10 })).rows); let bad = 0; for (const r of rows) { const d = await TamrinData.eventDetails(r.id); const st = d.participants.map(x => x.payment_status); if (st.length !== r.participant_count || st.filter(s => s === 'confirmed').length !== r.paid_count || st.filter(s => s === 'waived').length !== r.waived_count || d.event.workspace_id !== w) bad++; } out[w] = { total: p1.total, fetched: rows.length, bad, cancelled: rows.filter(r => r.cancelled_at).length }; } const a = (await TamrinData.activeEvents())[0]; out.activeHasWs = /^w-\\d$/.test((await TamrinData.eventDetails(a.id)).event.workspace_id); out" }
```

Expected: `w-1`…`w-4` each `total` 11 (so page 2 exists), `fetched === total`, `bad: 0`; at least one workspace has `cancelled ≥ 1`; `w-5` is `{ total: 0, fetched: 0, bad: 0, cancelled: 0 }`; `activeHasWs: true`.

- [ ] **Step 8: Restore `USE_MOCK` and commit**

Restore the exact committed line (see Global Constraints), then:

```bash
git diff assets/admin-data.js | grep -n 'USE_MOCK *='
```

Expected: no output.

```bash
git add assets/admin-data.js
git commit -m "Add pastEvents to the data layer with mock group history"
```

---

### Task 4: Shared member markup `TamrinEventParts`

**Files:**
- Create: `assets/admin-event-parts.js`
- Modify: `assets/admin-event.js` (remove the moved helpers, take them from parts)
- Modify: `admin.html` (script tag, version bumps)

**Interfaces:**
- Consumes: `TamrinEventCalc.payState`.
- Produces on `window.TamrinEventParts`: `esc(v)`, `num(n)`, `asWhen(iso)`, `initials(name)`, `who(name, subHtml)`, `payTag(participant)`, `badges(participant)`, `memberRow(participant)` → `<tr>` HTML, `MEMBER_HEAD` → `<tr>` header HTML with the four columns.

This task is a pure move: the event page must look and behave exactly as before.

- [ ] **Step 1: Create `assets/admin-event-parts.js`**

```js
/* =========================================================================
   تمرين — أجزاء صفحة الفعالية المشتركة
   ---------------------------------------------------------------------
   صفّ المسجّل نفسه يُرسم في تبويب «هذه الفعالية» وفي الفعاليات السابقة
   المفتوحة، فيعيش هنا مرة واحدة حتى لا يختلف العرضان.
   ========================================================================= */

(function (global) {
  'use strict';

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const nf = new Intl.NumberFormat('ar-SA-u-nu-latn');
  const num = (n) => nf.format(n ?? 0);
  const whenFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit'
  });
  const asWhen = (iso) => (iso ? whenFmt.format(new Date(iso)) : '—');
  const initials = (name) => String(name || '؟').trim().charAt(0);

  function who(name, sub) {
    return `
      <span class="who">
        <span class="avatar sm" aria-hidden="true">${esc(initials(name))}</span>
        <span><b>${esc(name)}</b>${sub ? `<span class="ev-sub">${sub}</span>` : ''}</span>
      </span>`;
  }

  function payTag(p) {
    const s = global.TamrinEventCalc.payState(p.payment_status);
    if (s === 'paid') return '<span class="tag tag-green">مدفوع</span>';
    if (s === 'waived') return '<span class="tag tag-lime">معفى</span>';
    const raw = p.payment_status && p.payment_status !== 'pending'
      ? ` <span class="ev-raw" dir="ltr">${esc(p.payment_status)}</span>` : '';
    return `<span class="tag tag-peach">لم يدفع</span>${raw}`;
  }

  function badges(p) {
    if (p.is_guest) return `<span class="tag tag-flat">ضيف${p.added_by_name ? ` · مع ${esc(p.added_by_name)}` : ''}</span>`;
    if (p.added_manually) return `<span class="tag tag-flat">أضافه ${esc(p.added_by_name || 'المنظّم')}</span>`;
    return '';
  }

  /* الأعضاء الحقيقيون صفوف قابلة للنقر؛ الضيوف بلا ملف فلا ينقرون. */
  function memberRow(p) {
    const link = p.user_id
      ? ` class="row-link" tabindex="0" data-user="${esc(p.user_id)}"` : '';
    return `
      <tr${link}>
        <td>${who(p.name, badges(p))}</td>
        <td>${esc(p.postion || '—')}</td>
        <td class="num">${asWhen(p.registered_at)}</td>
        <td>${payTag(p)}</td>
      </tr>`;
  }

  const MEMBER_HEAD = `<tr>
    <th scope="col">الاسم</th><th scope="col">المركز</th>
    <th scope="col">سجّل</th><th scope="col">الدفع</th>
  </tr>`;

  global.TamrinEventParts = { esc, num, asWhen, initials, who, payTag, badges, memberRow, MEMBER_HEAD };
})(window);
```

- [ ] **Step 2: Remove the duplicates from `assets/admin-event.js`**

Replace lines 13–24 (from `  const esc = (v) =>` through `  const initials = (name) => …;`) with:

```js
  const { esc, num, asWhen, who, memberRow, MEMBER_HEAD } = global.TamrinEventParts;
```

Delete the `function who(name, sub) { … }` block, the `function payTag(p) { … }` block, the `function badges(p) { … }` block and the `function memberRow(p) { … }` block.

In `membersHtml()`, replace

```js
            <thead><tr>
              <th scope="col">الاسم</th><th scope="col">المركز</th>
              <th scope="col">سجّل</th><th scope="col">الدفع</th>
            </tr></thead>
```

with

```js
            <thead>${MEMBER_HEAD}</thead>
```

- [ ] **Step 3: Load it** — in `admin.html` replace

```html
<script src="assets/admin-event-calc.js?v=1"></script>
<script src="assets/admin-event.js?v=2"></script>
```

with

```html
<script src="assets/admin-event-calc.js?v=2"></script>
<script src="assets/admin-event-parts.js?v=1"></script>
<script src="assets/admin-event.js?v=3"></script>
```

and bump `assets/admin-data.js?v=6` → `?v=7`.

- [ ] **Step 4: Verify nothing changed visibly (mock on temporarily)**

```bash
node --check assets/admin-event-parts.js && node --check assets/admin-event.js && grep -c "function memberRow\|function payTag\|function badges\|function who" assets/admin-event.js
```

Expected: `0`.

With `USE_MOCK = true`:

```
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/admin.html?t4#event/e-005" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "if (!TamrinData.restoreSession()) { await TamrinData.signIn('a@b.c','x'); location.reload(); } await new Promise(r => setTimeout(r, 900)); ({ rows: document.querySelectorAll('#evMembers tr.row-link').length, tags: document.querySelectorAll('#evMembers .tag').length, head: document.querySelectorAll('.ev-members thead th').length })" }
mcp__Claude_Browser__read_console_messages { "onlyErrors": true }
```

Expected: `rows` ≥ 1, `tags` ≥ `rows`, `head: 4`, no errors.

- [ ] **Step 5: Restore `USE_MOCK`, commit**

```bash
git diff assets/admin-data.js | grep -n 'USE_MOCK *='
```

Expected: no output.

```bash
git add assets/admin-event-parts.js assets/admin-event.js admin.html
git commit -m "Move the shared member-row markup into TamrinEventParts"
```

---

### Task 5: The history tab — `TamrinEventHistory`, tabs, styles

**Files:**
- Create: `assets/admin-event-history.js`
- Modify: `assets/admin-event.js` (tabs, panes, mount/reset, tab clicks)
- Modify: `assets/admin-event.css` (append styles)
- Modify: `admin.html` (script tag, version bumps)

**Interfaces:**
- Consumes: `TamrinData.pastEvents`, `TamrinData.eventDetails`, `TamrinEventCalc.hasMore/mergeById`, `TamrinEventParts`.
- Produces on `window.TamrinEventHistory`:
  - `mount(container: HTMLElement, { workspaceId: string|null, onCount: (n: number|null) => void })` — starts loading page 1 immediately.
  - `reset()` — discards state and any in-flight responses.
- Member rows inside expanded cards are `tr.row-link[data-user]`; the existing click/keydown delegation on `#eventView` (in `admin-event.js`) opens the player sheet for them, so this module does not handle player clicks.

- [ ] **Step 1: Create `assets/admin-event-history.js`**

```js
/* =========================================================================
   تمرين — تبويب «فعاليات المجموعة السابقة»
   ---------------------------------------------------------------------
   قائمة خفيفة مُقسّمة صفحات من admin_list_workspace_past_events، وكل
   فعالية تُفتح في مكانها بنداء admin_event_details نفسه. ما يُجلب مرة
   يبقى محفوظًا ما دامت صفحة الفعالية مفتوحة، فالطيّ والفتح لا يعيدان الطلب.
   النقر على عضو يتولّاه مستمع #eventView في admin-event.js.
   ========================================================================= */

(function (global) {
  'use strict';

  const P = () => global.TamrinEventParts;
  const C = () => global.TamrinEventCalc;
  const PAGE_SIZE = 10;

  let box = null;
  let opts = {};
  let seq = 0;
  let state = null;
  const cache = new Map();       // eventId -> { status: 'loading'|'ready'|'error', details }
  const expanded = new Set();

  const sel = (id) => `[data-card="${CSS.escape(id)}"]`;

  /* --------------------------------------------------------- رسم */

  function bodyHtml(id) {
    const c = cache.get(id);
    if (!c || c.status === 'loading') return '<p class="ev-none">جارٍ التحميل…</p>';
    if (c.status === 'error') {
      return '<p class="ev-none">تعذّر جلب المسجّلين. '
        + '<button type="button" class="btn-quiet" data-hist-retry>إعادة المحاولة</button></p>';
    }
    const parts = (c.details && c.details.participants) || [];
    if (!parts.length) return '<p class="ev-none">لم يسجّل أحد.</p>';
    return `<div class="table-scroll"><table class="data">
      <thead>${P().MEMBER_HEAD}</thead>
      <tbody>${parts.map(P().memberRow).join('')}</tbody>
    </table></div>`;
  }

  function cardHtml(r) {
    const { esc, num, asWhen } = P();
    const open = expanded.has(r.id);
    const bodyId = `evh-${esc(r.id)}`;
    const seats = r.max_participants
      ? `${num(r.participant_count)}/${num(r.max_participants)}` : num(r.participant_count);
    const cancelled = r.cancelled_at ? '<span class="tag tag-flat">ملغاة</span>' : '';
    const waived = r.waived_count ? ` · معفى ${num(r.waived_count)}` : '';
    return `
      <article class="ev-hist" data-card="${esc(r.id)}">
        <button type="button" class="ev-hist-head" data-hist="${esc(r.id)}"
                aria-expanded="${open}" aria-controls="${bodyId}">
          <span class="ev-hist-when">${asWhen(r.start_date)}</span>
          <span class="ev-hist-name"><b>${esc(r.name)}</b>${cancelled}</span>
          <span class="ev-hist-stats">المسجّلون ${seats} · دفع ${num(r.paid_count)}/${num(r.participant_count)}${waived}</span>
          <svg class="ev-hist-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <div class="ev-hist-body" id="${bodyId}"${open ? '' : ' hidden'}>${open ? bodyHtml(r.id) : ''}</div>
      </article>`;
  }

  function render() {
    if (!box || !state) return;
    if (state.status === 'loading') {
      box.innerHTML = '<section class="panel loading ev-hist-wait"><span class="skel" style="width:60%"></span></section>';
      return;
    }
    if (state.status === 'error') {
      box.innerHTML = `<section class="panel"><div class="empty"><b>تعذّر جلب الفعاليات السابقة</b>تحقّق من الاتصال وحاول مجددًا.
        <p><button type="button" class="btn-quiet" data-hist-reload>إعادة المحاولة</button></p></div></section>`;
      return;
    }
    if (!state.rows.length) {
      box.innerHTML = '<section class="panel"><div class="empty"><b>لا فعاليات سابقة لهذه المجموعة</b>تظهر هنا الفعاليات بعد انتهاء موعدها.</div></section>';
      return;
    }
    const more = C().hasMore(state.page, PAGE_SIZE, state.total);
    const label = state.moreLoading ? 'جارٍ التحميل…' : state.moreError ? 'إعادة المحاولة' : 'عرض المزيد';
    box.innerHTML = `
      <div class="ev-hist-list">${state.rows.map(cardHtml).join('')}</div>
      ${more ? `<div class="ev-hist-more">
        ${state.moreError ? '<span class="ev-none">تعذّر جلب المزيد.</span>' : ''}
        <button type="button" class="btn-quiet" data-hist-more${state.moreLoading ? ' disabled' : ''}>${label}</button>
      </div>` : ''}`;
  }

  function renderCard(id, focus) {
    const el = box && box.querySelector(sel(id));
    const row = state && state.rows.find((r) => r.id === id);
    if (!el || !row) return;
    // استبدال البطاقة يُسقط التركيز؛ نُعيده إن كان داخلها (مثلًا عند وصول المسجّلين)
    const hadFocus = el.contains(document.activeElement);
    el.outerHTML = cardHtml(row);
    if (focus || hadFocus) box.querySelector(`${sel(id)} .ev-hist-head`).focus();
  }

  /* --------------------------------------------------------- جلب */

  async function loadPage(n) {
    const my = seq;
    if (n === 1) {
      state.status = 'loading';
    } else {
      if (state.moreLoading) return;
      state.moreLoading = true;
      state.moreError = false;
    }
    render();
    try {
      const res = await TamrinData.pastEvents({ workspaceId: state.workspaceId, page: n, pageSize: PAGE_SIZE });
      if (my !== seq) return;
      state.rows = C().mergeById(n === 1 ? [] : state.rows, res.rows);
      state.total = res.total;
      state.page = n;
      state.status = 'ready';
    } catch (e) {
      if (my !== seq) return;
      if (n === 1) state.status = 'error';
      else state.moreError = true;
    }
    state.moreLoading = false;
    render();
    if (n === 1 && opts.onCount) opts.onCount(state.status === 'ready' ? state.total : null);
  }

  async function fetchDetails(id) {
    const my = seq;
    cache.set(id, { status: 'loading' });
    renderCard(id, false);
    try {
      const d = await TamrinData.eventDetails(id);
      if (my !== seq) return;
      cache.set(id, { status: 'ready', details: d });
    } catch (e) {
      if (my !== seq) return;
      cache.set(id, { status: 'error' });
    }
    renderCard(id, false);
  }

  function toggle(id) {
    if (expanded.has(id)) {
      expanded.delete(id);
      renderCard(id, true);
      return;
    }
    expanded.add(id);
    const c = cache.get(id);
    if (!c || c.status === 'error') fetchDetails(id);
    renderCard(id, true);
  }

  function onClick(e) {
    const head = e.target.closest('[data-hist]');
    if (head) { toggle(head.dataset.hist); return; }
    if (e.target.closest('[data-hist-more]')) { loadPage(state.page + 1); return; }
    if (e.target.closest('[data-hist-reload]')) { loadPage(1); return; }
    const retry = e.target.closest('[data-hist-retry]');
    if (retry) fetchDetails(retry.closest('[data-card]').dataset.card);
  }

  /* --------------------------------------------------------- واجهة */

  function reset() {
    seq++;
    if (box) box.removeEventListener('click', onClick);
    box = null;
    state = null;
    cache.clear();
    expanded.clear();
  }

  function mount(container, o) {
    reset();
    box = container;
    opts = o || {};
    state = { workspaceId: opts.workspaceId, rows: [], page: 0, total: 0,
              status: 'loading', moreLoading: false, moreError: false };
    box.addEventListener('click', onClick);
    if (!opts.workspaceId) {
      state.status = 'ready';
      render();
      if (opts.onCount) opts.onCount(0);
      return;
    }
    loadPage(1);
  }

  global.TamrinEventHistory = { mount, reset };
})(window);
```

- [ ] **Step 2: Tabs and panes in `assets/admin-event.js`**

Add after `function paceHtml(d) { … }`:

```js
  function tabsHtml() {
    return `
      <div class="seg ev-tabs" role="tablist" aria-label="أقسام الفعالية">
        <button type="button" role="tab" id="evTabThis" data-tab="this"
                aria-selected="true" aria-controls="evPaneThis">هذه الفعالية</button>
        <button type="button" role="tab" id="evTabPast" data-tab="past"
                aria-selected="false" aria-controls="evPanePast">فعاليات المجموعة السابقة <span id="evPastCount"></span></button>
      </div>`;
  }

  function selectPane(which) {
    const past = which === 'past';
    $('evTabThis').setAttribute('aria-selected', String(!past));
    $('evTabPast').setAttribute('aria-selected', String(past));
    $('evPaneThis').hidden = past;
    $('evPanePast').hidden = !past;
  }
```

Replace `render()` with:

```js
  function render() {
    $('eventView').innerHTML = headHtml(details.event) + tabsHtml()
      + `<div id="evPaneThis" role="tabpanel" aria-labelledby="evTabThis">`
      + cardsHtml(C().summary(details)) + paceHtml(details) + membersHtml() + listsHtml(details)
      + `</div><div id="evPanePast" role="tabpanel" aria-labelledby="evTabPast" hidden></div>`;

    TamrinEventHistory.mount($('evPanePast'), {
      workspaceId: details.event.workspace_id,
      onCount: (n) => {
        const el = $('evPastCount');
        if (el) el.textContent = n === null ? '' : `(${num(n)})`;
      }
    });
  }
```

In `load(id)`, add `TamrinEventHistory.reset();` as the first line after `const my = ++seq;`.

In `close()`, add `TamrinEventHistory.reset();` right after `seq++;`.

In `init`'s click handler, right after the `retry` line add:

```js
      const tab = e.target.closest('[data-tab]');
      if (tab && details) { selectPane(tab.dataset.tab); return; }
```

- [ ] **Step 3: Append styles to `assets/admin-event.css`**

Insert before the existing `@media (max-width: 960px) {` block:

```css
/* -------------------------------------------- التبويبان والتاريخ */

.ev-tabs { display: flex; width: fit-content; max-width: 100%; }
.ev-tabs button span { color: var(--text-3); font-weight: 500; }

.ev-hist-list { display: grid; gap: 12px; }
.ev-hist {
  background: var(--card); border: 1px solid var(--line);
  border-radius: var(--r-card); box-shadow: var(--shadow-card); overflow: hidden;
}
.ev-hist-head {
  width: 100%; display: grid; grid-template-columns: 170px 1fr auto 18px;
  align-items: center; gap: 14px; padding: 16px 20px;
  text-align: start; font: inherit; color: inherit; background: none; border: 0; cursor: pointer;
}
.ev-hist-head:hover { background: color-mix(in srgb, var(--lime) 9%, transparent); }
.ev-hist-head:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
.ev-hist-when { font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.ev-hist-name { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ev-hist-stats { font-size: 14px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.ev-hist-chev { width: 18px; height: 18px; color: var(--text-3); transition: transform .2s var(--ease); }
.ev-hist-head[aria-expanded="true"] .ev-hist-chev { transform: rotate(180deg); }
.ev-hist-body { border-block-start: 1px solid var(--line); }
.ev-hist-body .ev-none { padding: 16px 20px; }
.ev-hist-wait { padding: 22px; }
.ev-hist-more { display: flex; align-items: center; justify-content: center; gap: 10px; margin-block-start: 16px; }
```

and inside the existing `@media (max-width: 720px) { … }` block add:

```css
  .ev-tabs button { padding-inline: 12px; font-size: 14px; }
  .ev-hist-head { grid-template-columns: 1fr 18px; gap: 4px 10px; padding: 14px 16px; }
  .ev-hist-when, .ev-hist-name, .ev-hist-stats { grid-column: 1; }
  .ev-hist-chev { grid-column: 2; grid-row: 1 / span 3; }
```

- [ ] **Step 4: Load it** — in `admin.html` replace

```html
<script src="assets/admin-event-parts.js?v=1"></script>
<script src="assets/admin-event.js?v=3"></script>
```

with

```html
<script src="assets/admin-event-parts.js?v=1"></script>
<script src="assets/admin-event-history.js?v=1"></script>
<script src="assets/admin-event.js?v=4"></script>
```

and bump `assets/admin-event.css?v=2` → `?v=3`.

- [ ] **Step 5: Browser checks (mock on temporarily, desktop)**

```bash
node --check assets/admin-event-history.js && node --check assets/admin-event.js
```

With `USE_MOCK = true`, open an event in a workspace that has history:

```
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/admin.html?t5" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "if (!TamrinData.restoreSession()) { await TamrinData.signIn('a@b.c','x'); } const list = await TamrinData.activeEvents(); const ws = {}; for (const e of list) ws[e.id] = (await TamrinData.eventDetails(e.id)).event.workspace_id; ws" }
```

Pick an event id whose workspace is `w-1`…`w-4` (call it `A`), and one in `w-5` if any (call it `Z`). Then:

```
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/admin.html?t5#event/A" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "const sleep = (ms) => new Promise(r => setTimeout(r, ms)); await sleep(1200); const out = {}; out.count = document.getElementById('evPastCount').textContent; document.getElementById('evTabPast').click(); await sleep(50); out.paneShown = !document.getElementById('evPanePast').hidden && document.getElementById('evPaneThis').hidden; out.cards = document.querySelectorAll('.ev-hist').length; out.more = !!document.querySelector('[data-hist-more]'); const head = document.querySelector('.ev-hist-head'); const id = head.dataset.hist; let calls = 0; const orig = TamrinData.eventDetails; TamrinData.eventDetails = (x) => { calls++; return orig(x); }; head.click(); await sleep(600); out.expanded = document.querySelector(`[data-card=\"${id}\"] .ev-hist-head`).getAttribute('aria-expanded'); out.rows = document.querySelectorAll(`[data-card=\"${id}\"] tbody tr`).length; out.focusKept = document.activeElement.dataset.hist === id; document.querySelector(`[data-card=\"${id}\"] .ev-hist-head`).click(); await sleep(50); document.querySelector(`[data-card=\"${id}\"] .ev-hist-head`).click(); await sleep(300); out.detailCalls = calls; TamrinData.eventDetails = orig; out" }
```

Expected: `count` like `(8)`, `paneShown: true`, `cards` = min(10, count), `more` true only if count > 10, `expanded: "true"`, `rows` ≥ 1, `focusKept: true`, `detailCalls: 1` (re-expand used the cache).

Then check, recording each result:
1. Click «عرض المزيد» if shown → cards grow to the total, the button disappears, no duplicate `data-card` ids (`new Set([...document.querySelectorAll('[data-card]')].map(e => e.dataset.card)).size === document.querySelectorAll('[data-card]').length`).
2. A cancelled card shows the «ملغاة» tag (search `document.querySelectorAll('.ev-hist .tag')` for the text).
3. Click a `tr.row-link` inside an expanded card → the player sheet opens with that member's name; Esc closes it; the history tab is still shown.
4. Click «هذه الفعالية» → member list visible again; click back to the history tab → expanded state preserved.
5. Click «رجوع» → dashboard; open event `A` again → tab resets to «هذه الفعالية» and history is collapsed.
6. If an event `Z` (workspace `w-5`) exists: open it, switch tab → «لا فعاليات سابقة لهذه المجموعة», label `(0)`. If none exists, run `TamrinEventHistory.mount(document.getElementById('evPanePast'), { workspaceId: 'w-5', onCount(){} })` on event `A`'s page and check the same empty text.
7. Keyboard: Tab to a card header, press Enter → expands; Space → collapses.
8. `read_console_messages { "onlyErrors": true }` → empty.

- [ ] **Step 6: Mobile**

```
mcp__Claude_Browser__resize_window   { "preset": "mobile" }
mcp__Claude_Browser__navigate        { "url": "http://localhost:4173/admin.html?t5m#event/A" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "await new Promise(r => setTimeout(r, 1200)); document.getElementById('evTabPast').click(); document.querySelector('.ev-hist-head').click(); await new Promise(r => setTimeout(r, 600)); document.getElementById('evTabPast').scrollIntoView(); ({ noHScroll: document.documentElement.scrollWidth <= window.innerWidth })" }
mcp__Claude_Browser__computer        { "action": "screenshot" }
mcp__Claude_Browser__resize_window   { "preset": "desktop" }
```

Expected: `noHScroll: true`; both tab labels fit; card header stacks date / name / stats with the chevron on the side.

- [ ] **Step 7: Run all tests, restore `USE_MOCK`, commit**

```
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/tests/admin-event.test.html?t5t" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "window.__results" }
```

Expected: `passed: 22, failed: 0`.

```bash
git diff assets/admin-data.js | grep -n 'USE_MOCK *='
```

Expected: no output.

```bash
git add assets/admin-event-history.js assets/admin-event.js assets/admin-event.css admin.html
git commit -m "Add the group past-events tab to the event page"
```

---

### Task 6: Prod check after `db push`

Runs only after the human confirms Task 1 Step 5.

- [ ] **Step 1:** Human opens an event on the live dashboard, switches to «فعاليات المجموعة السابقة», expands one past event, and confirms the expanded registrant count and paid count match that card's header numbers.
- [ ] **Step 2:** If they differ, ask for `select public.admin_list_workspace_past_events('<workspace id>'::uuid, 1, 10);` and `select public.admin_event_details('<past event id>'::uuid);` and debug with superpowers:systematic-debugging before changing code.
