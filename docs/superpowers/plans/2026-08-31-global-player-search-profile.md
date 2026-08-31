# Global Player Search + Profile Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin find any user from anywhere in the dashboard and open a profile sheet that shows the player's per-group ratings, every rater with their exact scores, and a per-rating delete action.

**Architecture:** Extends the existing three-layer split — markup in `admin.html`, UI logic in `assets/admin*.js`, and `assets/admin-data.js` as the sole server touchpoint. Two new self-contained UI modules (palette, sheet) plus one pure no-DOM logic module. All rating maths stays on the server: the new `admin_get_player_profile` RPC calls the app's own `player_rating_overall`, so the dashboard cannot drift from the app.

**Tech Stack:** Vanilla ES5-compatible JS in IIFEs exposing single globals, plain CSS using `site.css` tokens, Supabase Postgres security-definer RPCs over PostgREST. No build step, no npm, no framework.

**Spec:** [`docs/superpowers/specs/2026-08-31-global-user-search-player-profile-design.md`](../specs/2026-08-31-global-user-search-player-profile-design.md)

## Global Constraints

- **No test framework exists in this repo** (no `package.json`, no build step) and the spec (§9) deliberately does not add one. TDD is therefore split: Task 1 adds a dependency-free browser assertion runner for the pure logic and every later pure-logic change goes through it red-green; DOM-bound tasks verify with `mcp__Claude_Browser__*` tool calls that have exact expected output. **Do not add npm, a bundler, or a test library.**
- **Language:** every user-facing string is Arabic. Page is `<html lang="ar" dir="rtl">`.
- **Comments in new SQL and JS files are Arabic**, matching `assets/admin-data.js` and `supabase/admin-dashboard.sql`. Comments explain *why*, not *what*.
- **CSS:** use only tokens already defined in `assets/site.css` (`--card`, `--page`, `--secondary`, `--line`, `--line-strong`, `--text`, `--text-2`, `--text-3`, `--green`, `--lime`, `--peach`, `--ink`, `--r-card`, `--r-pill`, `--r-bar`, `--shadow-card`, `--shadow-lift`, `--ease`). **Define no new tokens.** Use logical properties (`inset-inline-*`, `padding-inline`, `margin-block-*`, `border-block-end`) as the rest of the codebase does.
- **Reuse existing component classes** rather than new ones: `.who`, `.avatar`, `.avatar.sm`, `.tag`, `.tag-flat`, `.tag-green`, `.tag-lime`, `.tag-peach`, `.meter` + `.bar` + `i` + `.txt`, `.skel`, `.empty`, `.btn-quiet`, `.pay`, `.field`.
- **Escaping:** every value that originates from the database passes through `esc()` before being placed in `innerHTML`. Names are user-supplied.
- **Numbers:** format with the existing `ar-SA-u-nu-latn` `Intl` formatters (Latin digits), not raw interpolation.
- **Cache busting is mandatory.** `netlify.toml` serves `/assets/*` as `max-age=31536000, immutable`. Any touched asset must have its `?v=` bumped in `admin.html`: `admin.css`, `admin-data.js`, `admin.js` go `v4 → v5`; new files enter at `v1`.
- **Rating attribute order is fixed everywhere:** pace, shooting, passing, defending, stamina, awareness → السرعة, التسديد, التمرير, الدفاع, التحمّل, الوعي.
- **SQL:** every new function is `security definer`, `set search_path = public, pg_temp`, gated by `is_current_user_admin()` raising `42501`, and followed by `revoke execute … from public, anon` + `grant execute … to authenticated`. Wrap the file in `begin; … commit;`.
- **Call `player_rating_overall` with named-argument notation** (`p_position => …`). Its positional order is not knowable from the generated types, and getting it wrong silently produces plausible-but-wrong numbers.
- **Never reimplement the overall formula** in SQL or JS.
- The rating scale ships in the server payload as `scale: {min, max}`. **No maximum may be hardcoded in JS or CSS.**

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `assets/admin-ratings.js` | create | Pure, no-DOM rating logic: attribute table, bar percentages, sorting, aggregate helpers. Testable standalone. |
| `tests/admin-ratings.test.html` | create | Dependency-free assertion runner for the above. Opens in a browser, exposes `window.__results`. |
| `supabase/admin-player-ratings.sql` | create | `admin_audit_log`, `admin_get_player_profile`, `admin_delete_player_rating`. Additive — existing SQL file untouched. |
| `assets/admin-data.js` | modify | Adds `playerProfile()` and `deleteRating()` to the `TamrinData` contract, plus mock rating fixtures. |
| `assets/admin-sheet.css` | create | Palette + sheet styling and the 720px responsive switch. |
| `assets/admin-search.js` | create | `TamrinSearch` — palette overlay, debounce, keyboard nav. Knows nothing about ratings. |
| `assets/admin-player.js` | create | `TamrinPlayer` — profile sheet, rating rendering, delete flow. Knows nothing about search. |
| `admin.html` | modify | Palette trigger in `.admin-top`, sheet/palette host elements, script + style tags, version bumps. |
| `assets/admin.js` | modify | Wires trigger + keyboard shortcut, hands `TamrinSearch` a callback that opens `TamrinPlayer`. The only file that knows both modules exist. |

**Deviation from spec §5, stated deliberately:** the spec lists six files; this plan adds two — `assets/admin-ratings.js` and `tests/admin-ratings.test.html`. Reason: the spec's verification section rules out a test framework, which would leave the whole feature verified only by eye. Splitting the pure display maths into a no-DOM module makes that part genuinely red-green testable with zero new tooling, and it keeps `admin-player.js` focused on the DOM. Nothing else about the spec changes.

---

## Task 1: Pure rating logic + test runner

**Files:**
- Create: `assets/admin-ratings.js`
- Create: `tests/admin-ratings.test.html`

**Interfaces:**
- Consumes: nothing.
- Produces: global `TamrinRatings` with:
  - `ATTRS` → `Array<{key: string, label: string}>`, length 6, fixed order
  - `barPercent(value, scale)` → `number` 0–100, or `null` when unusable
  - `attributeRows(rating, scale)` → `Array<{key, label, value, percent}>`, length 6
  - `hasAnyRatings(profile)` → `boolean`
  - `totalRaterCount(profile)` → `number`
  - `sortGroups(groups)` → new sorted array (most raters first, then name)
  - `sortRaters(raters)` → new sorted array (`is_me` first, then newest `updated_at`, then name)

- [ ] **Step 1: Write the failing test runner**

Create `tests/admin-ratings.test.html`:

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>اختبارات منطق التقييم</title>
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
  <h1>اختبارات منطق التقييم — TamrinRatings</h1>
  <div id="summary">جارٍ التنفيذ…</div>
  <ol id="out"></ol>

  <script src="../assets/admin-ratings.js"></script>
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

    const R = window.TamrinRatings;
    const SCALE = { min: 1, max: 99 };

    test('ATTRS has the six attributes in fixed order', function () {
      eq(R.ATTRS.map(function (a) { return a.key; }),
         ['pace', 'shooting', 'passing', 'defending', 'stamina', 'awareness']);
    });

    test('ATTRS carries the Arabic labels', function () {
      eq(R.ATTRS.map(function (a) { return a.label; }),
         ['السرعة', 'التسديد', 'التمرير', 'الدفاع', 'التحمّل', 'الوعي']);
    });

    test('barPercent maps min to 0 and max to 100', function () {
      eq(R.barPercent(1, SCALE), 0, 'min');
      eq(R.barPercent(99, SCALE), 100, 'max');
    });

    test('barPercent maps the midpoint to 50', function () {
      eq(R.barPercent(50, SCALE), 50);
    });

    test('barPercent clamps out-of-range values', function () {
      eq(R.barPercent(-20, SCALE), 0, 'below min');
      eq(R.barPercent(500, SCALE), 100, 'above max');
    });

    test('barPercent returns null for an unusable scale', function () {
      eq(R.barPercent(50, null), null, 'null scale');
      eq(R.barPercent(50, { min: 1, max: 1 }), null, 'zero span');
      eq(R.barPercent(50, { min: 1, max: 0 }), null, 'inverted');
      eq(R.barPercent(50, { min: 1, max: 'x' }), null, 'non-numeric max');
    });

    test('barPercent returns null for a missing value', function () {
      eq(R.barPercent(null, SCALE), null, 'null');
      eq(R.barPercent(undefined, SCALE), null, 'undefined');
    });

    test('attributeRows returns six rows with values and percentages', function () {
      const rows = R.attributeRows(
        { pace: 99, shooting: 1, passing: 50, defending: 50, stamina: 50, awareness: 50 },
        SCALE);
      eq(rows.length, 6, 'length');
      eq(rows[0], { key: 'pace', label: 'السرعة', value: 99, percent: 100 }, 'first row');
      eq(rows[1].percent, 0, 'second percent');
    });

    test('attributeRows survives a null rating', function () {
      const rows = R.attributeRows(null, SCALE);
      eq(rows.length, 6, 'length');
      eq(rows[0].value, null, 'value');
      eq(rows[0].percent, null, 'percent');
    });

    test('hasAnyRatings is false when every group is empty', function () {
      eq(R.hasAnyRatings({ groups: [] }), false, 'no groups');
      eq(R.hasAnyRatings({ groups: [{ rater_count: 0, raters: [] }] }), false, 'zero count');
      eq(R.hasAnyRatings(null), false, 'null profile');
    });

    test('hasAnyRatings is true when a group has raters', function () {
      eq(R.hasAnyRatings({ groups: [{ rater_count: 2, raters: [{}, {}] }] }), true);
    });

    test('totalRaterCount sums across groups', function () {
      eq(R.totalRaterCount({ groups: [{ rater_count: 2 }, { rater_count: 3 }] }), 5);
      eq(R.totalRaterCount({ groups: [] }), 0, 'empty');
      eq(R.totalRaterCount(null), 0, 'null');
    });

    test('sortGroups puts the most-rated group first', function () {
      const sorted = R.sortGroups([
        { name: 'ب', rater_count: 1 },
        { name: 'أ', rater_count: 4 }
      ]);
      eq(sorted.map(function (g) { return g.name; }), ['أ', 'ب']);
    });

    test('sortGroups breaks ties by name and does not mutate the input', function () {
      const input = [{ name: 'ب', rater_count: 2 }, { name: 'أ', rater_count: 2 }];
      const sorted = R.sortGroups(input);
      eq(sorted.map(function (g) { return g.name; }), ['أ', 'ب'], 'sorted');
      eq(input.map(function (g) { return g.name; }), ['ب', 'أ'], 'input untouched');
    });

    test('sortRaters puts me first, then newest', function () {
      const sorted = R.sortRaters([
        { name: 'ب', is_me: false, updated_at: '2026-01-01T00:00:00Z' },
        { name: 'ج', is_me: false, updated_at: '2026-06-01T00:00:00Z' },
        { name: 'أ', is_me: true,  updated_at: '2025-01-01T00:00:00Z' }
      ]);
      eq(sorted.map(function (r) { return r.name; }), ['أ', 'ج', 'ب']);
    });

    test('sortRaters tolerates a missing updated_at', function () {
      const sorted = R.sortRaters([
        { name: 'ب', is_me: false },
        { name: 'أ', is_me: false, updated_at: '2026-06-01T00:00:00Z' }
      ]);
      eq(sorted.map(function (r) { return r.name; }), ['أ', 'ب']);
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

- [ ] **Step 2: Run it to make sure it fails**

Start the preview server if it is not already running:

```
mcp__Claude_Browser__preview_start  { "name": "tamrin-site" }
```

Then:

```
mcp__Claude_Browser__navigate    { "url": "http://localhost:4173/tests/admin-ratings.test.html" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "window.__results" }
```

Expected: `null` or `undefined` — the runner throws on `window.TamrinRatings` being undefined, so `__results` is never assigned. Confirm the failure is *this* one:

```
mcp__Claude_Browser__read_console_messages { "onlyErrors": true }
```

Expected: a `TypeError` naming `TamrinRatings` (cannot read properties of undefined). If you see a 404 for `admin-ratings.js` instead, that is also the expected pre-implementation state.

- [ ] **Step 3: Write the minimal implementation**

Create `assets/admin-ratings.js`:

```js
/* =========================================================================
   تمرين — منطق التقييم الخالص
   ---------------------------------------------------------------------
   لا يلمس هذا الملف DOM ولا الشبكة. سببه أنّ حسابات العرض (النسب،
   الترتيب، حالات الفراغ) قابلة للاختبار وحدها في tests/admin-ratings.test.html
   بلا متصفّح كامل ولا أدوات بناء.

   ما ليس هنا بقصد: صيغة التقييم العام. تحسبها دالة player_rating_overall
   على الخادم وتأتي جاهزة في الحمولة — إعادة كتابتها هنا تعني رقمين
   مختلفين للاعب واحد.
   ========================================================================= */

(function (global) {
  'use strict';

  /* الترتيب ثابت في كل مكان: الحمولة، الأشرطة، صفوف المقيّمين. */
  const ATTRS = [
    { key: 'pace',      label: 'السرعة' },
    { key: 'shooting',  label: 'التسديد' },
    { key: 'passing',   label: 'التمرير' },
    { key: 'defending', label: 'الدفاع' },
    { key: 'stamina',   label: 'التحمّل' },
    { key: 'awareness', label: 'الوعي' }
  ];

  /**
   * نسبة الشريط من قيمة التقييم. المقياس يأتي من الخادم لا من الواجهة،
   * فقد يكون ناقصًا أو غير صالح — نُعيد null ليعرض النداء الرقم بلا شريط
   * بدل تخمين مقام.
   */
  function barPercent(value, scale) {
    if (!scale) return null;
    const max = Number(scale.max);
    const min = Number(scale.min);
    if (!isFinite(max) || !isFinite(min) || max <= min) return null;
    const v = Number(value);
    if (value === null || value === undefined || !isFinite(v)) return null;
    const pct = ((v - min) / (max - min)) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  /** صفوف الصفات الستّ لتقييم واحد، جاهزة للعرض. */
  function attributeRows(rating, scale) {
    return ATTRS.map(function (a) {
      const value = rating && rating[a.key] !== undefined ? rating[a.key] : null;
      return {
        key: a.key,
        label: a.label,
        value: value === undefined ? null : value,
        percent: barPercent(value, scale)
      };
    });
  }

  function groups(profile) {
    return profile && Array.isArray(profile.groups) ? profile.groups : [];
  }

  function countOf(g) {
    if (g && typeof g.rater_count === 'number') return g.rater_count;
    return g && Array.isArray(g.raters) ? g.raters.length : 0;
  }

  function hasAnyRatings(profile) {
    return groups(profile).some(function (g) { return countOf(g) > 0; });
  }

  function totalRaterCount(profile) {
    return groups(profile).reduce(function (s, g) { return s + countOf(g); }, 0);
  }

  /** الأكثر تقييمًا أولًا — أغنى مجموعة تستحق أعلى الورقة. slice: لا نُعدّل المُدخل. */
  function sortGroups(list) {
    return (list || []).slice().sort(function (a, b) {
      const d = countOf(b) - countOf(a);
      if (d !== 0) return d;
      return String(a && a.name || '').localeCompare(String(b && b.name || ''), 'ar');
    });
  }

  /** تقييمي أولًا، ثم الأحدث تعديلًا، ثم الاسم. */
  function sortRaters(list) {
    return (list || []).slice().sort(function (a, b) {
      const mine = (b && b.is_me ? 1 : 0) - (a && a.is_me ? 1 : 0);
      if (mine !== 0) return mine;
      const at = String(a && a.updated_at || '');
      const bt = String(b && b.updated_at || '');
      if (at !== bt) return bt.localeCompare(at);
      return String(a && a.name || '').localeCompare(String(b && b.name || ''), 'ar');
    });
  }

  global.TamrinRatings = {
    ATTRS: ATTRS,
    barPercent: barPercent,
    attributeRows: attributeRows,
    hasAnyRatings: hasAnyRatings,
    totalRaterCount: totalRaterCount,
    sortGroups: sortGroups,
    sortRaters: sortRaters
  };
})(window);
```

- [ ] **Step 4: Run the tests and make sure they pass**

```
mcp__Claude_Browser__navigate    { "url": "http://localhost:4173/tests/admin-ratings.test.html" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text": "window.__results" }
```

Expected exactly: `{"passed": 16, "failed": 0, "failures": []}`

If `failed > 0`, read `failures` — each entry names the test and the expected-vs-got values. Fix `admin-ratings.js`, never the assertion, unless the assertion itself encodes a wrong expectation.

- [ ] **Step 5: Commit**

```bash
git add assets/admin-ratings.js tests/admin-ratings.test.html
git commit -m "Add pure rating-display logic with a dependency-free test runner"
```

---

## Task 2: Server — audit table and the two RPCs

**Files:**
- Create: `supabase/admin-player-ratings.sql`

**Interfaces:**
- Consumes: existing `public.is_current_user_admin()` from `supabase/admin-dashboard.sql`; existing app function `public.player_rating_overall`.
- Produces:
  - `public.admin_get_player_profile(p_user_id uuid) → json` — payload shape in Step 2 below
  - `public.admin_delete_player_rating(p_rater_id uuid, p_ratee_id uuid, p_workspace_id uuid) → json` returning `{"deleted": 1}`
  - `public.admin_audit_log` table

**Why this task cannot be run from the repo:** there are no database credentials in this environment. The deliverable is a reviewed, deployable file; the human runs it in the Supabase SQL editor and pastes back the verification output. Tasks 3–7 do not depend on it — they run against mock data.

- [ ] **Step 1: Write the SQL file**

Create `supabase/admin-player-ratings.sql`:

```sql
-- =====================================================================
-- تمرين — لوحة التحكم: ملفّ اللاعب وتقييماته
-- ---------------------------------------------------------------------
-- يُنفَّذ مرة واحدة على مشروع الإنتاج timrin-prod (hzsxwnmbdkrmipjtfzlp)
-- من محرّر SQL في لوحة Supabase. إضافي بالكامل: لا يعدّل جدولًا قائمًا
-- ولا سياسة RLS ولا أي دالة يستدعيها التطبيق.
--
-- لماذا دالة admin_ جديدة بدل إعادة استخدام get_player_rating؟
--   دالة التطبيق محصورة بعضوية المجموعة: تتحقّق أنّ المستدعي عضو في
--   workspace_id. المشرف ليس عضوًا في مجموعات المستخدمين، فستردّه.
--
-- لماذا يُحسب التقييم العام بنداء player_rating_overall لا بصيغة هنا؟
--   الصيغة موزونة بمركز اللاعب وقد تتغيّر في التطبيق. نسخها هنا يعني
--   رقمين مختلفين للاعب واحد: أحدهما في التطبيق والآخر في اللوحة.
-- =====================================================================

begin;

-- --------------------------------------------------- 1) سجلّ الإجراءات ---
-- حذف التقييم لا رجعة فيه: الجدول لا يحتفظ بنسخة، والتطبيق يعيد حساب
-- تقييم اللاعب فورًا. نُصوّر الصفّ المحذوف هنا حتى يبقى الخطأ قابلًا
-- للإصلاح يدويًا.
create table if not exists public.admin_audit_log (
  id             bigserial primary key,
  actor_id       uuid        not null,
  action         text        not null,
  target_user_id uuid,
  payload        jsonb,
  created_at     timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

-- بلا سياسات عن قصد — نفس نمط admin_users: مع تفعيل RLS وغياب السياسات
-- يصبح الجدول غير مرئي عبر PostgREST. الدوال security definer تتجاوز RLS.
revoke all on public.admin_audit_log from anon, authenticated;
revoke all on sequence public.admin_audit_log_id_seq from anon, authenticated;

-- ------------------------------------------------------ 2) ملفّ اللاعب ---
create or replace function public.admin_get_player_profile(p_user_id uuid)
returns json
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  -- حدود التقييم. ثابتة عن قصد: قيد التحقّق على player_ratings غير مقروء
  -- من الواجهة، فتُثبَّت هنا وتُرسل في الحمولة كي لا تُثبّتها الواجهة.
  -- تحقّق منها بالاستعلام في نهاية هذا الملف وصحّحها إن اختلفت.
  v_scale_min constant integer := 1;
  v_scale_max constant integer := 99;

  v_position text;
  v_user     json;
  v_groups   json;
  v_mine     json;
  v_activity json;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- المركز يأتي من صفّ اللاعب لا من صفّ التقييم: الصيغة موزونة بالمركز
  -- والمركز غير مُصوَّر على صفّ التقييم، فتغييره يعيد حساب كل التقييمات.
  select u.postion into v_position
  from public.users u
  where u.user_id = p_user_id and u.deleted_at is null;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  select json_build_object(
    'user_id',        u.user_id,
    'name',           coalesce(nullif(btrim(u.name), ''), '—'),
    'postion',        u.postion,
    'avatar_url',     u.avatar_url,
    'stc_pay_number', u.stc_pay_number,
    'created_at',     u.created_at
  ) into v_user
  from public.users u
  where u.user_id = p_user_id;

  -- التقييمات بحسب المجموعة. تسمية الوسائط بالاسم مقصودة: ترتيب وسائط
  -- player_rating_overall غير مضمون من التوقيع، والخطأ فيه يُنتج رقمًا
  -- معقولًا لكنه غلط.
  with r as (
    select
      pr.rater_id, pr.workspace_id, pr.created_at, pr.updated_at,
      pr.pace, pr.shooting, pr.passing, pr.defending, pr.stamina, pr.awareness,
      public.player_rating_overall(
        p_position  => v_position,
        p_pace      => pr.pace,
        p_shooting  => pr.shooting,
        p_passing   => pr.passing,
        p_defending => pr.defending,
        p_stamina   => pr.stamina,
        p_awareness => pr.awareness
      ) as overall
    from public.player_ratings pr
    where pr.ratee_id = p_user_id
  ),
  agg as (
    select
      r.workspace_id,
      count(*)            as rater_count,
      avg(r.pace)         as a_pace,
      avg(r.shooting)     as a_shooting,
      avg(r.passing)      as a_passing,
      avg(r.defending)    as a_defending,
      avg(r.stamina)      as a_stamina,
      avg(r.awareness)    as a_awareness,
      -- left join مقصود: rater_id بلا مفتاح أجنبي على users، فالمقيّم قد
      -- لا يملك صفًّا. نُبقي تقييمه في المتوسّط — الصفّ موجود والتطبيق
      -- يحسبه، وإسقاطه هنا يجعل اللوحة تخالف التطبيق.
      json_agg(json_build_object(
        'rater_id',   r.rater_id,
        'name',       coalesce(nullif(btrim(ru.name), ''), 'مستخدم محذوف'),
        'avatar_url', ru.avatar_url,
        'is_me',      (r.rater_id = auth.uid()),
        'overall',    r.overall,
        'pace',       r.pace,
        'shooting',   r.shooting,
        'passing',    r.passing,
        'defending',  r.defending,
        'stamina',    r.stamina,
        'awareness',  r.awareness,
        'created_at', r.created_at,
        'updated_at', r.updated_at
      ) order by (r.rater_id = auth.uid()) desc, r.updated_at desc) as raters
    from r
    left join public.users ru on ru.user_id = r.rater_id
    group by r.workspace_id
  )
  select coalesce(json_agg(json_build_object(
    'workspace_id', a.workspace_id,
    'name',         coalesce(nullif(btrim(w.name), ''), '—'),
    'rater_count',  a.rater_count,
    -- التقريب إلى صحيح قبل النداء مقصود ولازم: avg تُرجع numeric، وإن كانت
    -- وسائط player_rating_overall من نوع integer فلا يوجد تحويل ضمني من
    -- numeric إليه — يفشل النداء بـ «function does not exist». التحويل إلى
    -- integer سليم في الحالتين: integer→numeric ضمني لو كانت الوسائط numeric.
    'overall',      public.player_rating_overall(
                      p_position  => v_position,
                      p_pace      => round(a.a_pace)::integer,
                      p_shooting  => round(a.a_shooting)::integer,
                      p_passing   => round(a.a_passing)::integer,
                      p_defending => round(a.a_defending)::integer,
                      p_stamina   => round(a.a_stamina)::integer,
                      p_awareness => round(a.a_awareness)::integer
                    ),
    'averages',     json_build_object(
                      'pace',      round(a.a_pace, 1),
                      'shooting',  round(a.a_shooting, 1),
                      'passing',   round(a.a_passing, 1),
                      'defending', round(a.a_defending, 1),
                      'stamina',   round(a.a_stamina, 1),
                      'awareness', round(a.a_awareness, 1)
                    ),
    'raters',       a.raters
  ) order by a.rater_count desc, w.name), '[]'::json) into v_groups
  from agg a
  join public.workspaces w on w.id = a.workspace_id;

  -- تقييمي. مصفوفة لا كائن: التقييم محصور بمجموعة، وقد أُقيّم اللاعب
  -- نفسه في أكثر من مجموعة.
  select coalesce(json_agg(json_build_object(
    'workspace_id',   pr.workspace_id,
    'workspace_name', coalesce(nullif(btrim(w.name), ''), '—'),
    'pace',           pr.pace,
    'shooting',       pr.shooting,
    'passing',        pr.passing,
    'defending',      pr.defending,
    'stamina',        pr.stamina,
    'awareness',      pr.awareness,
    'overall',        public.player_rating_overall(
                        p_position  => v_position,
                        p_pace      => pr.pace,
                        p_shooting  => pr.shooting,
                        p_passing   => pr.passing,
                        p_defending => pr.defending,
                        p_stamina   => pr.stamina,
                        p_awareness => pr.awareness
                      ),
    'created_at',     pr.created_at,
    'updated_at',     pr.updated_at
  ) order by pr.updated_at desc), '[]'::json) into v_mine
  from public.player_ratings pr
  join public.workspaces w on w.id = pr.workspace_id
  where pr.ratee_id = p_user_id and pr.rater_id = auth.uid();

  select json_build_object(
    'workspace_count', (select count(*) from public.workspace_members m
                         where m.user_id = p_user_id),
    -- user_id يقبل NULL (المشاركون الضيوف)، فالمساواة تتجاهلهم من نفسها
    'events_joined',   (select count(*) from public.event_participants ep
                         where ep.user_id = p_user_id),
    'events_created',  (select count(*) from public.events e
                         where e.creator_id = p_user_id)
  ) into v_activity;

  return json_build_object(
    'user',       v_user,
    'scale',      json_build_object('min', v_scale_min, 'max', v_scale_max),
    'my_ratings', v_mine,
    'groups',     v_groups,
    'activity',   v_activity
  );
end;
$$;

revoke execute on function public.admin_get_player_profile(uuid) from public, anon;
grant  execute on function public.admin_get_player_profile(uuid) to authenticated;

-- --------------------------------------------------- 3) حذف تقييم واحد ---
-- أول كتابة تصل من اللوحة إلى قاعدة البيانات: كل دوال admin_ الأخرى
-- stable للقراءة. الحذف بالمفتاح المركّب كاملًا لأنّ player_ratings
-- بلا عمود id — هويّة التقييم هي (المقيّم، المُقيَّم، المجموعة).
create or replace function public.admin_delete_player_rating(
  p_rater_id     uuid,
  p_ratee_id     uuid,
  p_workspace_id uuid
)
returns json
language plpgsql
security definer
volatile
set search_path = public, pg_temp
as $$
declare v_row public.player_ratings;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.player_ratings pr
   where pr.rater_id     = p_rater_id
     and pr.ratee_id     = p_ratee_id
     and pr.workspace_id = p_workspace_id
  returning pr.* into v_row;

  -- الرفع عند عدم التطابق مقصود: لو كانت الورقة قديمة (حُذف التقييم من
  -- مكان آخر) فالصمت يعني إبلاغ المشرف بنجاحٍ لم يحدث.
  if not found then
    raise exception 'rating not found' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_user_id, payload)
  values (auth.uid(), 'delete_player_rating', p_ratee_id, to_jsonb(v_row));

  return json_build_object('deleted', 1);
end;
$$;

revoke execute on function public.admin_delete_player_rating(uuid, uuid, uuid) from public, anon;
grant  execute on function public.admin_delete_player_rating(uuid, uuid, uuid) to authenticated;

commit;


-- =====================================================================
-- التحقّق — تُنفَّذ بعد التطبيق
-- ---------------------------------------------------------------------
-- 1) حدود التقييم الحقيقية. إن خالفت 1..99 فصحّح v_scale_min/v_scale_max
--    في admin_get_player_profile أعلاه:
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.player_ratings'::regclass and contype = 'c';
--
-- 2) وسند من البيانات نفسها:
--
--   select min(least(pace, shooting, passing, defending, stamina, awareness)) as lo,
--          max(greatest(pace, shooting, passing, defending, stamina, awareness)) as hi
--   from public.player_ratings;
--
-- 3) صيغة تقييم المجموعة. يحسب هذا الملف overall(متوسّط الصفات). قارنه
--    بمتوسّط overall لكل مقيّم؛ الفرق يظهر عند التقريب أو الحدّ:
--
--   with r as (
--     select pr.workspace_id, pr.pace, pr.shooting, pr.passing,
--            pr.defending, pr.stamina, pr.awareness,
--            public.player_rating_overall(
--              p_position => (select postion from public.users where user_id = '<ratee>'),
--              p_pace => pr.pace, p_shooting => pr.shooting, p_passing => pr.passing,
--              p_defending => pr.defending, p_stamina => pr.stamina,
--              p_awareness => pr.awareness) as overall
--     from public.player_ratings pr where pr.ratee_id = '<ratee>'
--   )
--   select workspace_id,
--          avg(overall) as avg_of_overall,
--          public.player_rating_overall(
--            p_position => (select postion from public.users where user_id = '<ratee>'),
--            p_pace => round(avg(pace))::integer,
--            p_shooting => round(avg(shooting))::integer,
--            p_passing => round(avg(passing))::integer,
--            p_defending => round(avg(defending))::integer,
--            p_stamina => round(avg(stamina))::integer,
--            p_awareness => round(avg(awareness))::integer) as overall_of_avg
--   from r group by workspace_id;
--
--    لو فشل النداء بـ «function does not exist» فوسائط الدالة numeric لا
--    integer — احذف ::integer وأعد التنفيذ، وصحّح الدالة أعلاه بالمثل.
--
--    ثم قارن overall_of_avg بما يُظهره التطبيق عبر
--    get_player_rating('<ratee>', '<workspace>').
--
-- 4) البوابة تعمل: نفّذ بحساب غير مشرف وتوقّع 42501.
--
--   select public.admin_get_player_profile('<any-user-id>');
-- =====================================================================
```

- [ ] **Step 2: Review the payload contract against the spec**

Confirm by reading the file that `admin_get_player_profile` returns exactly these top-level keys, because Task 3's mock must match: `user`, `scale`, `my_ratings`, `groups`, `activity`. Confirm `my_ratings` is an array and `groups[].raters` is an array.

- [ ] **Step 3: Hand off for deployment**

Report to the human:

> `supabase/admin-player-ratings.sql` is ready. Run it in the Supabase SQL editor on `timrin-prod` (`hzsxwnmbdkrmipjtfzlp`), then run verification queries 1–3 in the file's trailing comment block and paste the output. Query 1 tells us whether the hardcoded `1..99` scale is right; query 3 tells us whether the group-overall formula matches the app.

Do not proceed to real-data verification until that output comes back. Tasks 3–7 continue on mock data meanwhile.

- [ ] **Step 4: Commit**

```bash
git add supabase/admin-player-ratings.sql
git commit -m "Add admin RPCs for the player profile, its ratings, and rating delete"
```

---

## Task 3: Data layer — contract methods and mock fixtures

**Files:**
- Modify: `assets/admin-data.js` (contract comment at top; mock data section; implementation section; the `global.TamrinData` export at the end)

**Interfaces:**
- Consumes: `admin_get_player_profile`, `admin_delete_player_rating` (Task 2); the existing private `rpc()` helper and `USE_MOCK` flag.
- Produces:
  - `TamrinData.playerProfile(userId)` → `Promise<profile>` with the Task 2 payload shape
  - `TamrinData.deleteRating({ raterId, rateeId, workspaceId })` → `Promise<{deleted: number}>`

- [ ] **Step 1: Extend the contract comment**

In `assets/admin-data.js`, inside the header comment's contract list, after the `activeEvents()` line, add:

```
     playerProfile(userId)   -> { user, scale, my_ratings, groups, activity }
     deleteRating({ raterId, rateeId, workspaceId }) -> { deleted }
```

- [ ] **Step 2: Add mock workspaces, scale, and ratings**

In the mock data section, immediately after the `const WORKSPACES = [...]` line, add:

```js
  // معرّفات للمجموعات: الحمولة الحقيقية تُرجع workspace_id، والحذف يحتاجه.
  const MOCK_WORKSPACES = WORKSPACES.map((name, i) => ({ id: `w-${i + 1}`, name }));

  // نفس الحدود المُثبَّتة في admin_get_player_profile. تُرسل في الحمولة
  // لأنّ الواجهة لا يجوز أن تُثبّت مقامًا للأشرطة.
  const MOCK_SCALE = { min: 1, max: 99 };
```

Then, after the `MOCK_USERS` definition, add:

```js
  /* تقييمات تجريبية. المقيّمون مستخدمون حقيقيون من MOCK_USERS حتى تعمل
     أسماؤهم وصفوفهم كما في الإنتاج. المستخدم الأول u-001 هو «أنا» في
     وضع التجربة، فيظهر مسار «تقييمي» وشارة «أنت» بلا خادم. */
  const MOCK_ME = 'u-001';

  const MOCK_RATINGS = (() => {
    const rows = [];
    MOCK_USERS.forEach((ratee, ri) => {
      const groupCount = Math.floor(seeded(ri + 101) * 3);      // 0..2
      for (let g = 0; g < groupCount; g++) {
        const ws = MOCK_WORKSPACES[Math.floor(seeded(ri * 7 + g + 103) * MOCK_WORKSPACES.length)];
        const raterCount = 1 + Math.floor(seeded(ri * 11 + g + 107) * 4);   // 1..4
        for (let k = 0; k < raterCount; k++) {
          const rater = MOCK_USERS[Math.floor(seeded(ri * 13 + g * 5 + k + 109) * MOCK_USERS.length)];
          if (rater.user_id === ratee.user_id) continue;         // لا أحد يقيّم نفسه
          if (rows.some((x) => x.rater_id === rater.user_id
                            && x.ratee_id === ratee.user_id
                            && x.workspace_id === ws.id)) continue;   // المفتاح مركّب
          const at = (n) => 20 + Math.floor(seeded(ri * 17 + g * 3 + k + n) * 79);
          rows.push({
            rater_id: rater.user_id,
            ratee_id: ratee.user_id,
            workspace_id: ws.id,
            pace: at(1), shooting: at(2), passing: at(3),
            defending: at(4), stamina: at(5), awareness: at(6),
            created_at: new Date(now - Math.floor(seeded(ri + k + 131) * 60) * DAY).toISOString(),
            updated_at: new Date(now - Math.floor(seeded(ri + k + 137) * 30) * DAY).toISOString()
          });
        }
      }
    });
    // «أنا» أقيّم أول لاعبين لهما تقييمات، حتى لا تكون بطاقة «تقييمي» فارغة دائمًا
    rows.slice(0, 40).forEach((r, i) => {
      if (i % 9 !== 0 || r.ratee_id === MOCK_ME) return;
      if (rows.some((x) => x.rater_id === MOCK_ME
                        && x.ratee_id === r.ratee_id
                        && x.workspace_id === r.workspace_id)) return;
      rows.push(Object.assign({}, r, { rater_id: MOCK_ME }));
    });
    return rows;
  })();

  /* متوسّط بسيط — وضع التجربة لا يعرف الصيغة الموزونة بالمركز، وهي على
     الخادم. مقصود ألّا يتطابق الرقمان: هذا مسار العرض لا مسار الحساب. */
  function mockOverall(r) {
    const keys = ['pace', 'shooting', 'passing', 'defending', 'stamina', 'awareness'];
    return Math.round(keys.reduce((s, k) => s + Number(r[k] || 0), 0) / keys.length);
  }
```

- [ ] **Step 3: Add the two implementation functions**

In the implementation section, after `activeEvents()`, add:

```js
  async function playerProfile(userId) {
    if (USE_MOCK) {
      await wait(260);
      const user = MOCK_USERS.find((u) => u.user_id === userId);
      if (!user) throw new Error('المستخدم غير موجود');

      const mine = MOCK_RATINGS
        .filter((r) => r.ratee_id === userId && r.rater_id === MOCK_ME)
        .map((r) => {
          const ws = MOCK_WORKSPACES.find((w) => w.id === r.workspace_id);
          return Object.assign({}, r, {
            workspace_name: ws ? ws.name : '—',
            overall: mockOverall(r)
          });
        });

      const byWorkspace = new Map();
      MOCK_RATINGS.filter((r) => r.ratee_id === userId).forEach((r) => {
        if (!byWorkspace.has(r.workspace_id)) byWorkspace.set(r.workspace_id, []);
        byWorkspace.get(r.workspace_id).push(r);
      });

      const ATTR = ['pace', 'shooting', 'passing', 'defending', 'stamina', 'awareness'];
      const groups = [...byWorkspace.entries()].map(([wsId, list]) => {
        const ws = MOCK_WORKSPACES.find((w) => w.id === wsId);
        const averages = {};
        ATTR.forEach((k) => {
          averages[k] = Math.round(
            (list.reduce((s, r) => s + Number(r[k] || 0), 0) / list.length) * 10) / 10;
        });
        return {
          workspace_id: wsId,
          name: ws ? ws.name : '—',
          rater_count: list.length,
          overall: mockOverall(averages),
          averages: averages,
          raters: list.map((r) => {
            const ru = MOCK_USERS.find((u) => u.user_id === r.rater_id);
            return Object.assign({}, r, {
              name: ru ? ru.name : 'مستخدم محذوف',
              avatar_url: null,
              is_me: r.rater_id === MOCK_ME,
              overall: mockOverall(r)
            });
          })
        };
      });

      return {
        user: {
          user_id: user.user_id, name: user.name, postion: user.postion,
          avatar_url: user.avatar_url, stc_pay_number: user.stc_pay_number,
          created_at: user.created_at
        },
        scale: MOCK_SCALE,
        my_ratings: mine,
        groups: groups,
        activity: {
          workspace_count: user.workspace_count,
          events_joined: 1 + Math.floor(seeded(MOCK_USERS.indexOf(user) + 151) * 14),
          events_created: Math.floor(seeded(MOCK_USERS.indexOf(user) + 157) * 5)
        }
      };
    }
    return rpc('admin_get_player_profile', { p_user_id: userId });
  }

  async function deleteRating({ raterId, rateeId, workspaceId }) {
    if (USE_MOCK) {
      await wait(300);
      const i = MOCK_RATINGS.findIndex((r) => r.rater_id === raterId
                                           && r.ratee_id === rateeId
                                           && r.workspace_id === workspaceId);
      if (i < 0) throw new Error('التقييم غير موجود');
      MOCK_RATINGS.splice(i, 1);
      return { deleted: 1 };
    }
    return rpc('admin_delete_player_rating', {
      p_rater_id: raterId, p_ratee_id: rateeId, p_workspace_id: workspaceId
    });
  }
```

- [ ] **Step 4: Export both**

Replace the export block at the end of the file:

```js
  global.TamrinData = {
    signIn, signOut, restoreSession, isMock,
    overview, users, activeEvents
  };
```

with:

```js
  global.TamrinData = {
    signIn, signOut, restoreSession, isMock,
    overview, users, activeEvents,
    playerProfile, deleteRating
  };
```

- [ ] **Step 5: Verify the mock payload shape**

The dashboard requires a session, so exercise the data layer directly on the login page. `USE_MOCK` is `false` in the committed file (the anon key is present), so force the mock path for this check by loading the page and calling with a mock session.

```
mcp__Claude_Browser__navigate { "url": "http://localhost:4173/admin.html" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "typeof TamrinData.playerProfile === 'function' && typeof TamrinData.deleteRating === 'function'" }
```

Expected: `true`

Then temporarily flip to the mock path to inspect a payload. Edit `assets/admin-data.js` and change:

```js
  const USE_MOCK = !SUPABASE_ANON_KEY;
```

to

```js
  const USE_MOCK = true;   // مؤقّت — للتحقّق فقط
```

Reload and run:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const p = await TamrinData.playerProfile('u-001'); JSON.stringify({ keys: Object.keys(p).sort(), scale: p.scale, mineIsArray: Array.isArray(p.my_ratings), groupsIsArray: Array.isArray(p.groups), firstGroupKeys: p.groups[0] ? Object.keys(p.groups[0]).sort() : null, firstRaterKeys: p.groups[0] && p.groups[0].raters[0] ? Object.keys(p.groups[0].raters[0]).sort() : null })" }
```

Expected: `keys` is `["activity","groups","my_ratings","scale","user"]`; `scale` is `{"min":1,"max":99}`; both `mineIsArray` and `groupsIsArray` are `true`; `firstGroupKeys` contains `averages`, `name`, `overall`, `rater_count`, `raters`, `workspace_id`; `firstRaterKeys` contains `is_me`, `name`, `overall`, `rater_id`, and all six attributes.

Find a player who has ratings if `u-001` has none:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const found = []; for (const u of ['u-002','u-003','u-004','u-005','u-006','u-007','u-008']) { const p = await TamrinData.playerProfile(u); if (p.groups.length) found.push({ id: u, groups: p.groups.length, raters: p.groups[0].rater_count, mine: p.my_ratings.length }); } JSON.stringify(found)" }
```

Expected: a non-empty array. **Record one id with `groups >= 1` — later tasks need it.**

Verify delete works against the mock:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const id='<recorded-id>'; const before = await TamrinData.playerProfile(id); const r0 = before.groups[0].raters[0]; const res = await TamrinData.deleteRating({ raterId: r0.rater_id, rateeId: id, workspaceId: before.groups[0].workspace_id }); const after = await TamrinData.playerProfile(id); JSON.stringify({ res, beforeCount: before.groups[0].rater_count, afterTotal: after.groups.reduce((s,g)=>s+g.rater_count,0), beforeTotal: before.groups.reduce((s,g)=>s+g.rater_count,0) })" }
```

Expected: `res` is `{"deleted":1}` and `afterTotal` is exactly `beforeTotal - 1`.

- [ ] **Step 6: Revert the temporary flag**

Restore the line exactly:

```js
  const USE_MOCK = !SUPABASE_ANON_KEY;     // يتحوّل تلقائيًا عند وضع المفتاح
```

Confirm nothing else drifted:

```bash
git diff assets/admin-data.js | grep -n 'USE_MOCK *='
```

Expected: no output. If `USE_MOCK` appears in the diff, the temporary edit was not fully reverted.

- [ ] **Step 7: Commit**

```bash
git add assets/admin-data.js
git commit -m "Add playerProfile and deleteRating to the data contract, with mock fixtures"
```

---

## Task 4: Global search palette

**Files:**
- Create: `assets/admin-search.js`
- Create: `assets/admin-sheet.css` (palette styles only; Task 5 appends the sheet styles)
- Modify: `admin.html` (trigger button in `.admin-top-row`, palette markup, style + script tags, version bumps)
- Modify: `assets/admin.js` (wiring)

**Interfaces:**
- Consumes: `TamrinData.users({ search, page, pageSize })`.
- Produces: global `TamrinSearch` with `init({ onSelect })` and `open()` / `close()`. `onSelect` is called with one argument, the selected `user_id` string.

- [ ] **Step 1: Add the palette markup and asset tags**

In `admin.html`, inside `.admin-top-row`, between the `.admin-brand` div and the `.admin-who` div, insert:

```html
      <button type="button" class="cmdk-trigger" id="searchTrigger"
              aria-haspopup="dialog" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <span>ابحث عن لاعب</span>
        <kbd dir="ltr">⌘K</kbd>
      </button>
```

Immediately before the closing `</body>` tag (before the script tags), insert:

```html
<!-- ======================= البحث الشامل ======================= -->
<div class="cmdk-backdrop" id="cmdkBackdrop" hidden></div>
<div class="cmdk" id="cmdk" role="dialog" aria-modal="true"
     aria-labelledby="cmdkLabel" hidden>
  <h2 class="sr-only" id="cmdkLabel">ابحث في كل المستخدمين</h2>
  <div class="cmdk-field">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
    <input type="search" id="cmdkInput" autocomplete="off" spellcheck="false"
           placeholder="ابحث بالاسم أو الرقم"
           role="combobox" aria-expanded="true" aria-controls="cmdkList"
           aria-autocomplete="list" />
    <button type="button" class="cmdk-esc" id="cmdkClose">إغلاق</button>
  </div>
  <div class="cmdk-list" id="cmdkList" role="listbox" aria-label="نتائج البحث"></div>
</div>
```

In `<head>`, after the `admin.css` link, add:

```html
  <link rel="stylesheet" href="assets/admin-sheet.css?v=1" />
```

Replace the three existing asset references with bumped versions and add the new scripts:

```html
  <link rel="stylesheet" href="assets/admin.css?v=5" />
```

```html
<script src="assets/admin-data.js?v=5"></script>
<script src="assets/admin-ratings.js?v=1"></script>
<script src="assets/admin-search.js?v=1"></script>
<script src="assets/admin.js?v=5"></script>
```

`admin-ratings.js` loads before `admin-search.js` and `admin.js` because Task 6's sheet reads `TamrinRatings` at render time; load order must have it defined first.

- [ ] **Step 2: Add the `sr-only` class if it is missing**

`admin.html` already uses `.sr-only` on the existing search label. Confirm it is defined:

```bash
grep -n 'sr-only' assets/site.css assets/admin.css
```

If there is no definition (only usages), add to `assets/admin-sheet.css` in Step 3. If it is already defined, omit it there.

- [ ] **Step 3: Write the palette CSS**

Create `assets/admin-sheet.css`:

```css
/* =========================================================================
   تمرين — البحث الشامل وورقة اللاعب
   تبني على الرموز في site.css. لا تُعيد تعريف أي رمز.
   ========================================================================= */

/* ------------------------------------------------------- زرّ البحث */
.cmdk-trigger {
  display: inline-flex; align-items: center; gap: 9px;
  min-height: 40px; padding-inline: 14px;
  border: 1px solid var(--line); border-radius: var(--r-pill);
  background: var(--card); color: var(--text-3);
  font-size: 14px; font-weight: 500;
  transition: border-color .2s, color .2s;
}
.cmdk-trigger:hover { border-color: var(--line-strong); color: var(--text-2); }
.cmdk-trigger svg { width: 17px; height: 17px; flex: none; }
.cmdk-trigger kbd {
  font: inherit; font-size: 12px; color: var(--text-3);
  padding: 2px 6px; border-radius: 7px; background: var(--secondary);
}

/* --------------------------------------------------- طبقة البحث */
.cmdk-backdrop {
  position: fixed; inset: 0; z-index: 90;
  background: rgba(20, 20, 20, .32);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  animation: cmdk-fade .18s var(--ease);
}
.cmdk {
  position: fixed; z-index: 91;
  inset-block-start: 12vh; inset-inline: 0;
  width: min(560px, calc(100% - 32px)); margin-inline: auto;
  background: var(--card); border-radius: var(--r-card);
  box-shadow: var(--shadow-lift); overflow: hidden;
  animation: cmdk-rise .22s var(--ease);
}
@keyframes cmdk-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes cmdk-rise {
  from { opacity: 0; transform: translateY(-10px) }
  to   { opacity: 1; transform: none }
}

.cmdk-field {
  display: flex; align-items: center; gap: 11px;
  padding: 16px 18px; border-block-end: 1px solid var(--line);
}
.cmdk-field svg { width: 19px; height: 19px; flex: none; color: var(--text-3); }
.cmdk-field input {
  flex: 1; min-width: 0; min-height: 30px;
  border: none; background: none; font: inherit; font-size: 16px; color: var(--text);
}
.cmdk-field input:focus { outline: none; }
.cmdk-field input::placeholder { color: var(--text-3); }
.cmdk-field input::-webkit-search-cancel-button { display: none; }
.cmdk-esc {
  font-size: 13px; font-weight: 700; color: var(--text-3);
  padding: 5px 10px; border-radius: var(--r-pill); background: var(--secondary);
}
.cmdk-esc:hover { background: var(--line-strong); }

.cmdk-list { max-height: min(56vh, 420px); overflow-y: auto; padding: 8px; }
.cmdk-row {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 10px 12px; border-radius: 14px; text-align: start;
  transition: background-color .12s;
}
.cmdk-row[aria-selected="true"] { background: var(--secondary); }
.cmdk-row .nm { font-weight: 700; font-size: 15px; }
.cmdk-row .meta { margin-inline-start: auto; display: inline-flex; align-items: center; gap: 8px; }
.cmdk-row .grp { font-size: 13px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.cmdk-hint { padding: 34px 18px; text-align: center; color: var(--text-2); font-size: 14px; }
.cmdk-hint b { display: block; font-size: 16px; color: var(--text); margin-block-end: 5px; }

@media (max-width: 720px) {
  .cmdk { inset-block-start: 0; width: 100%; margin-inline: 0;
          border-start-start-radius: 0; border-start-end-radius: 0; }
  .cmdk-list { max-height: calc(100vh - 76px); }
  .cmdk-trigger span, .cmdk-trigger kbd { display: none; }
  .cmdk-trigger { padding-inline: 11px; }
}
```

If Step 2 found no `.sr-only` definition, also add:

```css
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}
```

- [ ] **Step 4: Write the palette module**

Create `assets/admin-search.js`:

```js
/* =========================================================================
   تمرين — البحث الشامل عن لاعب
   ---------------------------------------------------------------------
   لا يعرف هذا الملف شيئًا عن التقييمات ولا عن ورقة اللاعب. يستدعي
   TamrinData.users فقط، ويُبلّغ الاختيار عبر onSelect. الربط في admin.js.

   البحث نفسه على الخادم أصلًا: admin_list_users يبحث بـ ILIKE في الاسم
   ورقم STC Pay لكل المستخدمين. لا حاجة إلى بحث جديد — الجديد هو الوصول.
   ========================================================================= */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const nf = new Intl.NumberFormat('ar-SA-u-nu-latn');
  const initials = (name) => String(name || '؟').trim().charAt(0);

  const PAGE_SIZE = 8;
  const DEBOUNCE = 220;          // نفس زمن حقل البحث في لوحة المستخدمين

  let onSelect = null;
  let rows = [];
  let active = -1;
  let timer = null;
  let seq = 0;                   // يُهمل ردّ استعلام قديم وصل متأخّرًا
  let lastFocus = null;
  let open = false;

  function el() {
    return { box: $('cmdk'), back: $('cmdkBackdrop'), input: $('cmdkInput'), list: $('cmdkList') };
  }

  function hint(html) {
    el().list.innerHTML = `<div class="cmdk-hint">${html}</div>`;
    rows = []; active = -1;
  }

  function rowHtml(u, i) {
    return `
      <button type="button" class="cmdk-row" role="option" data-i="${i}"
              data-id="${esc(u.user_id)}" aria-selected="false">
        <span class="avatar sm" aria-hidden="true">${esc(initials(u.name))}</span>
        <span class="nm">${esc(u.name)}</span>
        <span class="meta">
          <span class="tag tag-flat">${esc(u.postion || '—')}</span>
          <span class="grp">${nf.format(u.workspace_count ?? 0)} مجموعة</span>
        </span>
      </button>`;
  }

  function paint(list) {
    rows = list;
    el().list.innerHTML = list.map(rowHtml).join('');
    setActive(list.length ? 0 : -1);
  }

  function setActive(i) {
    active = i;
    const nodes = el().list.querySelectorAll('.cmdk-row');
    nodes.forEach((n, k) => n.setAttribute('aria-selected', String(k === i)));
    if (i >= 0 && nodes[i]) nodes[i].scrollIntoView({ block: 'nearest' });
  }

  async function run(q) {
    const mine = ++seq;
    if (!q.trim()) { hint('اكتب للبحث في كل المستخدمين'); return; }
    try {
      const res = await TamrinData.users({ search: q, page: 1, pageSize: PAGE_SIZE });
      if (mine !== seq) return;                  // ردّ متأخّر — تجاهله
      if (!res.rows.length) {
        hint(`<b>لا نتائج</b>لا يوجد مستخدم يطابق «${esc(q)}».`);
        return;
      }
      paint(res.rows);
    } catch (e) {
      if (mine !== seq) return;
      hint('<b>تعذّر البحث</b>تحقّق من الاتصال وحاول مجددًا.');
    }
  }

  function choose(i) {
    const u = rows[i];
    if (!u) return;
    close();
    if (onSelect) onSelect(u.user_id);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rows.length) setActive((active + 1) % rows.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setActive((active - 1 + rows.length) % rows.length);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  }

  function openPalette() {
    if (open) return;
    open = true;
    lastFocus = document.activeElement;
    const { box, back, input } = el();
    back.hidden = false;
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    const trig = $('searchTrigger');
    if (trig) trig.setAttribute('aria-expanded', 'true');
    input.value = '';
    hint('اكتب للبحث في كل المستخدمين');
    input.focus();
  }

  function close() {
    if (!open) return;
    open = false;
    clearTimeout(timer);
    seq++;                                     // يُلغي أي ردّ في الطريق
    const { box, back } = el();
    box.hidden = true;
    back.hidden = true;
    document.body.style.overflow = '';
    const trig = $('searchTrigger');
    if (trig) trig.setAttribute('aria-expanded', 'false');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function init(opts) {
    onSelect = opts && opts.onSelect;
    const { box, back, input, list } = el();

    input.addEventListener('input', (e) => {
      clearTimeout(timer);
      const v = e.target.value;
      timer = setTimeout(() => run(v), DEBOUNCE);
    });
    input.addEventListener('keydown', onKey);

    list.addEventListener('click', (e) => {
      const row = e.target.closest('.cmdk-row');
      if (row) choose(Number(row.dataset.i));
    });
    list.addEventListener('mousemove', (e) => {
      const row = e.target.closest('.cmdk-row');
      if (row) setActive(Number(row.dataset.i));
    });

    back.addEventListener('click', close);
    $('cmdkClose').addEventListener('click', close);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  global.TamrinSearch = { init, open: openPalette, close, isOpen: () => open };
})(window);
```

- [ ] **Step 5: Wire it in `admin.js`**

In `assets/admin.js`, in the الأقسام section just before the `/* ----- إقلاع */` comment, add:

```js
  /* ---------------------------------------------------- البحث الشامل */

  TamrinSearch.init({
    onSelect: (userId) => TamrinPlayer.open(userId)
  });

  $('searchTrigger').addEventListener('click', () => TamrinSearch.open());

  /* ⌘K / Ctrl+K في أي مكان، و«/» فقط خارج حقول الكتابة حتى لا تُختطف
     الشرطة من حقل بحث المستخدمين. */
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
                || document.activeElement?.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      TamrinSearch.open();
      return;
    }
    if (e.key === '/' && !typing && !TamrinSearch.isOpen()) {
      e.preventDefault();
      TamrinSearch.open();
    }
  });
```

`TamrinPlayer` does not exist until Task 5. To keep this task independently testable, use this temporary `onSelect` for now and replace it in Task 5 Step 5:

```js
  TamrinSearch.init({
    onSelect: (userId) => console.log('selected user:', userId)
  });
```

- [ ] **Step 6: Verify the palette**

Sign-in is required for the dashboard, so set the mock path for this check: set `USE_MOCK = true` in `assets/admin-data.js`, reload `http://localhost:4173/admin.html`, and sign in with any non-empty email and password (the mock path accepts anything).

```
mcp__Claude_Browser__browser_batch { "actions": [
  { "name": "navigate", "input": { "url": "http://localhost:4173/admin.html" } },
  { "name": "find", "input": { "query": "البريد الإلكتروني" } }
]}
```

Fill and submit the login form, then check the trigger exists and the shortcut works:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "document.getElementById('searchTrigger').offsetParent !== null" }
```

Expected: `true`

```
mcp__Claude_Browser__computer { "action": "left_click", "ref": "<searchTrigger ref>" }
mcp__Claude_Browser__computer { "action": "type", "text": "ا" }
```

Wait past the debounce, then:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "JSON.stringify({ open: !document.getElementById('cmdk').hidden, rows: document.querySelectorAll('.cmdk-row').length, activeIdx: [...document.querySelectorAll('.cmdk-row')].findIndex(n => n.getAttribute('aria-selected') === 'true') })" }
```

Expected: `open` is `true`, `rows` is between 1 and 8, `activeIdx` is `0`.

Arrow-key navigation:

```
mcp__Claude_Browser__computer { "action": "key", "text": "Down" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "[...document.querySelectorAll('.cmdk-row')].findIndex(n => n.getAttribute('aria-selected') === 'true')" }
```

Expected: `1`

Selection fires the callback — read the console after pressing Enter:

```
mcp__Claude_Browser__computer { "action": "key", "text": "Return" }
mcp__Claude_Browser__read_console_messages { "pattern": "selected user" }
```

Expected: one message `selected user: u-0NN`, and the palette is closed.

No-results and idle states:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinSearch.open(); document.getElementById('cmdkList').textContent.trim()" }
```

Expected: `اكتب للبحث في كل المستخدمين`

Type a string that cannot match, wait past the debounce:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const i = document.getElementById('cmdkInput'); i.value = 'zzzqqq'; i.dispatchEvent(new Event('input', {bubbles:true})); await new Promise(r => setTimeout(r, 700)); document.getElementById('cmdkList').textContent" }
```

Expected: text containing `لا نتائج` and `zzzqqq`.

Escape closes and returns focus:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinSearch.open(); await new Promise(r=>setTimeout(r,60)); document.getElementById('cmdkInput').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); await new Promise(r=>setTimeout(r,60)); JSON.stringify({ closed: document.getElementById('cmdk').hidden, bodyOverflow: document.body.style.overflow })" }
```

Expected: `{"closed":true,"bodyOverflow":""}`

Mobile layout:

```
mcp__Claude_Browser__resize_window { "preset": "mobile" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinSearch.open(); const r = document.getElementById('cmdk').getBoundingClientRect(); JSON.stringify({ top: Math.round(r.top), fullWidth: Math.round(r.width) === Math.round(document.documentElement.clientWidth) })" }
```

Expected: `{"top":0,"fullWidth":true}`

```
mcp__Claude_Browser__resize_window { "preset": "desktop" }
mcp__Claude_Browser__computer { "action": "screenshot" }
```

Confirm visually: the palette is centred, RTL-correct (search icon on the right of the input), and the rows read cleanly.

Revert `USE_MOCK` to `!SUPABASE_ANON_KEY` and confirm:

```bash
git diff assets/admin-data.js | grep -n 'USE_MOCK *='
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add admin.html assets/admin-search.js assets/admin-sheet.css assets/admin.js
git commit -m "Add a dashboard-wide player search palette"
```

---

## Task 5: Profile sheet shell

**Files:**
- Create: `assets/admin-player.js`
- Modify: `assets/admin-sheet.css` (append sheet styles)
- Modify: `admin.html` (sheet markup, script tag)
- Modify: `assets/admin.js` (replace the temporary `onSelect`)

**Interfaces:**
- Consumes: `TamrinData.playerProfile(userId)` (Task 3).
- Produces: global `TamrinPlayer` with `open(userId)`, `close()`, `isOpen()`. Renders the header and states only; Task 6 fills in the ratings body by replacing the `body(profile)` function.

- [ ] **Step 1: Add the sheet markup**

In `admin.html`, immediately after the palette markup added in Task 4, insert:

```html
<!-- ======================= ورقة اللاعب ======================= -->
<div class="sheet-backdrop" id="sheetBackdrop" hidden></div>
<aside class="sheet" id="sheet" role="dialog" aria-modal="true"
       aria-labelledby="sheetName" hidden>
  <header class="sheet-head">
    <div class="who">
      <span class="avatar" id="sheetAvatar" aria-hidden="true"></span>
      <span>
        <b id="sheetName">—</b>
        <span class="sub" id="sheetSub"></span>
      </span>
    </div>
    <button type="button" class="sheet-x" id="sheetClose" aria-label="إغلاق">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  </header>
  <div class="sheet-body" id="sheetBody"></div>
</aside>
```

Add the script tag after `admin-search.js`:

```html
<script src="assets/admin-player.js?v=1"></script>
```

Final script order in `admin.html`:

```html
<script src="assets/admin-data.js?v=5"></script>
<script src="assets/admin-ratings.js?v=1"></script>
<script src="assets/admin-search.js?v=1"></script>
<script src="assets/admin-player.js?v=1"></script>
<script src="assets/admin.js?v=5"></script>
```

- [ ] **Step 2: Append the sheet CSS**

Append to `assets/admin-sheet.css`:

```css
/* --------------------------------------------------- ورقة اللاعب */
.sheet-backdrop {
  position: fixed; inset: 0; z-index: 95;
  background: rgba(20, 20, 20, .32);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  animation: cmdk-fade .18s var(--ease);
}

/* الورقة جانبية على الشاشات الواسعة: تُثبَّت على inset-inline-end، أي
   الحافة اليسرى في صفحة dir=rtl — مرآة لوحة التفاصيل المعتادة.

   الانزلاق بـ translateX وليس بخاصية منطقية: محور X في transform لا
   ينقلب مع الاتجاه. المتغيّر أدناه يحمل الاتجاه، فلا نعتمد على مرآة
   غير موجودة. */
.sheet {
  --sheet-out: -100%;
  position: fixed; z-index: 96;
  inset-block: 0; inset-inline-end: 0;
  width: min(460px, 100%);
  display: flex; flex-direction: column;
  background: var(--card); box-shadow: var(--shadow-lift);
  transform: translateX(var(--sheet-out));
  transition: transform .28s var(--ease);
}
[dir="ltr"] .sheet { --sheet-out: 100%; }
.sheet.on { transform: none; }

.sheet-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; padding: 20px 20px 16px;
  border-block-end: 1px solid var(--line); flex: none;
}
.sheet-head .who { align-items: flex-start; }
.sheet-head b { display: block; font-size: 18px; font-weight: 700; }
.sheet-head .sub { font-size: 13px; color: var(--text-3); }
.sheet-x {
  flex: none; width: 36px; height: 36px; border-radius: var(--r-pill);
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--secondary); color: var(--text-2); transition: background-color .2s;
}
.sheet-x:hover { background: var(--line-strong); }
.sheet-x svg { width: 17px; height: 17px; }

.sheet-body { flex: 1; overflow-y: auto; padding: 18px 20px 40px; }

@media (max-width: 720px) {
  /* ورقة سفلية: الانزلاق على Y، والمحور الرأسي لا يتأثّر بالاتجاه. */
  .sheet {
    inset-block: auto 0; inset-inline: 0;
    width: 100%; max-height: 90vh;
    border-start-start-radius: var(--r-card);
    border-start-end-radius: var(--r-card);
    transform: translateY(100%);
  }
  [dir="ltr"] .sheet { transform: translateY(100%); }
  .sheet.on { transform: none; }
  .sheet-body { padding-block-end: 34px; }
}
```

- [ ] **Step 3: Write the sheet shell**

Create `assets/admin-player.js`:

```js
/* =========================================================================
   تمرين — ورقة اللاعب
   ---------------------------------------------------------------------
   لا تعرف هذه الورقة شيئًا عن البحث: تُفتح بمعرّف مستخدم فقط. الربط
   بينهما في admin.js.

   التقييم العام لا يُحسب هنا. يأتي محسوبًا من الخادم عبر
   player_rating_overall، وحساباتُ العرض وحدها في TamrinRatings.
   ========================================================================= */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const nf = new Intl.NumberFormat('ar-SA-u-nu-latn');
  const num = (n) => nf.format(n ?? 0);
  const dateFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
  const asDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
  const initials = (name) => String(name || '؟').trim().charAt(0);

  let open = false;
  let lastFocus = null;
  let currentId = null;
  let profile = null;
  let seq = 0;

  /* --------------------------------------------------------- الجسم */

  /** يستبدلها Task 6 بالمحتوى الكامل. */
  function body(p) {
    return `<div class="empty"><b>${esc(p.user.name)}</b>الجسم يأتي في المهمة التالية.</div>`;
  }

  function paintHead(p) {
    $('sheetAvatar').textContent = initials(p.user.name);
    $('sheetName').textContent = p.user.name;
    const bits = [];
    if (p.user.postion) bits.push(p.user.postion);
    bits.push('انضم ' + asDate(p.user.created_at));
    $('sheetSub').textContent = bits.join(' · ');
  }

  function skeleton() {
    $('sheetBody').innerHTML = `
      <div class="loading" style="display:grid;gap:12px">
        <span class="skel" style="width:60%"></span>
        <span class="skel" style="width:90%;height:64px;border-radius:18px"></span>
        <span class="skel" style="width:40%"></span>
        <span class="skel" style="width:100%;height:120px;border-radius:18px"></span>
      </div>`;
  }

  async function load(userId) {
    const mine = ++seq;
    skeleton();
    try {
      const p = await TamrinData.playerProfile(userId);
      if (mine !== seq || !open) return;
      profile = p;
      paintHead(p);
      $('sheetBody').innerHTML = body(p);
    } catch (e) {
      if (mine !== seq || !open) return;
      profile = null;
      $('sheetBody').innerHTML =
        '<div class="empty"><b>تعذّر جلب الملف</b>تحقّق من الاتصال وحاول مجددًا.</div>';
    }
  }

  /* ----------------------------------------------------- الفتح والإغلاق */

  /** حصر التركيز داخل الورقة: Tab لا يخرج إلى الصفحة خلف الطبقة. */
  function trap(e) {
    if (e.key !== 'Tab') return;
    const box = $('sheet');
    const nodes = [...box.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    trap(e);
  }

  function openSheet(userId) {
    currentId = userId;
    if (!open) {
      open = true;
      lastFocus = document.activeElement;
      $('sheetBackdrop').hidden = false;
      $('sheet').hidden = false;
      document.body.style.overflow = 'hidden';
      // إطار واحد قبل إضافة الصنف حتى يبدأ الانتقال من الحالة المخفيّة
      requestAnimationFrame(() => $('sheet').classList.add('on'));
      document.addEventListener('keydown', onKey);
      $('sheetClose').focus();
    }
    $('sheetName').textContent = '—';
    $('sheetSub').textContent = '';
    $('sheetAvatar').textContent = '';
    load(userId);
  }

  function close() {
    if (!open) return;
    open = false;
    seq++;
    profile = null;
    currentId = null;
    const box = $('sheet');
    box.classList.remove('on');
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    // ننتظر الانتقال قبل hidden، وإلّا اختفت الورقة بلا انزلاق
    const done = () => { if (!open) { box.hidden = true; $('sheetBackdrop').hidden = true; } };
    box.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 360);                    // شبكة أمان لو لم يُطلق الحدث
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function init() {
    $('sheetClose').addEventListener('click', close);
    $('sheetBackdrop').addEventListener('click', close);
  }

  global.TamrinPlayer = {
    init, open: openSheet, close,
    isOpen: () => open,
    current: () => currentId,
    profile: () => profile,
    reload: () => (currentId ? load(currentId) : null)
  };
})(window);
```

- [ ] **Step 4: Initialise and wire it**

In `assets/admin.js`, replace the temporary wiring from Task 4 Step 5:

```js
  TamrinSearch.init({
    onSelect: (userId) => console.log('selected user:', userId)
  });
```

with:

```js
  TamrinPlayer.init();
  TamrinSearch.init({
    onSelect: (userId) => TamrinPlayer.open(userId)
  });
```

Also make the name in a user row open the sheet, so the sheet is reachable without the palette. Make the **name a real `<button>`**, not the row: a focusable `<tr role="button">` removes the row from the table structure for screen readers, and a native button gets Enter/Space for free.

In `userRow()` in `assets/admin.js`, change:

```js
        <td>
          <span class="who">
            <span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span>
            <b>${esc(u.name)}</b>
          </span>
        </td>
```

to:

```js
        <td>
          <button type="button" class="who row-open" data-id="${esc(u.user_id)}">
            <span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span>
            <b>${esc(u.name)}</b>
          </button>
        </td>
```

and after the `$('userSearch').addEventListener(...)` block add:

```js
  /* اسم المستخدم يفتح ورقته. زرّ حقيقي: Enter و Space يعملان من نفسهما،
     والصفّ يبقى صفًّا في شجرة الوصول. */
  $('usersBody').addEventListener('click', (e) => {
    const btn = e.target.closest('.row-open');
    if (btn && btn.dataset.id) TamrinPlayer.open(btn.dataset.id);
  });
```

Append the affordance to `assets/admin-sheet.css`:

```css
button.row-open { cursor: pointer; text-align: start; }
button.row-open b { text-decoration: underline; text-decoration-color: transparent;
                    text-underline-offset: 3px; transition: text-decoration-color .2s; }
button.row-open:hover b { text-decoration-color: var(--line-strong); }
button.row-open:focus-visible { outline: 2px solid var(--green); outline-offset: 3px;
                                border-radius: var(--r-pill); }
```

- [ ] **Step 5: Verify the shell**

With `USE_MOCK = true` and signed in, use the id recorded in Task 3 Step 5.

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinPlayer.open('<recorded-id>'); await new Promise(r=>setTimeout(r,600)); const s = document.getElementById('sheet'); JSON.stringify({ visible: !s.hidden, on: s.classList.contains('on'), name: document.getElementById('sheetName').textContent, sub: document.getElementById('sheetSub').textContent, bodyHasText: document.getElementById('sheetBody').textContent.trim().length > 0 })" }
```

Expected: `visible` and `on` are `true`; `name` is a non-empty Arabic name (not `—`); `sub` contains `انضم`; `bodyHasText` is `true`.

Desktop side-sheet geometry — must be flush to the **left** edge on this RTL page:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const r = document.getElementById('sheet').getBoundingClientRect(); JSON.stringify({ left: Math.round(r.left), width: Math.round(r.width), fullHeight: Math.round(r.height) === Math.round(window.innerHeight) })" }
```

Expected: `left` is `0`, `width` is `460`, `fullHeight` is `true`. **A non-zero `left` means the RTL transform is wrong** — check `--sheet-out`.

Bottom sheet on mobile:

```
mcp__Claude_Browser__resize_window { "preset": "mobile" }
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinPlayer.close(); await new Promise(r=>setTimeout(r,420)); TamrinPlayer.open('<recorded-id>'); await new Promise(r=>setTimeout(r,700)); const r2 = document.getElementById('sheet').getBoundingClientRect(); JSON.stringify({ bottom: Math.round(window.innerHeight - r2.bottom), fullWidth: Math.round(r2.width) === Math.round(document.documentElement.clientWidth), withinMax: r2.height <= window.innerHeight * 0.91 })" }
```

Expected: `{"bottom":0,"fullWidth":true,"withinMax":true}`

```
mcp__Claude_Browser__computer { "action": "screenshot" }
mcp__Claude_Browser__resize_window { "preset": "desktop" }
```

Escape closes, focus returns, scroll unlocks:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); await new Promise(r=>setTimeout(r,450)); JSON.stringify({ hidden: document.getElementById('sheet').hidden, overflow: document.body.style.overflow })" }
```

Expected: `{"hidden":true,"overflow":""}`

Error state:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinPlayer.open('does-not-exist'); await new Promise(r=>setTimeout(r,700)); document.getElementById('sheetBody').textContent" }
```

Expected: text containing `تعذّر جلب الملف`.

Palette → sheet end to end:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinPlayer.close(); TamrinSearch.open(); const i = document.getElementById('cmdkInput'); i.value = 'ا'; i.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,700)); document.querySelector('.cmdk-row').click(); await new Promise(r=>setTimeout(r,700)); JSON.stringify({ paletteClosed: document.getElementById('cmdk').hidden, sheetOpen: !document.getElementById('sheet').hidden, name: document.getElementById('sheetName').textContent })" }
```

Expected: `paletteClosed` is `true`, `sheetOpen` is `true`, `name` is a real name.

Clicking a name in the users table also opens it:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinPlayer.close(); await new Promise(r=>setTimeout(r,420)); document.querySelector('#usersBody .row-open').click(); await new Promise(r=>setTimeout(r,700)); !document.getElementById('sheet').hidden" }
```

Expected: `true`

The focus trap holds — Tab from the last focusable node must wrap to the first, not escape to the page behind:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const box = document.getElementById('sheet'); const nodes = [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])')].filter(n => n.offsetParent !== null); nodes[nodes.length-1].focus(); document.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', bubbles:true})); const fwd = box.contains(document.activeElement); nodes[0].focus(); document.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', shiftKey:true, bubbles:true})); const back = box.contains(document.activeElement); JSON.stringify({ focusable: nodes.length, wrapsForward: fwd, wrapsBackward: back })" }
```

Expected: `focusable` is at least 1, and both `wrapsForward` and `wrapsBackward` are `true`. **If either is `false`, focus is escaping the sheet.**

The loading skeleton appears before data arrives:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinPlayer.close(); await new Promise(r=>setTimeout(r,420)); TamrinPlayer.open('<recorded-id>'); await new Promise(r=>setTimeout(r,60)); const early = document.querySelectorAll('#sheetBody .skel').length; await new Promise(r=>setTimeout(r,900)); JSON.stringify({ skeletonShown: early > 0, skeletonGone: document.querySelectorAll('#sheetBody .skel').length === 0 })" }
```

Expected: `{"skeletonShown":true,"skeletonGone":true}`

- [ ] **Step 6: Commit**

```bash
git add admin.html assets/admin-player.js assets/admin-sheet.css assets/admin.js
git commit -m "Add the player profile sheet shell: side sheet on desktop, bottom sheet on mobile"
```

---

## Task 6: Profile sheet content — ratings

**Files:**
- Modify: `assets/admin-player.js` (replace `body()`, add the render helpers)
- Modify: `assets/admin-sheet.css` (append rating styles)

**Interfaces:**
- Consumes: `TamrinRatings.ATTRS`, `.attributeRows()`, `.hasAnyRatings()`, `.totalRaterCount()`, `.sortGroups()`, `.sortRaters()` (Task 1); the profile payload (Task 3).
- Produces: rendered sheet body. Rater rows carry `data-rater`, `data-workspace` attributes — Task 7's delete flow reads them.

- [ ] **Step 1: Replace `body()` and add the render helpers**

In `assets/admin-player.js`, replace the placeholder:

```js
  /** يستبدلها Task 6 بالمحتوى الكامل. */
  function body(p) {
    return `<div class="empty"><b>${esc(p.user.name)}</b>الجسم يأتي في المهمة التالية.</div>`;
  }
```

with:

```js
  /* --------------------------------------------------- عرض التقييمات */

  /** صفوف الصفات الستّ. الشريط يُرسم بنسبة من scale القادم من الخادم؛
      إن كان المقياس غير صالح عُرض الرقم بلا شريط بدل تخمين مقام. */
  function attrsHtml(rating, scale) {
    return `<div class="attrs">${TamrinRatings.attributeRows(rating, scale).map((a) => `
      <div class="attr">
        <span class="lbl">${esc(a.label)}</span>
        ${a.percent === null
          ? '<span class="meter"><span class="txt">' + (a.value === null ? '—' : num(a.value)) + '</span></span>'
          : '<span class="meter"><span class="bar"><i style="width:' + a.percent + '%"></i></span>'
            + '<span class="txt">' + num(a.value) + '</span></span>'}
      </div>`).join('')}</div>`;
  }

  function overallHtml(value, label) {
    return `
      <div class="ovr">
        <span class="n">${value === null || value === undefined ? '—' : num(Math.round(value))}</span>
        <span class="l">${esc(label)}</span>
      </div>`;
  }

  function myRatingsHtml(p) {
    if (!p.my_ratings || !p.my_ratings.length) {
      return `
        <section class="blk">
          <h3>تقييمي</h3>
          <div class="mine none">لم تُقيّم هذا اللاعب.</div>
        </section>`;
    }
    return `
      <section class="blk">
        <h3>تقييمي</h3>
        ${p.my_ratings.map((m) => `
          <div class="mine">
            <div class="mine-top">
              ${overallHtml(m.overall, 'تقييمي')}
              <span class="tag tag-flat">${esc(m.workspace_name || '—')}</span>
            </div>
            ${attrsHtml(m, p.scale)}
          </div>`).join('')}
      </section>`;
  }

  function raterHtml(r, g, scale) {
    return `
      <div class="rater" data-rater="${esc(r.rater_id)}" data-workspace="${esc(g.workspace_id)}">
        <div class="rater-top">
          <span class="who">
            <span class="avatar sm" aria-hidden="true">${esc(initials(r.name))}</span>
            <b>${esc(r.name)}</b>
            ${r.is_me ? '<span class="tag tag-lime">أنت</span>' : ''}
          </span>
          <span class="rater-right">
            <span class="score">${r.overall === null || r.overall === undefined
              ? '—' : num(Math.round(r.overall))}</span>
            <button type="button" class="del" aria-label="حذف تقييم ${esc(r.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" aria-hidden="true">
                <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
              </svg>
            </button>
          </span>
        </div>
        ${attrsHtml(r, scale)}
        <div class="rater-foot">
          <span>قُيّم في ${esc(asDate(r.created_at))}</span>
          ${r.updated_at && r.updated_at !== r.created_at
            ? `<span>عُدّل في ${esc(asDate(r.updated_at))}</span>` : ''}
        </div>
        <div class="confirm" hidden>
          <span>تأكيد الحذف؟</span>
          <button type="button" class="btn-del-yes">حذف</button>
          <button type="button" class="btn-del-no">إلغاء</button>
        </div>
      </div>`;
  }

  function groupsHtml(p) {
    if (!TamrinRatings.hasAnyRatings(p)) {
      return `
        <section class="blk">
          <div class="empty"><b>لا تقييمات بعد</b>لم يقيّم أحد هذا اللاعب حتى الآن.</div>
        </section>`;
    }
    return `
      <section class="blk">
        <h3>التقييمات بحسب المجموعة
          <span class="c">${num(TamrinRatings.totalRaterCount(p))} تقييم</span>
        </h3>
        ${TamrinRatings.sortGroups(p.groups).map((g) => `
          <div class="grp-card">
            <div class="grp-top">
              ${overallHtml(g.overall, 'التقييم العام')}
              <span class="grp-id">
                <b>${esc(g.name)}</b>
                <span>${num(g.rater_count)} مقيّم</span>
              </span>
            </div>
            ${attrsHtml(g.averages, p.scale)}
            <div class="raters">
              ${TamrinRatings.sortRaters(g.raters).map((r) => raterHtml(r, g, p.scale)).join('')}
            </div>
          </div>`).join('')}
      </section>`;
  }

  function activityHtml(p) {
    const a = p.activity || {};
    const cell = (k, v) => `<div class="a-cell"><span class="k">${esc(k)}</span>`
                          + `<span class="v">${num(v)}</span></div>`;
    return `
      <section class="blk">
        <h3>النشاط</h3>
        <div class="act">
          ${cell('المجموعات', a.workspace_count)}
          ${cell('فعاليات شارك فيها', a.events_joined)}
          ${cell('فعاليات أنشأها', a.events_created)}
        </div>
      </section>`;
  }

  function idHtml(p) {
    const pay = p.user.stc_pay_number
      ? `<span class="pay" dir="ltr">${esc(p.user.stc_pay_number)}</span>`
      : '<span class="pay-none">—</span>';
    return `
      <section class="blk">
        <div class="idrow">
          <span><span class="k">المركز</span>
            <span class="tag tag-flat">${esc(p.user.postion || '—')}</span></span>
          <span><span class="k">رقم STC Pay</span> ${pay}</span>
        </div>
      </section>`;
  }

  /* الترتيب مقصود: التقييمات أولًا. النشاط والهوية ثانويان. */
  function body(p) {
    return idHtml(p) + myRatingsHtml(p) + groupsHtml(p) + activityHtml(p);
  }
```

- [ ] **Step 2: Append the rating CSS**

Append to `assets/admin-sheet.css`:

```css
/* ------------------------------------------- محتوى ورقة اللاعب */
.sheet-body .blk { margin-block-end: 26px; }
.sheet-body h3 {
  display: flex; align-items: baseline; gap: 9px;
  font-size: 15px; font-weight: 700; margin-block-end: 11px;
}
.sheet-body h3 .c { font-size: 13px; font-weight: 500; color: var(--text-3); }

.idrow { display: flex; flex-wrap: wrap; gap: 10px 22px; font-size: 14px; }
.idrow .k { color: var(--text-3); margin-inline-end: 6px; }

/* الرقم الكبير: التقييم العام هو أول ما تقع عليه العين. */
.ovr { display: inline-flex; align-items: baseline; gap: 7px; }
.ovr .n {
  font-size: 34px; font-weight: 700; line-height: 1;
  font-variant-numeric: tabular-nums; letter-spacing: -.02em;
}
.ovr .l { font-size: 13px; color: var(--text-3); }

.attrs { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 18px; }
.attr { display: flex; align-items: center; gap: 9px; font-size: 13px; }
.attr .lbl { color: var(--text-3); min-width: 46px; }
.attr .meter { flex: 1; min-width: 0; }
.attr .meter .bar { flex: 1; }
.attr .meter .txt { font-size: 13px; min-width: 22px; text-align: end; }

.mine {
  background: color-mix(in srgb, var(--lime) 22%, var(--card));
  border: 1px solid color-mix(in srgb, var(--lime) 45%, transparent);
  border-radius: 18px; padding: 15px 16px; margin-block-end: 10px;
}
.mine.none { color: var(--text-2); font-size: 14px; text-align: center; padding-block: 22px; }
.mine-top {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-block-end: 13px;
}

.grp-card {
  border: 1px solid var(--line); border-radius: 18px;
  padding: 15px 16px; margin-block-end: 12px; background: var(--card);
}
.grp-top {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-block-end: 13px;
}
.grp-id { text-align: end; }
.grp-id b { display: block; font-size: 15px; font-weight: 700; }
.grp-id span { font-size: 13px; color: var(--text-3); }

.raters { margin-block-start: 14px; border-block-start: 1px solid var(--line); }
.rater { padding-block: 13px; border-block-end: 1px solid var(--line); }
.rater:last-child { border-block-end: none; padding-block-end: 0; }
.rater-top {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-block-end: 10px;
}
.rater-right { display: inline-flex; align-items: center; gap: 10px; }
.rater .score {
  font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.rater .del {
  width: 32px; height: 32px; border-radius: var(--r-pill);
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--secondary); color: var(--text-3);
  transition: background-color .2s, color .2s;
}
.rater .del:hover { background: color-mix(in srgb, #b3261e 14%, transparent); color: #b3261e; }
.rater .del svg { width: 16px; height: 16px; }
.rater-foot {
  display: flex; gap: 14px; margin-block-start: 9px;
  font-size: 12px; color: var(--text-3);
}
.rater.busy { opacity: .5; pointer-events: none; }

.confirm {
  display: flex; align-items: center; gap: 9px; margin-block-start: 11px;
  padding: 10px 12px; border-radius: 14px; font-size: 14px;
  background: color-mix(in srgb, #b3261e 9%, transparent);
}
.confirm span { font-weight: 700; color: #b3261e; margin-inline-end: auto; }
.confirm button {
  min-height: 32px; padding-inline: 14px; border-radius: var(--r-pill);
  font-size: 13px; font-weight: 700;
}
.btn-del-yes { background: #b3261e; color: #fff; }
.btn-del-no { background: var(--secondary); color: var(--text-2); }

.act { display: flex; flex-wrap: wrap; gap: 10px; }
.a-cell {
  flex: 1 1 30%; background: var(--secondary);
  border-radius: 14px; padding: 12px 14px;
}
.a-cell .k { display: block; font-size: 12px; color: var(--text-3); margin-block-end: 4px; }
.a-cell .v { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; }

.sheet-toast {
  position: fixed; z-index: 97; inset-block-end: 22px; inset-inline: 0;
  width: max-content; max-width: calc(100% - 32px); margin-inline: auto;
  padding: 12px 20px; border-radius: var(--r-pill);
  background: var(--ink); color: #f2f2f2; font-size: 14px; font-weight: 700;
  box-shadow: var(--shadow-lift); animation: cmdk-fade .2s var(--ease);
}
.sheet-toast.bad { background: #b3261e; }

@media (max-width: 720px) {
  .attrs { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Verify the rendered content**

With `USE_MOCK = true`, signed in, using the recorded id:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinPlayer.open('<recorded-id>'); await new Promise(r=>setTimeout(r,700)); const b = document.getElementById('sheetBody'); JSON.stringify({ groupCards: b.querySelectorAll('.grp-card').length, raters: b.querySelectorAll('.rater').length, attrRows: b.querySelectorAll('.grp-card .attr').length, bars: b.querySelectorAll('.attr .bar i').length, overalls: b.querySelectorAll('.ovr .n').length, hasActivity: !!b.querySelector('.act'), headings: [...b.querySelectorAll('h3')].map(h => h.textContent.trim().split('\\n')[0]) })" }
```

Expected: `groupCards >= 1`; `raters >= 1`; `attrRows` is a multiple of 6; `bars` equals the total number of `.attr` rows (the mock scale is valid, so every row gets a bar); `overalls >= 1`; `hasActivity` is `true`; `headings` includes `تقييمي` and a heading starting `التقييمات بحسب المجموعة` and `النشاط`.

Every rater row carries the delete identity Task 7 needs:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const rs = [...document.querySelectorAll('.rater')]; JSON.stringify({ total: rs.length, allHaveIds: rs.every(r => r.dataset.rater && r.dataset.workspace), allHaveDelete: rs.every(r => !!r.querySelector('.del')), allHaveConfirm: rs.every(r => !!r.querySelector('.confirm')), confirmsHidden: rs.every(r => r.querySelector('.confirm').hidden) })" }
```

Expected: `{"total":N,"allHaveIds":true,"allHaveDelete":true,"allHaveConfirm":true,"confirmsHidden":true}`

Bar percentages agree with the pure module:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const p = TamrinPlayer.profile(); const g = TamrinRatings.sortGroups(p.groups)[0]; const r = TamrinRatings.sortRaters(g.raters)[0]; const expected = TamrinRatings.attributeRows(r, p.scale).map(a => a.percent + '%'); const node = document.querySelector('.rater'); const actual = [...node.querySelectorAll('.attr .bar i')].map(i => i.style.width); JSON.stringify({ expected, actual, match: JSON.stringify(expected) === JSON.stringify(actual) })" }
```

Expected: `match` is `true`.

No maximum is hardcoded — an absent scale must degrade to numbers with no bars:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const real = TamrinData.playerProfile; TamrinData.playerProfile = async (id) => { const p = await real(id); p.scale = null; return p; }; TamrinPlayer.reload(); await new Promise(r=>setTimeout(r,700)); const out = { bars: document.querySelectorAll('.attr .bar').length, numbers: document.querySelectorAll('.attr .meter .txt').length }; TamrinData.playerProfile = real; TamrinPlayer.reload(); await new Promise(r=>setTimeout(r,700)); JSON.stringify(out)" }
```

Expected: `bars` is `0` and `numbers` is greater than `0`. **If `bars` is non-zero, a maximum leaked into the render path.**

A player with no ratings shows one empty state:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "let none = null; for (const u of ['u-001','u-002','u-003','u-004','u-005','u-006','u-007','u-008','u-009','u-010']) { const p = await TamrinData.playerProfile(u); if (!p.groups.length) { none = u; break; } } if (!none) 'no unrated player in fixtures'; else { TamrinPlayer.open(none); await new Promise(r=>setTimeout(r,700)); const b = document.getElementById('sheetBody'); JSON.stringify({ id: none, text: b.querySelector('.empty') ? b.querySelector('.empty').textContent : null, groupCards: b.querySelectorAll('.grp-card').length }); }" }
```

Expected: `text` contains `لا تقييمات بعد` and `groupCards` is `0`.

The «تقييمي» empty state appears for a player the mock "me" has not rated:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "let target = null; for (const u of ['u-002','u-003','u-004','u-005','u-006','u-007','u-008','u-009','u-010','u-011','u-012']) { const p = await TamrinData.playerProfile(u); if (p.groups.length && !p.my_ratings.length) { target = u; break; } } if (!target) 'every rated fixture has my rating'; else { TamrinPlayer.open(target); await new Promise(r=>setTimeout(r,700)); JSON.stringify({ id: target, mineNone: !!document.querySelector('.mine.none'), text: document.querySelector('.mine.none').textContent.trim() }); }" }
```

Expected: `mineNone` is `true` and `text` is `لم تُقيّم هذا اللاعب.`

Screenshot both widths and check RTL alignment, that attribute bars fill from the right, and that the two-column attribute grid collapses to one column on mobile:

```
mcp__Claude_Browser__computer { "action": "screenshot" }
mcp__Claude_Browser__resize_window { "preset": "mobile" }
mcp__Claude_Browser__computer { "action": "screenshot" }
mcp__Claude_Browser__resize_window { "preset": "desktop" }
```

- [ ] **Step 4: Commit**

```bash
git add assets/admin-player.js assets/admin-sheet.css
git commit -m "Render the player profile: per-group ratings, every rater, and their exact scores"
```

---

## Task 7: Delete a rating

**Files:**
- Modify: `assets/admin-player.js` (delete handlers, toast, `init()`)

**Interfaces:**
- Consumes: `TamrinData.deleteRating({ raterId, rateeId, workspaceId })` (Task 3); the `data-rater` / `data-workspace` attributes and `.confirm` markup (Task 6).
- Produces: no new public surface. `TamrinPlayer.reload()` is called after a successful delete.

- [ ] **Step 1: Add the toast and delete handlers**

In `assets/admin-player.js`, immediately before the `function init()` declaration, add:

```js
  /* ------------------------------------------------------- الحذف */

  let toastTimer = null;

  function toast(msg, bad) {
    clearTimeout(toastTimer);
    const old = document.querySelector('.sheet-toast');
    if (old) old.remove();
    const n = document.createElement('div');
    n.className = 'sheet-toast' + (bad ? ' bad' : '');
    n.setAttribute('role', 'status');
    n.textContent = msg;
    document.body.appendChild(n);
    toastTimer = setTimeout(() => n.remove(), 3200);
  }

  function showConfirm(row, on) {
    const c = row.querySelector('.confirm');
    if (!c) return;
    // صفّ واحد فقط في حالة تأكيد: تأكيدان مفتوحان يدعوان إلى حذف الخطأ
    if (on) {
      document.querySelectorAll('.rater .confirm').forEach((x) => { x.hidden = true; });
    }
    c.hidden = !on;
    if (on) {
      const yes = c.querySelector('.btn-del-yes');
      if (yes) yes.focus();
    }
  }

  /* الحذف لا يُرمَّم في الواجهة: يُعاد جلب الملف. تقييم المجموعة ومتوسّطاتها
     تتغيّر بحذف صفّ واحد، وترقيع DOM يُظهر رقمًا قديمًا واثقًا. */
  async function doDelete(row) {
    const raterId = row.dataset.rater;
    const workspaceId = row.dataset.workspace;
    const rateeId = currentId;
    if (!raterId || !workspaceId || !rateeId) return;

    row.classList.add('busy');
    try {
      await TamrinData.deleteRating({ raterId, rateeId, workspaceId });
      toast('حُذف التقييم.');
      await load(rateeId);
    } catch (e) {
      row.classList.remove('busy');
      showConfirm(row, false);
      toast('تعذّر حذف التقييم.', true);
    }
  }
```

- [ ] **Step 2: Bind the handlers in `init()`**

Replace:

```js
  function init() {
    $('sheetClose').addEventListener('click', close);
    $('sheetBackdrop').addEventListener('click', close);
  }
```

with:

```js
  function init() {
    $('sheetClose').addEventListener('click', close);
    $('sheetBackdrop').addEventListener('click', close);

    // مفوَّض: صفوف المقيّمين تُعاد بناءً في كل جلب
    $('sheetBody').addEventListener('click', (e) => {
      const row = e.target.closest('.rater');
      if (!row) return;
      if (e.target.closest('.del'))         { showConfirm(row, true);  return; }
      if (e.target.closest('.btn-del-no'))  { showConfirm(row, false); return; }
      if (e.target.closest('.btn-del-yes')) { doDelete(row); }
    });
  }
```

- [ ] **Step 3: Verify the delete flow**

With `USE_MOCK = true`, signed in, on a player with ratings:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinPlayer.open('<recorded-id>'); await new Promise(r=>setTimeout(r,700)); document.querySelector('.rater .del').click(); const row = document.querySelector('.rater'); JSON.stringify({ confirmVisible: !row.querySelector('.confirm').hidden, focusOnYes: document.activeElement.className === 'btn-del-yes' })" }
```

Expected: `{"confirmVisible":true,"focusOnYes":true}`

Cancel restores the row untouched:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const before = document.querySelectorAll('.rater').length; document.querySelector('.btn-del-no').click(); await new Promise(r=>setTimeout(r,120)); JSON.stringify({ confirmHidden: document.querySelector('.rater .confirm').hidden, sameCount: document.querySelectorAll('.rater').length === before })" }
```

Expected: `{"confirmHidden":true,"sameCount":true}`

Only one confirm can be open at a time:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const dels = [...document.querySelectorAll('.rater .del')]; if (dels.length < 2) 'need a group with 2+ raters — pick another id'; else { dels[0].click(); dels[1].click(); await new Promise(r=>setTimeout(r,120)); JSON.stringify({ openConfirms: [...document.querySelectorAll('.rater .confirm')].filter(c => !c.hidden).length }); }" }
```

Expected: `{"openConfirms":1}`

Confirm actually deletes, the overall is refetched, and the toast appears:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const p0 = TamrinPlayer.profile(); const before = TamrinRatings.totalRaterCount(p0); const g0 = TamrinRatings.sortGroups(p0.groups)[0]; const ovr0 = g0.overall; document.querySelector('.rater .del').click(); document.querySelector('.btn-del-yes').click(); await new Promise(r=>setTimeout(r,1200)); const p1 = TamrinPlayer.profile(); JSON.stringify({ before, after: TamrinRatings.totalRaterCount(p1), toast: (document.querySelector('.sheet-toast')||{}).textContent, refetched: p1 !== p0, overallBefore: ovr0, overallAfter: TamrinRatings.sortGroups(p1.groups)[0] ? TamrinRatings.sortGroups(p1.groups)[0].overall : null })" }
```

Expected: `after` is exactly `before - 1`; `toast` is `حُذف التقييم.`; `refetched` is `true`. `overallAfter` may or may not differ from `overallBefore` — both are fine, since removing one rater need not move a rounded average.

Failure path restores the row and reports honestly:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const real = TamrinData.deleteRating; TamrinData.deleteRating = async () => { throw new Error('boom'); }; const before = document.querySelectorAll('.rater').length; document.querySelector('.rater .del').click(); document.querySelector('.btn-del-yes').click(); await new Promise(r=>setTimeout(r,700)); const out = { count: document.querySelectorAll('.rater').length, sameCount: document.querySelectorAll('.rater').length === before, busyLeft: document.querySelectorAll('.rater.busy').length, toast: (document.querySelector('.sheet-toast')||{}).textContent, confirmHidden: document.querySelector('.rater .confirm').hidden }; TamrinData.deleteRating = real; JSON.stringify(out)" }
```

Expected: `sameCount` is `true`; `busyLeft` is `0`; `toast` is `تعذّر حذف التقييم.`; `confirmHidden` is `true`.

Deleting the last rating in a group removes the group and can empty the sheet:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "let target = null; for (const u of ['u-002','u-003','u-004','u-005','u-006','u-007','u-008','u-009','u-010','u-011','u-012','u-013','u-014','u-015']) { const p = await TamrinData.playerProfile(u); if (p.groups.length === 1 && p.groups[0].rater_count === 1) { target = u; break; } } if (!target) 'no single-rating fixture — verify by deleting every rating of one player manually'; else { TamrinPlayer.open(target); await new Promise(r=>setTimeout(r,700)); document.querySelector('.rater .del').click(); document.querySelector('.btn-del-yes').click(); await new Promise(r=>setTimeout(r,1200)); JSON.stringify({ id: target, groupCards: document.querySelectorAll('.grp-card').length, empty: (document.querySelector('#sheetBody .empty')||{}).textContent }); }" }
```

Expected: `groupCards` is `0` and `empty` contains `لا تقييمات بعد`.

Reload the page to restore the mock fixtures (the mock delete mutates an in-memory array), then revert `USE_MOCK`:

```bash
git diff assets/admin-data.js | grep -n 'USE_MOCK *='
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add assets/admin-player.js
git commit -m "Add per-rating delete with an in-row confirm and a refetch after success"
```

---

## Task 8: Real-data verification and the two open assumptions

**Files:**
- Modify: `supabase/admin-player-ratings.sql` (only if verification query 1 shows the scale is not `1..99`)
- Modify: `assets/admin-data.js` (only if the mock scale must change to match)

**Interfaces:**
- Consumes: everything above, plus the human's output from Task 2 Step 3.
- Produces: a verified feature, or a precise list of what disagreed.

- [ ] **Step 1: Confirm the SQL is deployed**

Ask the human for the output of verification queries 1–3 from `supabase/admin-player-ratings.sql` if it has not arrived. Do not guess.

- [ ] **Step 2: Correct the scale if the constraint disagrees**

If query 1 reports bounds other than `1..99`, change both constants in `supabase/admin-player-ratings.sql`:

```sql
  v_scale_min constant integer := 1;
  v_scale_max constant integer := 99;
```

and `MOCK_SCALE` in `assets/admin-data.js`:

```js
  const MOCK_SCALE = { min: 1, max: 99 };
```

Then have the human re-run the function definition. No JS or CSS change is needed — the UI reads `scale` from the payload.

- [ ] **Step 3: Settle the group-overall formula**

Compare query 3's `avg_of_overall` and `overall_of_avg` columns against what the app shows via `get_player_rating` for the same player and workspace.

- If `overall_of_avg` matches the app: no change; the implementation is correct.
- If `avg_of_overall` matches instead: in `admin_get_player_profile`, replace the `'overall'` key of each group with `round(avg(r.overall), 1)` computed in the `agg` CTE — add `avg(r.overall) as a_overall` to `agg` and use `round(a.a_overall, 1)` in place of the `player_rating_overall(...)` call for the group. Leave every per-rater `overall` exactly as it is. Record the outcome in the spec's §8.

- [ ] **Step 4: Real-data pass**

Confirm `USE_MOCK` is `!SUPABASE_ANON_KEY` and that `git diff` shows no temporary flag. Have the human sign in with a real admin account at `http://localhost:4173/admin.html`, then:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "const res = await TamrinData.users({ search: '', page: 1, pageSize: 8 }); JSON.stringify(res.rows.map(r => r.user_id))" }
```

Pick an id and open it:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "TamrinPlayer.open('<real-id>'); await new Promise(r=>setTimeout(r,1500)); const p = TamrinPlayer.profile(); JSON.stringify({ loaded: !!p, scale: p && p.scale, groups: p && p.groups.length, raters: p && TamrinRatings.totalRaterCount(p), mine: p && p.my_ratings.length, bodyError: document.getElementById('sheetBody').textContent.includes('تعذّر') })" }
```

Expected: `loaded` is `true`, `bodyError` is `false`, `scale` matches the deployed constants. Find a player with `groups >= 1` — ideally one rated in more than one group — and screenshot the sheet.

```
mcp__Claude_Browser__computer { "action": "screenshot" }
```

- [ ] **Step 5: Confirm the admin gate still rejects non-admins**

Have the human sign in with a valid **non-admin** account. Expected: login is refused with «هذا الحساب ليس حساب مشرف» — the existing `admin_overview` probe in `signIn` catches it, so the new RPCs are never reached. Then confirm the gate directly holds on the new function:

```
mcp__Claude_Browser__javascript_tool { "action": "javascript_exec", "text":
  "try { await TamrinData.playerProfile('<real-id>'); 'UNEXPECTED SUCCESS'; } catch (e) { e.message; }" }
```

Expected: `غير مصرّح` (from the `rpc()` helper's 401/403 mapping) or `لا توجد جلسة` if the refused login left no session. **`UNEXPECTED SUCCESS` is a security failure — stop and report it.**

- [ ] **Step 6: Verify one real delete and its audit row**

Only with the human's explicit go-ahead, and on a rating they are willing to lose. After deleting, have them run:

```sql
select actor_id, action, target_user_id, payload, created_at
from public.admin_audit_log
order by created_at desc limit 1;
```

Expected: one row with `action = 'delete_player_rating'`, `target_user_id` equal to the player, and `payload` containing all six attribute values plus `rater_id` and `workspace_id`.

- [ ] **Step 7: Final check and commit**

```bash
git status --porcelain
git diff --stat main...HEAD
```

Confirm: no stray `USE_MOCK = true`, no `supabase/.temp/`, and the changed files are exactly the nine in the File Structure table.

```bash
git add -A
git commit -m "Confirm the rating scale and group-overall formula against prod"
```

If nothing needed correcting, skip the commit and say so.

---

## Notes for the executing agent

- **The two `console.log`-based checks in Task 4 are temporary scaffolding.** Task 5 Step 4 removes the placeholder `onSelect`. Do not leave a `console.log` in the committed wiring.
- **`USE_MOCK` must never be committed as `true`.** Every task that flips it ends with a `git diff | grep 'USE_MOCK *='` check expecting no output. Match the assignment, not every mention — `if (USE_MOCK)` lines are legitimate. Honour it.
- **Do not hardcode a rating maximum anywhere.** Task 6 Step 3 has a check that fails if you do.
- **Do not reimplement the overall formula.** If a number looks wrong, the fix is in the SQL's use of `player_rating_overall`, not a JS calculation.
- If mock fixtures never produce a needed shape (a player with no ratings, a group with 2+ raters, a single-rating player), adjust the seeds in Task 3 rather than skipping the verification.
