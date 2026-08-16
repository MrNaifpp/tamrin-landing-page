/* =========================================================================
   تمرين — منطق لوحة التحكم
   يعتمد على TamrinData فقط (assets/admin-data.js). لا يعرف شيئًا عن مصدر
   البيانات، فاستبدال المصدر لا يمسّ هذا الملف.
   ========================================================================= */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------ أدوات */

  /** الأسماء تأتي من المستخدمين — تُهرَّب دائمًا قبل الإدراج. */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // أرقام لاتينية لتطابق بقيّة الموقع
  const nf = new Intl.NumberFormat('ar-SA-u-nu-latn');
  const num = (n) => nf.format(n ?? 0);

  const dateFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
  const whenFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit'
  });
  const asDate = (iso) => dateFmt.format(new Date(iso));
  const asWhen = (iso) => whenFmt.format(new Date(iso));

  const initials = (name) => String(name || '؟').trim().charAt(0);

  function colspanRow(tbody, cols, html) {
    tbody.innerHTML = `<tr><td colspan="${cols}"><div class="empty">${html}</div></td></tr>`;
  }

  /* ------------------------------------------------------ بوابة الدخول */

  const loginWrap = $('login');
  const dash = $('dash');

  function showDash(session) {
    loginWrap.hidden = true;
    loginWrap.style.display = 'none';
    dash.hidden = false;
    $('whoEmail').textContent = session.email || '';
    $('demoBanner').hidden = !TamrinData.isMock();
    loadAll();
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('loginBtn');
    const err = $('loginError');
    err.classList.remove('on');
    btn.disabled = true;
    btn.textContent = 'جارٍ الدخول…';

    const res = await TamrinData.signIn($('email').value.trim(), $('password').value);

    btn.disabled = false;
    btn.textContent = 'دخول';
    if (!res.ok) {
      err.textContent = res.error || 'تعذّر الدخول.';
      err.classList.add('on');
      return;
    }
    showDash(TamrinData.restoreSession());
  });

  $('signOutBtn').addEventListener('click', () => {
    TamrinData.signOut();
    location.reload();
  });

  /* --------------------------------------------------------- الأرقام */

  async function loadStats() {
    const cards = document.querySelectorAll('.stat-card');
    try {
      const o = await TamrinData.overview();
      $('sUsers').textContent = num(o.totalUsers);
      $('sUsersSub').innerHTML = o.newUsersThisWeek > 0
        ? `<span class="up">+${num(o.newUsersThisWeek)}</span> هذا الأسبوع`
        : 'لا انضمام هذا الأسبوع';
      $('sEvents').textContent = num(o.activeEvents);
      $('sParts').textContent = num(o.totalParticipants);
      $('sRev').textContent = num(o.revenue);
    } catch (e) {
      $('sUsersSub').textContent = 'تعذّر الجلب';
    } finally {
      cards.forEach((c) => c.classList.remove('loading'));
    }
  }

  /* ----------------------------------------------------- المستخدمون */

  const PAGE_SIZE = 12;
  let page = 1;
  let search = '';
  let total = 0;

  function userRow(u) {
    const pay = u.stc_pay_number
      ? `<span class="pay" dir="ltr">${esc(u.stc_pay_number)}</span>`
      : '<span class="pay-none">—</span>';
    return `
      <tr>
        <td>
          <span class="who">
            <span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span>
            <b>${esc(u.name)}</b>
          </span>
        </td>
        <td><span class="tag tag-flat">${esc(u.postion || '—')}</span></td>
        <td class="num">${pay}</td>
        <td class="num">${num(u.workspace_count)}</td>
        <td class="num">${asDate(u.created_at)}</td>
      </tr>`;
  }

  async function loadUsers() {
    const body = $('usersBody');
    colspanRow(body, 5, '<span class="skel" style="width:180px;margin-inline:auto"></span>');
    try {
      const res = await TamrinData.users({ search, page, pageSize: PAGE_SIZE });
      total = res.total;

      if (!res.rows.length) {
        colspanRow(body, 5, search
          ? `<b>لا نتائج</b>لا يوجد مستخدم يطابق «${esc(search)}».`
          : '<b>لا مستخدمين بعد</b>لم ينضم أحد حتى الآن.');
      } else {
        body.innerHTML = res.rows.map(userRow).join('');
      }

      $('usersCount').textContent = `${num(total)} مستخدم`;
      const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
      const to = Math.min(page * PAGE_SIZE, total);
      $('usersInfo').textContent = `${num(from)}–${num(to)} من ${num(total)}`;
      $('prevBtn').disabled = page <= 1;
      $('nextBtn').disabled = to >= total;
    } catch (e) {
      colspanRow(body, 5, '<b>تعذّر جلب المستخدمين</b>تحقّق من الاتصال وحاول مجددًا.');
    }
  }

  let searchTimer;
  $('userSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => { search = v; page = 1; loadUsers(); }, 220);
  });

  $('prevBtn').addEventListener('click', () => { if (page > 1) { page--; loadUsers(); } });
  $('nextBtn').addEventListener('click', () => { page++; loadUsers(); });

  /* ------------------------------------------------------ الفعاليات */

  function eventRow(ev) {
    const cap = ev.max_participants;
    const pct = cap ? Math.min(100, Math.round((ev.participant_count / cap) * 100)) : 0;
    const full = cap && ev.participant_count >= cap;

    const seats = cap
      ? `<span class="meter">
           <span class="bar"><i class="${full ? 'full' : ''}" style="width:${pct}%"></i></span>
           <span class="txt">${num(ev.participant_count)}/${num(cap)}</span>
         </span>`
      : `<span class="meter"><span class="txt">${num(ev.participant_count)}</span></span>`;

    const wait = ev.waitlist_count > 0
      ? ` <span class="tag tag-peach">+${num(ev.waitlist_count)} انتظار</span>` : '';

    const paidAll = ev.paid_count >= ev.participant_count;
    const pay = `<span class="tag ${paidAll ? 'tag-green' : 'tag-flat'}">${num(ev.paid_count)}/${num(ev.participant_count)}</span>`;

    const reg = ev.registration_locked
      ? '<span class="tag tag-flat">مقفل</span>'
      : '<span class="tag tag-lime">مفتوح</span>';

    return `
      <tr>
        <td><b>${esc(ev.name)}</b>${wait}</td>
        <td>${esc(ev.workspace_name)}</td>
        <td>${esc(ev.location)}</td>
        <td class="num">${asWhen(ev.start_date)}</td>
        <td>${seats}</td>
        <td class="num">${num(ev.price_per_person)} ريال</td>
        <td>${pay}</td>
        <td>${reg}</td>
      </tr>`;
  }

  async function loadEvents() {
    const body = $('eventsBody');
    colspanRow(body, 8, '<span class="skel" style="width:180px;margin-inline:auto"></span>');
    try {
      const rows = await TamrinData.activeEvents();
      if (!rows.length) {
        colspanRow(body, 8, '<b>لا فعاليات نشطة</b>كل الفعاليات إمّا انتهت أو لم تُنشر.');
      } else {
        body.innerHTML = rows.map(eventRow).join('');
      }
      $('eventsCount').textContent = `${num(rows.length)} فعالية`;
    } catch (e) {
      colspanRow(body, 8, '<b>تعذّر جلب الفعاليات</b>تحقّق من الاتصال وحاول مجددًا.');
    }
  }

  /* --------------------------------------------------------- الأقسام */

  function selectTab(which) {
    const users = which === 'users';
    $('tabUsers').setAttribute('aria-selected', String(users));
    $('tabEvents').setAttribute('aria-selected', String(!users));
    $('panelUsers').hidden = !users;
    $('panelEvents').hidden = users;
  }
  $('tabUsers').addEventListener('click', () => selectTab('users'));
  $('tabEvents').addEventListener('click', () => selectTab('events'));

  /* ----------------------------------------------------------- إقلاع */

  function loadAll() {
    loadStats();
    loadUsers();
    loadEvents();
  }

  const existing = TamrinData.restoreSession();
  if (existing) showDash(existing);
})();
