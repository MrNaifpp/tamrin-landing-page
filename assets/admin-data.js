/* =========================================================================
   تمرين — طبقة البيانات للوحة التحكم
   ---------------------------------------------------------------------
   هذا الملف هو نقطة الوصل الوحيدة بين الواجهة والخادم. الواجهة في
   admin.js لا تعرف من أين تأتي البيانات — تستدعي TamrinData فقط.

   المرحلة الحالية: بيانات تجريبية (MOCK) تعمل بدون خادم.
   المرحلة القادمة: استبدال أجسام الدوال في قسم «التنفيذ» بنداءات
   Supabase RPC. شكل المُخرجات لا يتغيّر، فلا تحتاج الواجهة أي تعديل.

   عقد البيانات المتوقّع من الخادم لاحقًا:
     signIn(email, password) -> { ok, error }
     signOut()               -> void
     restoreSession()        -> session | null
     overview()              -> { totalUsers, newUsersThisWeek,
                                  activeEvents, totalParticipants, revenue }
     users({ search, page, pageSize })  -> { rows, total }
     activeEvents()          -> [ event ]
     playerProfile(userId)   -> { user, scale, my_ratings, groups, activity }
     deleteRating({ raterId, rateeId, workspaceId }) -> { deleted }
   ========================================================================= */

(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
     إعدادات الخادم — تُملأ في مرحلة الربط.
     المفتاح المسموح به هنا هو anon فقط. لا تضع service_role إطلاقًا:
     الموقع ثابت وعام، وأي مفتاح هنا يصل إلى كل زائر.
     ------------------------------------------------------------------ */
  const SUPABASE_URL = 'https://hzsxwnmbdkrmipjtfzlp.supabase.co';
  // مفتاح anon — عام بطبيعته ومقصود وصوله إلى المتصفح. الحماية كلها في RLS
  // وفي دوال admin_* التي ترفض غير المشرفين. لا تضع service_role هنا أبدًا.
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6c3h3bm1iZGtybWlwanRmemxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2NTcwOTksImV4cCI6MjEwMTIzMzA5OX0.Opjcn6HMOWdw07RPDEXGaytKziAsnvvJSzpzuw8NiPY';
  const USE_MOCK = !SUPABASE_ANON_KEY;     // يتحوّل تلقائيًا عند وضع المفتاح

  /* ==================================================================
     بيانات تجريبية
     ================================================================== */
  const FIRST = ['نايف', 'عبدالله', 'محمد', 'سلطان', 'فهد', 'خالد', 'تركي', 'ريان',
                 'عمر', 'بدر', 'يزيد', 'مشعل', 'سعود', 'راكان', 'أنس', 'زياد',
                 'ماجد', 'وليد', 'هيثم', 'صالح'];
  const LAST = ['الشهراني', 'القحطاني', 'العتيبي', 'الدوسري', 'الغامدي', 'الحربي',
                'المطيري', 'الزهراني', 'السبيعي', 'البقمي'];
  const POSITIONS = ['مهاجم', 'وسط', 'مدافع', 'حارس', 'جناح'];
  const WORKSPACES = ['شباب الحي', 'دفعة 2015', 'زملاء العمل', 'نادي الأربعاء', 'عيال الفريج'];

  // معرّفات للمجموعات: الحمولة الحقيقية تُرجع workspace_id، والحذف يحتاجه.
  const MOCK_WORKSPACES = WORKSPACES.map((name, i) => ({ id: `w-${i + 1}`, name }));

  // نفس الحدود المُثبَّتة في admin_get_player_profile. تُرسل في الحمولة
  // لأنّ الواجهة لا يجوز أن تُثبّت مقامًا للأشرطة.
  const MOCK_SCALE = { min: 1, max: 99 };

  const DAY = 86400000;
  const now = Date.now();

  function seeded(i) {           // عشوائية ثابتة — نفس البيانات في كل تحميل
    const x = Math.sin(i * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  }

  const MOCK_USERS = Array.from({ length: 47 }, (_, i) => {
    const first = FIRST[Math.floor(seeded(i + 1) * FIRST.length)];
    const last = LAST[Math.floor(seeded(i + 31) * LAST.length)];
    const hasPay = seeded(i + 77) > 0.28;
    return {
      user_id: `u-${String(i + 1).padStart(3, '0')}`,
      name: `${first} ${last}`,
      postion: POSITIONS[Math.floor(seeded(i + 13) * POSITIONS.length)],
      stc_pay_number: hasPay
        ? '05' + String(Math.floor(seeded(i + 53) * 90000000) + 10000000)
        : null,
      avatar_url: null,
      created_at: new Date(now - Math.floor(seeded(i + 7) * 96) * DAY).toISOString(),
      workspace_count: 1 + Math.floor(seeded(i + 91) * 3)
    };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));

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
    // «أنا» أقيّم بعض اللاعبين، حتى لا تكون بطاقة «تقييمي» فارغة دائمًا
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

  const LOCATIONS = ['ملعب الروضة', 'ملاعب النخبة — حي الياسمين', 'صالة بادل تايم',
                     'ملعب الملقا', 'أكاديمية الصقور', 'ملاعب قرطبة', 'نادي حطين'];

  // بداية اليوم الحالي — حتى تقع المواعيد في ساعات المساء لا في وقت التحميل
  const dayStart = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); })();

  const MOCK_EVENTS = Array.from({ length: 9 }, (_, i) => {
    const capacity = [10, 12, 14, 16, 22][Math.floor(seeded(i + 3) * 5)];
    const joined = Math.max(3, Math.floor(seeded(i + 41) * capacity));
    const price = [25, 30, 35, 40, 45, 60][Math.floor(seeded(i + 17) * 6)];
    const hour = [18, 19, 20, 21, 22][Math.floor(seeded(i + 37) * 5)];
    const start = dayStart + (1 + Math.floor(seeded(i + 23) * 12)) * DAY + hour * 3600000;
    return {
      id: `e-${String(i + 1).padStart(3, '0')}`,
      // أسماء محايدة — المواعيد عشوائية فلا تُقيَّد بيوم أو وقت
      name: ['تمرين الأسبوع', 'مباراة ودية', 'تمرين اللياقة',
             'مباراة الحي', 'بادل', 'تمرين مفتوح'][Math.floor(seeded(i + 5) * 6)],
      workspace_name: WORKSPACES[Math.floor(seeded(i + 11) * WORKSPACES.length)],
      creator_name: `${FIRST[Math.floor(seeded(i + 47) * FIRST.length)]} `
                  + `${LAST[Math.floor(seeded(i + 83) * LAST.length)]}`,
      location: LOCATIONS[Math.floor(seeded(i + 19) * LOCATIONS.length)],
      start_date: new Date(start).toISOString(),
      end_date: new Date(start + 7200000).toISOString(),
      price_per_person: price,
      total_price: price * joined,
      max_participants: capacity,
      participant_count: joined,
      waitlist_count: joined >= capacity ? Math.floor(seeded(i + 61) * 4) : 0,
      paid_count: Math.floor(joined * (0.4 + seeded(i + 67) * 0.6)),
      registration_locked: seeded(i + 71) > 0.78,
      published_at: new Date(now - Math.floor(seeded(i + 29) * 6) * DAY).toISOString()
    };
  }).sort((a, b) => a.start_date.localeCompare(b.start_date));

  /* ==================================================================
     التنفيذ — استبدل الأجسام هنا عند الربط بالخادم
     ================================================================== */

  const SESSION_KEY = 'tamrin.admin.session';
  let session = null;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function persist() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
  }

  async function signIn(email, password) {
    if (USE_MOCK) {
      await wait(420);                                  // محاكاة زمن الشبكة
      if (!email || !password) {
        return { ok: false, error: 'أدخل البريد وكلمة المرور.' };
      }
      session = { email, token: 'mock-token', mock: true };
      persist();
      return { ok: true };
    }

    let res;
    try {
      res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
    } catch (e) {
      return { ok: false, error: 'تعذّر الاتصال بالخادم.' };
    }

    if (!res.ok) return { ok: false, error: 'البريد أو كلمة المرور غير صحيحة.' };

    const data = await res.json();
    session = { email, token: data.access_token, refresh: data.refresh_token };

    // التحقق من الصلاحية فورًا: الحساب قد يكون سليمًا لكنه ليس مشرفًا.
    // الرفض يأتي من الخادم لا من الواجهة — الدوال ترفض غير المشرف.
    try {
      await rpc('admin_overview');
    } catch (e) {
      signOut();   // يمسح الجلسة المخزّنة أيضًا، لا المتغيّر فقط
      return { ok: false, error: 'هذا الحساب ليس حساب مشرف.' };
    }

    persist();
    return { ok: true };
  }

  /** تجديد الجلسة عند انتهاء صلاحية الرمز (ساعة واحدة افتراضيًا). */
  async function refresh() {
    if (!session || !session.refresh) return false;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh })
    });
    if (!res.ok) return false;
    const data = await res.json();
    session.token = data.access_token;
    session.refresh = data.refresh_token;
    persist();
    return true;
  }

  function signOut() {
    session = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function restoreSession() {
    if (session) return session;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) session = JSON.parse(raw);
    } catch (e) { session = null; }
    return session;
  }

  function isMock() { return USE_MOCK; }

  /**
   * نداء RPC موحّد. يُجدّد الرمز مرة واحدة عند 401 ثم يعيد المحاولة.
   * المفتاح المُرسل هو anon فقط — الصلاحية تأتي من رمز الجلسة.
   */
  async function rpc(fn, args, retried) {
    if (!session) throw new Error('لا توجد جلسة');

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args || {})
    });

    if (res.status === 401 && !retried && await refresh()) {
      return rpc(fn, args, true);
    }
    // 403 أو خطأ الدالة نفسها (42501) = ليس مشرفًا
    if (res.status === 401 || res.status === 403) throw new Error('غير مصرّح');
    if (!res.ok) throw new Error('تعذّر جلب البيانات');

    return res.json();
  }

  async function overview() {
    if (USE_MOCK) {
      await wait(260);
      const weekAgo = now - 7 * DAY;
      return {
        totalUsers: MOCK_USERS.length,
        newUsersThisWeek: MOCK_USERS.filter((u) => Date.parse(u.created_at) >= weekAgo).length,
        activeEvents: MOCK_EVENTS.length,
        totalParticipants: MOCK_EVENTS.reduce((s, e) => s + e.participant_count, 0),
        revenue: MOCK_EVENTS.reduce((s, e) => s + e.total_price, 0)
      };
    }
    return rpc('admin_overview');
  }

  async function users({ search = '', page = 1, pageSize = 12 } = {}) {
    if (USE_MOCK) {
      await wait(200);
      const q = search.trim();
      const filtered = q
        ? MOCK_USERS.filter((u) => u.name.includes(q) || (u.stc_pay_number || '').includes(q))
        : MOCK_USERS;
      const start = (page - 1) * pageSize;
      return { rows: filtered.slice(start, start + pageSize), total: filtered.length };
    }
    return rpc('admin_list_users', {
      p_search: search, p_page: page, p_page_size: pageSize
    });
  }

  async function activeEvents() {
    if (USE_MOCK) {
      await wait(240);
      return MOCK_EVENTS;
    }
    return rpc('admin_list_active_events');
  }

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

  global.TamrinData = {
    signIn, signOut, restoreSession, isMock,
    overview, users, activeEvents,
    playerProfile, deleteRating
  };
})(window);
