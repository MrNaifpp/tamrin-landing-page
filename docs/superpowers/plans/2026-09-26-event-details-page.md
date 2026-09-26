# Event Details Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking an active event in the admin dashboard opens a full event page (`admin.html#event/<id>`) with the member list and insights on seats, payment, group response, waitlist and pace.

**Architecture:** One new admin RPC `admin_event_details(p_event_id)` returns everything as one JSON. `TamrinData.eventDetails(id)` wraps it (with a mock path). Pure display math lives in `TamrinEventCalc` (tested in the browser harness); `TamrinEvent` renders the view; `admin.js` adds clickable rows and a small hash router.

**Tech Stack:** Static HTML/CSS/vanilla JS (no build), Supabase Postgres (plpgsql, PostgREST RPC), Python `http.server` preview on port 4173.

Spec: `docs/superpowers/specs/2026-09-26-event-details-page-design.md`

## Global Constraints

- Arabic RTL UI. Latin digits via `Intl.NumberFormat('ar-SA-u-nu-latn')` and dates via `'ar-SA-u-ca-gregory-nu-latn'`, same as `assets/admin.js`.
- Every user-supplied string is passed through `esc()` before going into HTML.
- `admin.js` never talks to the server; only `assets/admin-data.js` does (`TamrinData`). `USE_MOCK` must keep working.
- Payment status mapping (verified on prod 2026-09-26): `confirmed` → paid, `waived` → waived, anything else → pending (raw value kept).
- Response status (verified): `declined` = declined; `invited` or no row = no reply.
- Guest rows: `user_id is null and not added_manually` (`added_by` = the member who brought them). Manually added rows: `user_id is null and added_manually` (`added_by` = the organiser).
- Group size counts the owner once: members ∪ `{workspaces.owner_id}`.
- Every `admin_*` function: `security definer`, `stable`, `set search_path = public, pg_temp`, first statement checks `public.is_current_user_admin()` and raises errcode `42501`; `revoke execute … from public, anon; grant execute … to authenticated`.
- No database credentials in this environment: SQL is delivered as files; the human runs it in the Supabase SQL editor.
- Bump the `?v=` query on every changed script/style tag in `admin.html`.

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `supabase/admin-event-details.sql` | create | The `admin_event_details` RPC (run in SQL editor). |
| `~/Documents/tamrin/supabase/migrations/20260926100000_admin_event_details.sql` | create | Same SQL as a tracked migration in the app repo. |
| `assets/admin-event-calc.js` | create | `TamrinEventCalc` — pure functions, no DOM. |
| `tests/admin-event.test.html` | create | Browser test harness for `TamrinEventCalc`, exposes `window.__results`. |
| `assets/admin-data.js` | modify | `eventDetails(id)` + mock builder; contract comment. |
| `assets/admin-event.js` | create | `TamrinEvent` — renders `#eventView`. |
| `assets/admin-event.css` | create | Styles for the event view. |
| `admin.html` | modify | `#eventView` container, `id="segTabs"`, script/style tags. |
| `assets/admin.js` | modify | Clickable event rows, hash router, wiring. |

---

### Task 1: The `admin_event_details` RPC

**Files:**
- Create: `supabase/admin-event-details.sql`
- Create: `~/Documents/tamrin/supabase/migrations/20260926100000_admin_event_details.sql` (on a new branch in that repo)

**Interfaces:**
- Consumes: `public.is_current_user_admin()` (exists, `supabase/admin-dashboard.sql`).
- Produces: `public.admin_event_details(p_event_id uuid) returns json` — `null` if no such event, else:

```jsonc
{
  "event": { "id", "name", "description", "workspace_id", "workspace_name", "creator_name",
             "location", "start_date", "end_date", "price_per_person", "total_price",
             "max_participants", "registration_locked", "published_at", "cancelled_at" },
  "participants": [ { "id", "user_id", "name", "avatar_url", "postion", "is_guest",
                      "added_manually", "added_by_name", "payment_status", "paid_amount",
                      "registered_at" } ],
  "waitlist": [ { "user_id", "name", "avatar_url", "joined_at" } ],
  "declined": [ { "user_id", "name", "avatar_url", "reason_code", "reason_text", "responded_at" } ],
  "no_reply": [ { "user_id", "name", "avatar_url" } ],
  "group_size": 12
}
```

- [ ] **Step 1: Write `supabase/admin-event-details.sql`**

```sql
-- =====================================================================
-- تمرين — لوحة التحكم: تفاصيل الفعالية
-- ---------------------------------------------------------------------
-- يُنفَّذ على مشروع الإنتاج timrin-prod (hzsxwnmbdkrmipjtfzlp) من محرّر
-- SQL في لوحة Supabase، ونسخته المتتبَّعة في مستودع التطبيق:
--   supabase/migrations/20260926100000_admin_event_details.sql
-- إضافي بالكامل: دالة قراءة واحدة، لا يعدّل جدولًا ولا سياسة RLS.
--
-- قيم الحالة (تُحقّق منها في prod في 2026-09-26):
--   payment_status: confirmed (مدفوع) · waived (معفى) · pending
--   event_member_responses.status: invited · declined
-- =====================================================================

begin;

create or replace function public.admin_event_details(p_event_id uuid)
returns json
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_event  public.events%rowtype;
  v_owner  uuid;
  v_result json;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    return null;
  end if;

  select w.owner_id into v_owner
  from public.workspaces w where w.id = v_event.workspace_id;

  with parts as (
    select p.*,
           u.name       as u_name,
           u.avatar_url as u_avatar,
           u.postion    as u_postion,
           ab.name      as added_by_name
    from public.event_participants p
    left join public.users u  on u.user_id  = p.user_id
    left join public.users ab on ab.user_id = p.added_by
    where p.event_id = p_event_id
  ),
  -- المالك يُعدّ مرة واحدة: قد لا يكون له صف في workspace_members.
  members as (
    select m.user_id from public.workspace_members m
     where m.workspace_id = v_event.workspace_id
    union
    select v_owner where v_owner is not null
  ),
  waiting as (
    select wl.user_id, wl.joined_at
    from public.event_waitlist wl
    where wl.event_id = p_event_id
  ),
  declined as (
    select r.user_id, r.reason_code, r.reason_text, r.responded_at
    from public.event_member_responses r
    where r.event_id = p_event_id
      and r.status = 'declined'
      and not exists (select 1 from parts p where p.user_id = r.user_id)
  ),
  no_reply as (
    select m.user_id from members m
    where not exists (select 1 from parts p    where p.user_id = m.user_id)
      and not exists (select 1 from waiting wt where wt.user_id = m.user_id)
      and not exists (select 1 from declined d where d.user_id = m.user_id)
  )
  select json_build_object(
    'event', (
      select json_build_object(
        'id', v_event.id,
        'name', v_event.name,
        'description', v_event.description,
        'workspace_id', v_event.workspace_id,
        'workspace_name', w.name,
        'creator_name', coalesce(nullif(btrim(cu.name), ''), '—'),
        'location', v_event.location,
        'start_date', v_event.start_date,
        'end_date', v_event.end_date,
        'price_per_person', v_event.price_per_person,
        'total_price', v_event.total_price,
        'max_participants', v_event.max_participants,
        'registration_locked', v_event.registration_locked,
        'published_at', v_event.published_at,
        'cancelled_at', v_event.cancelled_at)
      from public.workspaces w
      left join public.users cu on cu.user_id = v_event.creator_id
      where w.id = v_event.workspace_id),
    'participants', coalesce((
      select json_agg(json_build_object(
        'id', p.id,
        'user_id', p.user_id,
        'name', case when p.user_id is null
                     then coalesce(nullif(btrim(p.guest_name), ''), '—')
                     else coalesce(nullif(btrim(p.u_name), ''), '—') end,
        'avatar_url', p.u_avatar,
        'postion', p.u_postion,
        'is_guest', p.user_id is null and not p.added_manually,
        'added_manually', p.added_manually,
        'added_by_name', nullif(btrim(p.added_by_name), ''),
        'payment_status', p.payment_status,
        'paid_amount', case when p.payment_status = 'confirmed'
                            then coalesce(p.paid_price_per_person, v_event.price_per_person)
                            else 0 end,
        'registered_at', p.created_at
      ) order by p.created_at)
      from parts p), '[]'::json),
    'waitlist', coalesce((
      select json_agg(json_build_object(
        'user_id', wt.user_id,
        'name', coalesce(nullif(btrim(u.name), ''), '—'),
        'avatar_url', u.avatar_url,
        'joined_at', wt.joined_at
      ) order by wt.joined_at)
      from waiting wt left join public.users u on u.user_id = wt.user_id), '[]'::json),
    'declined', coalesce((
      select json_agg(json_build_object(
        'user_id', d.user_id,
        'name', coalesce(nullif(btrim(u.name), ''), '—'),
        'avatar_url', u.avatar_url,
        'reason_code', d.reason_code,
        'reason_text', nullif(btrim(d.reason_text), ''),
        'responded_at', d.responded_at
      ) order by d.responded_at desc nulls last)
      from declined d left join public.users u on u.user_id = d.user_id), '[]'::json),
    'no_reply', coalesce((
      select json_agg(json_build_object(
        'user_id', n.user_id,
        'name', coalesce(nullif(btrim(u.name), ''), '—'),
        'avatar_url', u.avatar_url
      ) order by u.name)
      from no_reply n left join public.users u on u.user_id = n.user_id), '[]'::json),
    'group_size', (select count(*) from members)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_event_details(uuid) from public, anon;
grant  execute on function public.admin_event_details(uuid) to authenticated;

commit;
```

- [ ] **Step 2: Copy it into the app repo as a migration on a new branch**

```bash
cd ~/Documents/tamrin && git checkout -b admin/event-details && cp ~/Documents/tamrin-landing-page/supabase/admin-event-details.sql supabase/migrations/20260926100000_admin_event_details.sql
```

Expected: branch created, file present. Do **not** run `supabase db push`.

- [ ] **Step 3: Commit both repos**

```bash
cd ~/Documents/tamrin && git add supabase/migrations/20260926100000_admin_event_details.sql && git commit -m "Add admin_event_details for the dashboard event page"
cd ~/Documents/tamrin-landing-page && git add supabase/admin-event-details.sql && git commit -m "Add admin_event_details for the dashboard event page"
```

- [ ] **Step 4: Hand off to the human**

Ask the human to run `supabase/admin-event-details.sql` in the Supabase SQL editor on `timrin-prod`, then run this and paste the result:

```sql
select proname, prosecdef from pg_proc where proname = 'admin_event_details';
```

Expected: one row, `prosecdef = true`. Tasks 2–7 run on mock data and do not wait for this.

---

### Task 2: `TamrinEventCalc` pure functions + tests

**Files:**
- Create: `assets/admin-event-calc.js`
- Test: `tests/admin-event.test.html`

**Interfaces:**
- Consumes: the `admin_event_details` JSON shape (Task 1).
- Produces (`window.TamrinEventCalc`):
  - `payState(status: string) -> 'paid' | 'waived' | 'pending'`
  - `summary(details) -> { filled, max, seatPct, full, paid, waived, pending, collected, expected, collectedPct, groupSize, registeredMembers, declined, noReply, waitlist }` (`max`, `seatPct`, `collectedPct` may be `null`)
  - `filterParticipants(list, filter) -> list` where `filter ∈ 'all' | 'paid' | 'waived' | 'pending' | 'guests'`
  - `filterCounts(list) -> { all, paid, waived, pending, guests }`
  - `durationText(ms: number) -> string`
  - `pace(details, nowMs: number) -> null | { kind: 'filled' | 'last', text: string }`

- [ ] **Step 1: Write the failing test file `tests/admin-event.test.html`**

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>اختبارات منطق الفعالية</title>
  <style>
    body { font: 15px/1.6 system-ui, sans-serif; padding: 24px; background: #f3f3f3; }
    h1 { font-size: 19px; margin-block-end: 16px; }
    .pass { color: #2f7a48; }
    .fail { color: #b3261e; font-weight: 700; }
    ol { padding-inline-start: 22px; }
    #summary { margin-block-end: 14px; font-weight: 700; }
  </style>
</head>
<body>
  <h1>اختبارات منطق الفعالية — TamrinEventCalc</h1>
  <div id="summary">جارٍ التنفيذ…</div>
  <ol id="out"></ol>

  <script src="../assets/admin-event-calc.js"></script>
  <script>
  (function () {
    'use strict';
    const results = { passed: 0, failed: 0, failures: [] };
    const out = document.getElementById('out');

    function test(name, fn) {
      let error = null;
      try { fn(); } catch (e) { error = e && e.message ? e.message : String(e); }
      const li = document.createElement('li');
      if (error) {
        results.failed++;
        results.failures.push(name + ': ' + error);
        li.className = 'fail';
        li.textContent = 'FAIL — ' + name + ' — ' + error;
      } else {
        results.passed++;
        li.className = 'pass';
        li.textContent = 'PASS — ' + name;
      }
      out.appendChild(li);
    }

    function eq(actual, expected, what) {
      const a = JSON.stringify(actual), b = JSON.stringify(expected);
      if (a !== b) throw new Error((what || 'value') + ' expected ' + b + ' got ' + a);
    }

    const C = window.TamrinEventCalc;
    const H = 3600000;
    const T0 = Date.parse('2026-09-20T10:00:00Z');
    const iso = function (ms) { return new Date(ms).toISOString(); };

    function part(o) {
      return Object.assign({ id: 'p', user_id: 'u', name: 'x', is_guest: false,
        added_manually: false, payment_status: 'pending', paid_amount: 0,
        registered_at: iso(T0) }, o);
    }
    function details(parts, o) {
      return Object.assign({
        event: { price_per_person: 30, max_participants: 4, published_at: iso(T0) },
        participants: parts, waitlist: [], declined: [], no_reply: [], group_size: 10
      }, o);
    }

    test('payState maps the verified statuses', function () {
      eq(C.payState('confirmed'), 'paid');
      eq(C.payState('waived'), 'waived');
      eq(C.payState('pending'), 'pending');
    });

    test('payState treats unknown or missing status as pending', function () {
      eq(C.payState('refunded'), 'pending', 'unknown');
      eq(C.payState(null), 'pending', 'null');
    });

    test('summary counts seats and fill percent, guests included', function () {
      const s = C.summary(details([part({}), part({ user_id: null, is_guest: true })]));
      eq(s.filled, 2, 'filled'); eq(s.max, 4, 'max'); eq(s.seatPct, 50, 'pct'); eq(s.full, false, 'full');
    });

    test('summary without max has null seatPct and is never full', function () {
      const d = details([part({})]); d.event.max_participants = null;
      const s = C.summary(d);
      eq(s.max, null, 'max'); eq(s.seatPct, null, 'pct'); eq(s.full, false, 'full');
    });

    test('summary caps seatPct at 100 and flags full', function () {
      const d = details([part({}), part({}), part({})]); d.event.max_participants = 2;
      const s = C.summary(d);
      eq(s.seatPct, 100, 'pct'); eq(s.full, true, 'full');
    });

    test('summary splits paid / waived / pending, unknown falls to pending', function () {
      const s = C.summary(details([
        part({ payment_status: 'confirmed', paid_amount: 30 }),
        part({ payment_status: 'waived' }),
        part({ payment_status: 'pending' }),
        part({ payment_status: 'weird' })
      ]));
      eq([s.paid, s.waived, s.pending], [1, 1, 2]);
    });

    test('summary collected sums paid_amount, expected excludes waived', function () {
      const s = C.summary(details([
        part({ payment_status: 'confirmed', paid_amount: 30 }),
        part({ payment_status: 'confirmed', paid_amount: 25 }),
        part({ payment_status: 'waived' }),
        part({ payment_status: 'pending' })
      ]));
      eq(s.collected, 55, 'collected'); eq(s.expected, 90, 'expected'); eq(s.collectedPct, 61, 'pct');
    });

    test('summary collectedPct is null when nothing is expected', function () {
      const s = C.summary(details([part({ payment_status: 'waived' })]));
      eq(s.expected, 0, 'expected'); eq(s.collectedPct, null, 'pct');
    });

    test('summary counts distinct registered members and response lists', function () {
      const s = C.summary(details(
        [part({ user_id: 'a' }), part({ user_id: 'a' }), part({ user_id: null, is_guest: true }), part({ user_id: 'b' })],
        { declined: [{}, {}], no_reply: [{}], waitlist: [{}, {}, {}], group_size: 9 }));
      eq([s.registeredMembers, s.declined, s.noReply, s.waitlist, s.groupSize], [2, 2, 1, 3, 9]);
    });

    test('filterParticipants and filterCounts agree for every chip', function () {
      const list = [
        part({ id: '1', payment_status: 'confirmed' }),
        part({ id: '2', payment_status: 'waived' }),
        part({ id: '3', payment_status: 'pending', user_id: null, is_guest: true }),
        part({ id: '4', payment_status: 'x', user_id: null, added_manually: true })
      ];
      const ids = function (f) { return C.filterParticipants(list, f).map(function (p) { return p.id; }); };
      eq(ids('all'), ['1', '2', '3', '4'], 'all');
      eq(ids('paid'), ['1'], 'paid');
      eq(ids('waived'), ['2'], 'waived');
      eq(ids('pending'), ['3', '4'], 'pending');
      eq(ids('guests'), ['3', '4'], 'guests');
      eq(C.filterCounts(list), { all: 4, paid: 1, waived: 1, pending: 2, guests: 2 }, 'counts');
    });

    test('durationText uses Arabic dual and plural forms', function () {
      eq(C.durationText(30 * 1000), 'أقل من دقيقة', '<1m');
      eq(C.durationText(1 * 60000), 'دقيقة', '1m');
      eq(C.durationText(2 * 60000), 'دقيقتين', '2m');
      eq(C.durationText(5 * 60000), '5 دقائق', '5m');
      eq(C.durationText(45 * 60000), '45 دقيقة', '45m');
      eq(C.durationText(1 * H), 'ساعة', '1h');
      eq(C.durationText(2 * H), 'ساعتين', '2h');
      eq(C.durationText(7 * H), '7 ساعات', '7h');
      eq(C.durationText(30 * H), '30 ساعة', '30h');
      eq(C.durationText(48 * H), 'يومين', '2d');
      eq(C.durationText(24 * 4 * H), '4 أيام', '4d');
      eq(C.durationText(24 * 12 * H), '12 يوم', '12d');
    });

    test('pace is null with no participants', function () {
      eq(C.pace(details([]), T0 + H), null);
    });

    test('pace reports time to fill from publishing when full', function () {
      const d = details([
        part({ registered_at: iso(T0 + 1 * H) }),
        part({ registered_at: iso(T0 + 3 * H) })
      ]);
      d.event.max_participants = 2;
      eq(C.pace(d, T0 + 50 * H), { kind: 'filled', text: 'اكتمل خلال 3 ساعات من النشر' });
    });

    test('pace uses the registration that reached max, not the last one', function () {
      const d = details([
        part({ registered_at: iso(T0 + 5 * H) }),
        part({ registered_at: iso(T0 + 2 * H) }),
        part({ registered_at: iso(T0 + 9 * H) })
      ]);
      d.event.max_participants = 2;
      eq(C.pace(d, T0 + 50 * H).text, 'اكتمل خلال 5 ساعات من النشر');
    });

    test('pace reports the last registration when not full', function () {
      const d = details([
        part({ registered_at: iso(T0 + 1 * H) }),
        part({ registered_at: iso(T0 + 4 * H) })
      ]);
      eq(C.pace(d, T0 + 6 * H), { kind: 'last', text: 'آخر تسجيل قبل ساعتين' });
    });

    test('pace falls back to last registration when full but never published', function () {
      const d = details([part({ registered_at: iso(T0) })]);
      d.event.max_participants = 1; d.event.published_at = null;
      eq(C.pace(d, T0 + 2 * H).kind, 'last');
    });

    window.__results = results;
    document.getElementById('summary').textContent =
      results.failed === 0
        ? 'نجحت جميع الاختبارات (' + results.passed + ')'
        : results.failed + ' فشل من ' + (results.passed + results.failed);
  })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Run it to verify it fails**

```
mcp__Claude_Browser__preview_start  { "name": "tamrin-site" }
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/tests/admin-event.test.html" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "window.__results" }
```

Expected: `undefined` (the script throws because `window.TamrinEventCalc` is undefined). `read_console_messages` shows `Cannot read properties of undefined`.

- [ ] **Step 3: Write `assets/admin-event-calc.js`**

```js
/* =========================================================================
   تمرين — منطق صفحة الفعالية الخالص
   ---------------------------------------------------------------------
   لا يلمس DOM ولا الشبكة، فيُختبر وحده في tests/admin-event.test.html.
   قيم payment_status تُحقّق منها في prod في 2026-09-26:
     confirmed (مدفوع) · waived (معفى) · pending
   أي قيمة أخرى تُعامَل «لم يدفع» حتى لا تُحسب مدفوعة خطأً.
   ========================================================================= */

(function (global) {
  'use strict';

  const PAY = { confirmed: 'paid', waived: 'waived' };

  function payState(status) {
    return PAY[status] || 'pending';
  }

  function summary(d) {
    const ev = d.event || {};
    const parts = d.participants || [];
    const filled = parts.length;
    const max = ev.max_participants || null;

    let paid = 0, waived = 0, pending = 0, collected = 0;
    parts.forEach((p) => {
      const s = payState(p.payment_status);
      if (s === 'paid') paid++;
      else if (s === 'waived') waived++;
      else pending++;
      collected += Number(p.paid_amount) || 0;
    });

    // المعفى لا يدين بشيء، فلا يدخل في المتوقّع — فعالية مسدَّدة بالكامل تقرأ 100%.
    const expected = (Number(ev.price_per_person) || 0) * (filled - waived);

    return {
      filled,
      max,
      seatPct: max ? Math.min(100, Math.round((filled / max) * 100)) : null,
      full: !!max && filled >= max,
      paid, waived, pending,
      collected,
      expected,
      collectedPct: expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : null,
      groupSize: d.group_size || 0,
      registeredMembers: new Set(parts.filter((p) => p.user_id).map((p) => p.user_id)).size,
      declined: (d.declined || []).length,
      noReply: (d.no_reply || []).length,
      waitlist: (d.waitlist || []).length
    };
  }

  const FILTERS = {
    all: () => true,
    paid: (p) => payState(p.payment_status) === 'paid',
    waived: (p) => payState(p.payment_status) === 'waived',
    pending: (p) => payState(p.payment_status) === 'pending',
    guests: (p) => !p.user_id
  };

  function filterParticipants(list, filter) {
    return (list || []).filter(FILTERS[filter] || FILTERS.all);
  }

  function filterCounts(list) {
    const out = {};
    Object.keys(FILTERS).forEach((k) => { out[k] = filterParticipants(list, k).length; });
    return out;
  }

  /* مفرد · مثنى · جمع (3–10) · تمييز مفرد (11+) */
  function unit(n, one, two, few) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n <= 10) return `${n} ${few}`;
    return `${n} ${one}`;
  }

  function durationText(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'أقل من دقيقة';
    if (min < 60) return unit(min, 'دقيقة', 'دقيقتين', 'دقائق');
    const hrs = Math.floor(min / 60);
    if (hrs < 48) return unit(hrs, 'ساعة', 'ساعتين', 'ساعات');
    return unit(Math.floor(hrs / 24), 'يوم', 'يومين', 'أيام');
  }

  function pace(d, nowMs) {
    const times = (d.participants || [])
      .map((p) => Date.parse(p.registered_at))
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);
    if (!times.length) return null;

    const ev = d.event || {};
    const max = ev.max_participants;
    const published = Date.parse(ev.published_at);
    if (max && times.length >= max && !Number.isNaN(published)) {
      // الوقت حتى التسجيل الذي أكمل العدد، لا آخر تسجيل
      return { kind: 'filled', text: `اكتمل خلال ${durationText(times[max - 1] - published)} من النشر` };
    }
    return { kind: 'last', text: `آخر تسجيل قبل ${durationText(nowMs - times[times.length - 1])}` };
  }

  global.TamrinEventCalc = {
    payState: payState,
    summary: summary,
    filterParticipants: filterParticipants,
    filterCounts: filterCounts,
    durationText: durationText,
    pace: pace
  };
})(window);
```

- [ ] **Step 4: Run the tests to verify they pass**

```
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/tests/admin-event.test.html" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "window.__results" }
```

Expected: `{ "passed": 16, "failed": 0, "failures": [] }`.

- [ ] **Step 5: Commit**

```bash
git add assets/admin-event-calc.js tests/admin-event.test.html
git commit -m "Add the pure event-page calculations with browser tests"
```

---

### Task 3: `TamrinData.eventDetails` with mock data

**Files:**
- Modify: `assets/admin-data.js` — contract comment (top), after `MOCK_EVENTS` (~line 159), after `activeEvents()` (~line 315), the `global.TamrinData` export (end).

**Interfaces:**
- Consumes: private `rpc(fn, args)`, `USE_MOCK`, `wait`, `seeded`, `MOCK_USERS`, `MOCK_EVENTS`, `now`, `DAY`.
- Produces: `TamrinData.eventDetails(id: string) -> Promise<details | null>` (shape from Task 1).

- [ ] **Step 1: Add the contract line**

In the header comment, after the `activeEvents()` line add:

```
     eventDetails(eventId)   -> { event, participants, waitlist, declined, no_reply, group_size } | null
```

- [ ] **Step 2: Add the mock builder right after the `MOCK_EVENTS` declaration (after its `.sort(...)` line)**

```js
  /* تفاصيل فعالية تجريبية. تُبنى من صف القائمة نفسه حتى تتطابق الأرقام:
     عدد المسجّلين = participant_count، والمدفوعون = paid_count. */
  function mockEventDetails(id) {
    const ev = MOCK_EVENTS.find((e) => e.id === id);
    if (!ev) return null;
    const i = Number(id.slice(2));

    // ترتيب ثابت للمستخدمين خاص بهذه الفعالية
    const pool = MOCK_USERS
      .map((u, k) => ({ u, r: seeded(i * 97 + k) }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.u);

    const guests = Math.min(2, Math.floor(seeded(i + 131) * 3));
    const memberSeats = ev.participant_count - guests;
    const published = Date.parse(ev.published_at);
    const step = (1 + Math.floor(seeded(i + 137) * 5)) * 3600000;
    const at = (k) => new Date(Math.min(now, published + (k + 1) * step)).toISOString();
    const status = (k) => (k < ev.paid_count ? 'confirmed'
      : seeded(i * 17 + k) > 0.6 ? 'waived' : 'pending');

    const participants = [];
    for (let k = 0; k < ev.participant_count; k++) {
      const st = status(k);
      if (k < memberSeats) {
        const u = pool[k];
        participants.push({
          id: `${id}-p${k}`, user_id: u.user_id, name: u.name, avatar_url: null,
          postion: u.postion, is_guest: false, added_manually: false, added_by_name: null,
          payment_status: st, paid_amount: st === 'confirmed' ? ev.price_per_person : 0,
          registered_at: at(k)
        });
      } else {
        const host = pool[k - memberSeats];
        participants.push({
          id: `${id}-p${k}`, user_id: null, name: `ضيف ${k - memberSeats + 1}`, avatar_url: null,
          postion: null, is_guest: true, added_manually: false, added_by_name: host.name,
          payment_status: st, paid_amount: st === 'confirmed' ? ev.price_per_person : 0,
          registered_at: at(k)
        });
      }
    }

    let next = memberSeats;
    const take = (n) => { const out = pool.slice(next, next + n); next += n; return out; };
    const waitlist = take(ev.waitlist_count).map((u, k) => ({
      user_id: u.user_id, name: u.name, avatar_url: null,
      joined_at: new Date(Math.min(now, published + (ev.participant_count + k + 1) * step)).toISOString()
    }));
    const reasons = ['مسافر', 'عندي دوام', null, 'إصابة'];
    const declined = take(1 + Math.floor(seeded(i + 139) * 3)).map((u, k) => ({
      user_id: u.user_id, name: u.name, avatar_url: null,
      reason_code: null, reason_text: reasons[(i + k) % reasons.length],
      responded_at: new Date(Math.min(now, published + (k + 2) * step)).toISOString()
    }));
    const noReply = take(Math.floor(seeded(i + 149) * 5)).map((u) => ({
      user_id: u.user_id, name: u.name, avatar_url: null
    }));

    return {
      event: {
        id: ev.id, name: ev.name, description: '', workspace_id: null,
        workspace_name: ev.workspace_name, creator_name: ev.creator_name,
        location: ev.location, start_date: ev.start_date, end_date: ev.end_date,
        price_per_person: ev.price_per_person, total_price: ev.total_price,
        max_participants: ev.max_participants, registration_locked: ev.registration_locked,
        published_at: ev.published_at, cancelled_at: null
      },
      participants,
      waitlist,
      declined,
      no_reply: noReply,
      group_size: memberSeats + waitlist.length + declined.length + noReply.length
    };
  }
```

- [ ] **Step 3: Add `eventDetails` right after the `activeEvents()` function**

```js
  async function eventDetails(eventId) {
    if (USE_MOCK) {
      await wait(260);
      return mockEventDetails(eventId);
    }
    return rpc('admin_event_details', { p_event_id: eventId });
  }
```

- [ ] **Step 4: Export it** — change the export to:

```js
  global.TamrinData = {
    signIn, signOut, restoreSession, isMock,
    overview, users, activeEvents, eventDetails,
    playerProfile, deleteRating
  };
```

- [ ] **Step 5: Verify the mock path against the calc functions**

Temporarily change `const USE_MOCK = !SUPABASE_ANON_KEY;` to `const USE_MOCK = true;`, then:

```
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/admin.html" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "await TamrinData.signIn('a@b.c','x'); const list = await TamrinData.activeEvents(); const bad = []; for (const ev of list) { const d = await TamrinData.eventDetails(ev.id); if (d.participants.length !== ev.participant_count || d.participants.filter(p => p.payment_status === 'confirmed').length !== ev.paid_count || d.waitlist.length !== ev.waitlist_count) bad.push(ev.id); } ({ events: list.length, bad, missing: await TamrinData.eventDetails('nope') })" }
```

Expected: `{ "events": 9, "bad": [], "missing": null }`.

Revert `USE_MOCK` and confirm:

```bash
git diff assets/admin-data.js | grep -n 'USE_MOCK *='
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add assets/admin-data.js
git commit -m "Add eventDetails to the data layer with matching mock data"
```

---

### Task 4: The event view module `TamrinEvent` + styles + container

**Files:**
- Create: `assets/admin-event.js`
- Create: `assets/admin-event.css`
- Modify: `admin.html` — add the stylesheet link, `id="segTabs"` on `.seg`, the `#eventView` section, the two script tags.

**Interfaces:**
- Consumes: `TamrinData.eventDetails(id)` (Task 3), `TamrinEventCalc` (Task 2).
- Produces (`window.TamrinEvent`):
  - `init({ onBack: () => void, onOpenPlayer: (userId: string) => void })`
  - `open(eventId: string)` — shows `#eventView`, loads and renders.
  - `close()` — hides `#eventView`, discards any in-flight load.

- [ ] **Step 1: Edit `admin.html`**

In `<head>`, right after the existing `assets/admin-sheet.css` link, add:

```html
<link rel="stylesheet" href="assets/admin-event.css?v=1" />
```

Change `<div class="seg" role="tablist" aria-label="الأقسام">` to:

```html
<div class="seg" id="segTabs" role="tablist" aria-label="الأقسام">
```

Right before `</main>` add:

```html
    <!-- تفاصيل الفعالية -->
    <section id="eventView" class="ev" aria-live="polite" hidden></section>
```

Replace the script block at the end with (bump `admin-data.js` and `admin.js`):

```html
<script src="assets/admin-data.js?v=6"></script>
<script src="assets/admin-ratings.js?v=1"></script>
<script src="assets/admin-search.js?v=1"></script>
<script src="assets/admin-player.js?v=1"></script>
<script src="assets/admin-event-calc.js?v=1"></script>
<script src="assets/admin-event.js?v=1"></script>
<script src="assets/admin.js?v=6"></script>
```

- [ ] **Step 2: Write `assets/admin-event.js`**

```js
/* =========================================================================
   تمرين — صفحة الفعالية
   ---------------------------------------------------------------------
   تُفتح بمعرّف فعالية فقط ولا تعرف شيئًا عن الموجّه (#event/<id>) —
   الربط في admin.js. الحسابات كلها في TamrinEventCalc.
   ========================================================================= */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

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

  const C = () => global.TamrinEventCalc;

  const CHIPS = [
    { key: 'all', label: 'الكل' },
    { key: 'paid', label: 'مدفوع' },
    { key: 'waived', label: 'معفى' },
    { key: 'pending', label: 'لم يدفع' },
    { key: 'guests', label: 'ضيوف' }
  ];

  let opts = { onBack() {}, onOpenPlayer() {} };
  let seq = 0;
  let currentId = null;
  let details = null;
  let filter = 'all';

  /* --------------------------------------------------------- أجزاء */

  function who(name, sub) {
    return `
      <span class="who">
        <span class="avatar sm" aria-hidden="true">${esc(initials(name))}</span>
        <span><b>${esc(name)}</b>${sub ? `<span class="ev-sub">${sub}</span>` : ''}</span>
      </span>`;
  }

  function backBtn() {
    return `<button type="button" class="btn-quiet ev-back" data-act="back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      رجوع</button>`;
  }

  function headHtml(ev) {
    const locked = ev.registration_locked ? ' <span class="tag tag-flat">التسجيل مقفل</span>' : '';
    return `
      <div class="ev-top">${backBtn()}</div>
      <header class="panel ev-head">
        <h1>${esc(ev.name)}${locked}</h1>
        <dl class="ev-meta">
          <div><dt>المجموعة</dt><dd>${esc(ev.workspace_name)}</dd></div>
          <div><dt>المنظّم</dt><dd>${esc(ev.creator_name || '—')}</dd></div>
          <div><dt>الموعد</dt><dd>${asWhen(ev.start_date)}</dd></div>
          <div><dt>الموقع</dt><dd>${esc(ev.location || '—')}</dd></div>
          <div><dt>السعر للشخص</dt><dd>${num(ev.price_per_person)} ريال</dd></div>
        </dl>
      </header>`;
  }

  function bar(pct, full) {
    return pct === null ? ''
      : `<span class="meter"><span class="bar"><i class="${full ? 'full' : ''}" style="width:${pct}%"></i></span></span>`;
  }

  function cardsHtml(s) {
    const seats = s.max ? `${num(s.filled)}/${num(s.max)}` : num(s.filled);
    const collected = s.collectedPct === null
      ? `${num(s.collected)} ريال`
      : `${num(s.collected)} من ${num(s.expected)} ريال`;
    return `
      <section class="stat-grid ev-cards" aria-label="ملخّص الفعالية">
        <div class="stat-card">
          <div class="k">المقاعد</div><div class="v">${seats}</div>
          ${bar(s.seatPct, s.full)}
          <div class="sub">${s.full ? 'مكتملة' : s.max ? `${num(s.seatPct)}% ممتلئة` : 'بلا حدّ أقصى'}</div>
        </div>
        <div class="stat-card">
          <div class="k">الدفع</div><div class="v">${num(s.paid)}<small>/${num(s.filled)}</small></div>
          ${bar(s.collectedPct, false)}
          <div class="sub">${collected} · معفى ${num(s.waived)} · لم يدفع ${num(s.pending)}</div>
        </div>
        <div class="stat-card">
          <div class="k">تجاوب المجموعة</div><div class="v">${num(s.registeredMembers)}<small>/${num(s.groupSize)}</small></div>
          <div class="sub">سجّل ${num(s.registeredMembers)} · اعتذر ${num(s.declined)} · لم يردّ ${num(s.noReply)}</div>
        </div>
        <div class="stat-card">
          <div class="k">قائمة الانتظار</div><div class="v">${num(s.waitlist)}</div>
          <div class="sub">${s.waitlist ? 'بانتظار مقعد' : 'لا أحد ينتظر'}</div>
        </div>
      </section>`;
  }

  function payTag(p) {
    const s = C().payState(p.payment_status);
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

  function membersBodyHtml() {
    const rows = C().filterParticipants(details.participants, filter);
    if (!rows.length) {
      return `<tr><td colspan="4"><div class="empty">${details.participants.length
        ? 'لا أحد في هذا التصنيف.' : '<b>لا مسجّلين بعد</b>لم يسجّل أحد في هذه الفعالية.'}</div></td></tr>`;
    }
    return rows.map(memberRow).join('');
  }

  function chipsHtml() {
    const counts = C().filterCounts(details.participants);
    return CHIPS.map((c) => `
      <button type="button" data-filter="${c.key}" aria-pressed="${c.key === filter}">
        ${c.label} <span>${num(counts[c.key])}</span></button>`).join('');
  }

  function membersHtml() {
    return `
      <section class="panel ev-members">
        <div class="panel-head">
          <div><h2>المسجّلون</h2><span class="count">${num(details.participants.length)}</span></div>
          <div class="ev-chips" id="evChips" role="group" aria-label="تصفية">${chipsHtml()}</div>
        </div>
        <div class="table-scroll">
          <table class="data">
            <thead><tr>
              <th scope="col">الاسم</th><th scope="col">المركز</th>
              <th scope="col">سجّل</th><th scope="col">الدفع</th>
            </tr></thead>
            <tbody id="evMembers">${membersBodyHtml()}</tbody>
          </table>
        </div>
      </section>`;
  }

  function listPanel(title, items, emptyText, line) {
    return `
      <section class="panel ev-list">
        <div class="panel-head"><div><h2>${title}</h2><span class="count">${num(items.length)}</span></div></div>
        ${items.length
          ? `<ol>${items.map((x, k) => `<li>${line(x, k)}</li>`).join('')}</ol>`
          : `<p class="ev-none">${emptyText}</p>`}
      </section>`;
  }

  function listsHtml(d) {
    return `
      <div class="ev-lists">
        ${listPanel('اعتذروا', d.declined, 'لم يعتذر أحد.',
          (x) => who(x.name, esc(x.reason_text || x.reason_code || 'بلا سبب')))}
        ${listPanel('لم يردّوا', d.no_reply, 'ردّ الجميع.', (x) => who(x.name, ''))}
        ${listPanel('قائمة الانتظار', d.waitlist, 'لا أحد ينتظر.',
          (x, k) => who(x.name, `#${num(k + 1)} · ${asWhen(x.joined_at)}`))}
      </div>`;
  }

  function paceHtml(d) {
    const p = C().pace(d, Date.now());
    return p ? `<p class="ev-pace ${p.kind === 'filled' ? 'on' : ''}">${esc(p.text)}</p>` : '';
  }

  /* --------------------------------------------------------- حالات */

  function render() {
    $('eventView').innerHTML = headHtml(details.event) + cardsHtml(C().summary(details))
      + paceHtml(details) + membersHtml() + listsHtml(details);
  }

  function renderLoading() {
    $('eventView').innerHTML = `
      <div class="ev-top">${backBtn()}</div>
      <header class="panel ev-head loading"><span class="skel" style="width:240px;height:22px"></span></header>
      <section class="stat-grid ev-cards">${'<div class="stat-card loading"><div class="k">&nbsp;</div><div class="v">0</div></div>'.repeat(4)}</section>
      <section class="panel loading"><span class="skel" style="width:60%"></span></section>`;
  }

  function renderMessage(title, text, retry) {
    $('eventView').innerHTML = `
      <div class="ev-top">${backBtn()}</div>
      <section class="panel"><div class="empty"><b>${title}</b>${text}
        ${retry ? '<p><button type="button" class="btn-quiet" data-act="retry">إعادة المحاولة</button></p>' : ''}
      </div></section>`;
  }

  async function load(id) {
    const my = ++seq;
    details = null;
    filter = 'all';
    renderLoading();
    try {
      const d = await TamrinData.eventDetails(id);
      if (my !== seq) return;
      if (!d) { renderMessage('الفعالية غير موجودة', 'ربما حُذفت أو أن الرابط غير صحيح.', false); return; }
      details = d;
      render();
    } catch (e) {
      if (my !== seq) return;
      renderMessage('تعذّر جلب الفعالية', 'تحقّق من الاتصال وحاول مجددًا.', true);
    }
  }

  /* --------------------------------------------------------- واجهة */

  function openRow(tr) {
    if (tr && tr.dataset.user) opts.onOpenPlayer(tr.dataset.user);
  }

  function init(o) {
    opts = Object.assign(opts, o || {});
    const view = $('eventView');

    view.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'back') { opts.onBack(); return; }
      if (act && act.dataset.act === 'retry') { load(currentId); return; }

      const chip = e.target.closest('[data-filter]');
      if (chip && details) {
        filter = chip.dataset.filter;
        $('evChips').innerHTML = chipsHtml();
        $('evMembers').innerHTML = membersBodyHtml();
        return;
      }
      openRow(e.target.closest('tr.row-link'));
    });

    view.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tr = e.target.closest('tr.row-link');
      if (!tr) return;
      e.preventDefault();
      openRow(tr);
    });
  }

  function open(id) {
    currentId = id;
    $('eventView').hidden = false;
    window.scrollTo(0, 0);
    load(id);
  }

  function close() {
    seq++;
    currentId = null;
    details = null;
    $('eventView').hidden = true;
    $('eventView').innerHTML = '';
  }

  global.TamrinEvent = { init, open, close };
})(window);
```

- [ ] **Step 3: Write `assets/admin-event.css`**

```css
/* تمرين — صفحة الفعالية. تعيد استخدام بطاقات ولوحات admin.css. */

.ev-top { margin-block-end: 14px; }
.ev-back { display: inline-flex; align-items: center; gap: 6px; }
.ev-back svg { width: 16px; height: 16px; }

.ev-head { padding: 22px; margin-block-end: 18px; }
.ev-head h1 { font-size: 23px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-block-end: 14px; }
.ev-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px 20px; margin: 0; }
.ev-meta dt { font-size: 13px; color: var(--text-3); font-weight: 700; margin-block-end: 3px; }
.ev-meta dd { margin: 0; font-size: 15px; }

.ev-cards .stat-card .v small { font-size: .55em; color: var(--text-3); font-weight: 500; }
.ev-cards .meter { margin-block-start: 8px; }
.ev-cards .meter .bar { flex: 1; }

.ev-pace { margin-block: 4px 18px; font-size: 14px; color: var(--text-2); }
.ev-pace.on { color: #2f7a48; font-weight: 700; }

.ev-members { margin-block-end: 18px; }
.ev-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ev-chips button {
  border: 1px solid var(--line-strong); background: var(--card); color: var(--text-2);
  border-radius: var(--r-pill); padding: 5px 12px; font: inherit; font-size: 14px; cursor: pointer;
}
.ev-chips button span { color: var(--text-3); font-variant-numeric: tabular-nums; }
.ev-chips button[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: #fff; }
.ev-chips button[aria-pressed="true"] span { color: rgba(255, 255, 255, .7); }

.ev-sub { display: flex; flex-wrap: wrap; gap: 6px; font-size: 13px; color: var(--text-3); margin-block-start: 2px; }
.ev-raw { font-size: 12px; color: var(--text-3); }

tr.row-link { cursor: pointer; }
tr.row-link:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }

.ev-lists { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.ev-list ol { list-style: none; margin: 0; padding: 4px 18px 16px; display: grid; gap: 12px; }
.ev-none { padding: 4px 18px 18px; margin: 0; color: var(--text-3); font-size: 14px; }

@media (max-width: 960px) {
  .ev-lists { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .ev-head { padding: 18px 16px; }
  .ev-head h1 { font-size: 20px; }
  .ev-members .panel-head { flex-direction: column; align-items: flex-start; gap: 10px; }
}
```

- [ ] **Step 4: Smoke-check the module in isolation (mock on)**

Set `const USE_MOCK = true;` temporarily, then:

```
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/admin.html" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "await TamrinData.signIn('a@b.c','x'); location.reload(); 'ok'" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "TamrinEvent.init({}); TamrinEvent.open('e-001'); await new Promise(r => setTimeout(r, 500)); ({ h1: document.querySelector('#eventView h1')?.textContent.trim(), rows: document.querySelectorAll('#evMembers tr').length, chips: document.querySelectorAll('#evChips button').length })" }
mcp__Claude_Browser__read_console_messages { "onlyErrors": true }
```

Expected: `h1` non-empty, `rows` ≥ 3, `chips` = 5, no console errors. Keep `USE_MOCK = true` for Task 5.

- [ ] **Step 5: Commit (with `USE_MOCK` reverted)**

```bash
git diff assets/admin-data.js | grep -n 'USE_MOCK *='
```

Expected: no output (revert first if it shows). Then:

```bash
git add admin.html assets/admin-event.js assets/admin-event.css
git commit -m "Add the event details view with member list and insight cards"
```

---

### Task 5: Clickable rows, hash router, and wiring in `admin.js`

**Files:**
- Modify: `assets/admin.js` — `eventRow()` `<tr>`, a new events-body listener after `loadEvents()`, `selectTab()`, the boot section (`TamrinPlayer.init()` area and `showDash`).

**Interfaces:**
- Consumes: `TamrinEvent.init/open/close` (Task 4), `TamrinPlayer.open(userId)` (existing).
- Produces: route `#event/<id>`; no new globals.

- [ ] **Step 1: Make event rows clickable**

In `eventRow(ev)`, replace the opening `<tr>` of the returned template with:

```js
      <tr class="row-link" tabindex="0" data-event="${esc(ev.id)}">
```

- [ ] **Step 2: Add row listeners right after the `loadEvents()` function**

```js
  // يُعلَّم عند الدخول من الجدول حتى يعود «رجوع» بالمتصفّح بدل مسح العنوان
  let cameFromDash = false;

  function openEventRow(tr) {
    if (!tr || !tr.dataset.event) return;
    cameFromDash = true;
    location.hash = `event/${encodeURIComponent(tr.dataset.event)}`;
  }

  $('eventsBody').addEventListener('click', (e) => openEventRow(e.target.closest('tr.row-link')));
  $('eventsBody').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr.row-link');
    if (!tr) return;
    e.preventDefault();
    openEventRow(tr);
  });
```

- [ ] **Step 3: Remember the selected tab**

Replace `selectTab` with:

```js
  let lastTab = 'users';

  function selectTab(which) {
    lastTab = which;
    const users = which === 'users';
    $('tabUsers').setAttribute('aria-selected', String(users));
    $('tabEvents').setAttribute('aria-selected', String(!users));
    $('panelUsers').hidden = !users;
    $('panelEvents').hidden = users;
  }
```

- [ ] **Step 4: Add the router right after the `$('tabEvents').addEventListener(...)` line**

```js
  /* ------------------------------------------------------- الموجّه */

  function route() {
    const m = /^#event\/(.+)$/.exec(location.hash);
    const onEvent = !!m;
    $('stats').hidden = onEvent;
    $('segTabs').hidden = onEvent;
    if (onEvent) {
      lastTab = 'events';            // «رجوع» يعيد إلى جدول الفعاليات
      $('panelUsers').hidden = true;
      $('panelEvents').hidden = true;
      TamrinEvent.open(decodeURIComponent(m[1]));
    } else {
      TamrinEvent.close();
      selectTab(lastTab);
    }
  }

  function backToDash() {
    if (cameFromDash) {
      cameFromDash = false;
      history.back();
      return;
    }
    history.pushState(null, '', location.pathname + location.search);
    route();
  }

  window.addEventListener('hashchange', () => { if (!dash.hidden) route(); });
```

- [ ] **Step 5: Wire `TamrinEvent` at boot and route on sign-in**

After `TamrinPlayer.init();` add:

```js
  TamrinEvent.init({
    onBack: backToDash,
    onOpenPlayer: (userId) => TamrinPlayer.open(userId)
  });
```

In `showDash(session)`, after `loadAll();` add:

```js
    route();
```

`showDash` is a function declaration called only after the whole IIFE has run (sign-in submit or the last line), so `route` is defined by then.

- [ ] **Step 6: Verify in the browser (mock on, desktop)**

With `USE_MOCK = true`:

```
mcp__Claude_Browser__navigate       { "url": "http://localhost:4173/admin.html" }
mcp__Claude_Browser__find           { "query": "الفعاليات النشطة" }
```

Click the Events tab, then click the first event row (by `ref` from `find`/`read_page`). Then:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "await new Promise(r => setTimeout(r, 500)); ({ hash: location.hash, view: !document.getElementById('eventView').hidden, statsHidden: document.getElementById('stats').hidden, members: document.querySelectorAll('#evMembers tr').length })" }
```

Expected: `hash` starts with `#event/e-`, `view: true`, `statsHidden: true`, `members` ≥ 3.

Then check each of these and record the result:
1. Click the «معفى» chip → only rows with the «معفى» tag remain; its count matches the chip number.
2. Click a real member row → the player sheet opens; close it with Esc → still on the event page.
3. Click «رجوع» → dashboard shows with the Events tab selected; `location.hash === ''`.
4. Browser `navigate` `"back"` then `"forward"` → event page reopens.
5. Reload on `#event/e-001` → event page renders directly after the session restores.
6. `navigate` to `http://localhost:4173/admin.html#event/nope` → «الفعالية غير موجودة»; «رجوع» returns to the dashboard.
7. Row keyboard: focus an events row, press Enter → event page opens.
8. `read_console_messages { "onlyErrors": true }` → empty.

- [ ] **Step 7: Mobile check**

```
mcp__Claude_Browser__resize_window { "preset": "mobile" }
mcp__Claude_Browser__navigate      { "url": "http://localhost:4173/admin.html#event/e-001" }
mcp__Claude_Browser__computer      { "action": "screenshot" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "document.documentElement.scrollWidth <= window.innerWidth" }
mcp__Claude_Browser__resize_window { "preset": "desktop" }
```

Expected: cards stack, the lists become one column, chips wrap, `true` (no horizontal page scroll).

- [ ] **Step 8: Revert mock and commit**

```bash
git diff assets/admin-data.js | grep -n 'USE_MOCK *='
```

Expected: no output. Then:

```bash
git add assets/admin.js
git commit -m "Open an event's details page from the active-events table"
```

---

### Task 6: Update the spec to match what was built

**Files:**
- Modify: `docs/superpowers/specs/2026-09-26-event-details-page-design.md`

- [ ] **Step 1: Apply these edits**

- §4 "Delivery": replace "added to `supabase/admin-dashboard.sql` in this repo" with "a new file `supabase/admin-event-details.sql` in this repo".
- §4: add a bullet: "`is_guest` = `user_id is null and not added_manually`; `added_by_name` is the member who brought the guest, or the organiser for manually added rows."
- §5 Member list: replace «أضافه <name>» for manually added with "«ضيف · مع <name>» for guests and «أضافه <name>» for manually added rows".
- §6: add `assets/admin-event.css` and note the export `TamrinEventCalc.pace` returns `{ kind, text }`.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-09-26-event-details-page-design.md
git commit -m "Align the event page spec with the implementation"
```

---

### Task 7: Real-data check after the SQL is applied

Runs only after the human confirms Task 1 Step 4.

- [ ] **Step 1: Human opens the live dashboard**, clicks an active event, and compares the member count, paid count and waitlist count with that event's row in the table. They must match (the row reads `participant_count`, `paid_count`, `waitlist_count` from the same tables).
- [ ] **Step 2: If any number differs**, ask the human to run and paste:

```sql
select public.admin_event_details('<event id>'::uuid);
```

and debug from the JSON with superpowers:systematic-debugging before changing code.
