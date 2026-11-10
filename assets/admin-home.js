/* =========================================================================
   تمرين — لوحة التحكم: تبويب «نظرة عامة»
   يرسم ما تُرجعه TamrinData.homeInsights() (الدالة admin_home_insights).
   لا يجلب شيئًا بنفسه: admin.js يجلب ثم ينادي TamrinHome.render.
   ========================================================================= */

(function (global) {
  'use strict';

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const nf = new Intl.NumberFormat('ar-SA-u-nu-latn');
  const nf1 = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 1 });
  const num = (n) => nf.format(n ?? 0);
  const dayFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' });
  const asDay = (iso) => dayFmt.format(new Date(iso));

  /** نسبة مئوية صحيحة بين 0 و100. القسمة على صفر تعطي 0. */
  const pct = (part, whole) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

  const DAY = 86400000;
  function ago(iso) {
    const days = Math.floor((Date.now() - Date.parse(iso)) / DAY);
    if (days <= 0) return 'اليوم';
    if (days === 1) return 'أمس';
    if (days === 2) return 'قبل يومين';
    if (days <= 10) return `قبل ${num(days)} أيام`;
    return `قبل ${num(days)} يومًا`;
  }

  /** «3 لاعبين» / «12 لاعبًا» */
  function players(n) {
    if (n === 1) return 'لاعبًا واحدًا';
    if (n === 2) return 'لاعبَين';
    return n >= 3 && n <= 10 ? `${num(n)} لاعبين` : `${num(n)} لاعبًا`;
  }

  const panel = (title, sub, body, tools = '') => `
    <section class="panel">
      <div class="panel-head">
        <div><h2>${title}</h2><span class="count num">${sub}</span></div>${tools}
      </div>${body}
    </section>`;

  const row = (label, small, p, value) => `
    <li><span>${label}${small ? `<small>${small}</small>` : ''}</span>
        <span class="bar"><i style="width: ${p}%"></i></span>
        <span class="pc">${value}</span></li>`;

  const split = (parts) => `
    <div class="split" aria-hidden="true">${parts.map((p) =>
      `<i class="${p.c}" style="flex: ${p.n}"></i>`).join('')}</div>
    <div class="keys num">${parts.map((p) =>
      `<span><i class="${p.c}"></i>${p.label} <b>${num(p.n)}</b></span>`).join('')}</div>`;

  /** أعمدة 12 أسبوعًا. cols: [{ label, parts: [{ c, n }] }] من الأقدم إلى الأحدث. */
  function weekBars(cols, starts, height, short) {
    const max = Math.max(1, ...cols.map((c) => c.parts.reduce((s, p) => s + p.n, 0)));
    const bars = cols.map((c, i) => `
      <div class="col${i === cols.length - 1 ? ' now' : ''}"><b>${num(c.total)}</b>${c.parts.map((p) =>
        (p.n > 0 ? `<i class="${p.c}" style="height: ${Math.max(2, Math.round((p.n / max) * height))}px"></i>` : '')).join('')}</div>`).join('');
    const axis = starts.map((s, i) => {
      if (i === starts.length - 1) return '<span class="now">آخر 7 أيام</span>';
      return `<span>${i % 4 === 0 ? asDay(s) : ''}</span>`;
    }).join('');
    return `<div class="wk${short ? ' short' : ''} num">${bars}</div>
            <div class="wk-x num" aria-hidden="true">${axis}</div>`;
  }

  /* --------------------------------------------------------- التطبيق */

  const FEATURE_NAMES = { lineup: 'التشكيلة' };

  function featuresPanel(f) {
    const rows = [
      ['فعاليات متكررة أسبوعيًا', '', pct(f.recurring, f.events)],
      ['رابط الخريطة', '', pct(f.mapLink, f.events)],
      ['نشر التشكيلة', '', pct(f.lineup, f.events)],
      ['تقييم اللاعبين', 'من اللاعبين النشطين', pct(f.raters, f.players)],
      ['إضافة ضيوف', 'من المقاعد', pct(f.guestSeats, f.seats)],
      ['الموافقة اليدوية', '', pct(f.manual, f.events)]
    ].sort((a, b) => b[2] - a[2]);

    const fb = (f.feedback || []).map((x) =>
      `آراء المستخدمين في ${esc(FEATURE_NAMES[x.feature] || x.feature)}: <b>${nf1.format(x.avg)} من 5</b> (${num(x.count)} رأيًا).`
    ).join(' ');

    return panel('استخدام المزايا', `من ${num(f.events)} فعالية في آخر 30 يومًا`, `
      <div class="ov-body">
        <ul class="rows num">${rows.map((r) => row(r[0], r[1], r[2], `${num(r[2])}%`)).join('')}</ul>
        ${fb ? `<p class="ov-foot num">${fb}</p>` : ''}
      </div>`);
  }

  function reachPanel(r) {
    const tried = r.sent7 + r.failed7;
    const both = r.ios + r.web;
    return panel('الوصول إلى المستخدمين', 'الإشعارات وفتح التطبيق', `
      <div class="ov-body">
        <ul class="rows num">
          ${row('الإشعارات مفعّلة', `${num(r.pushUsers)} من ${num(r.users)} مستخدمًا`, pct(r.pushUsers, r.users), `${num(pct(r.pushUsers, r.users))}%`)}
          ${row('أُرسلت الإشعارات بنجاح', `${num(r.sent7)} من ${num(tried)} في آخر 7 أيام`, pct(r.sent7, tried), `${num(pct(r.sent7, tried))}%`)}
        </ul>
        <div class="gap-top">
          <span class="lbl">آخر فتح للتطبيق (لمن فعّل الإشعارات)</span>
          ${split([
            { c: 'c-act', n: r.openToday, label: 'آخر 24 ساعة' },
            { c: 'c-mint', n: r.openWeek, label: 'آخر 7 أيام' },
            { c: 'c-gone', n: r.openOlder, label: 'أقدم' }
          ])}
        </div>
        <p class="ov-foot num">المنصة: <b>${num(pct(r.ios, both))}%</b> على الآيفون و<b>${num(pct(r.web, both))}%</b> على الويب.</p>
      </div>`);
  }

  /* ------------------------------------------------------ المستخدمون */

  function lifePanel(l) {
    const boxes = [
      { c: 'c-none', n: l.noGroup, t: 'بلا مجموعة', d: 'أنشأ حسابًا ولم يدخل أي مجموعة.' },
      { c: 'c-idle', n: l.notRegistered, t: 'لم يسجّل بعد', d: 'في مجموعة، ولم يسجّل في أي فعالية.' },
      { c: 'c-act', n: l.active, t: 'نشِط', d: 'سجّل في فعالية خلال آخر 14 يومًا.' },
      { c: 'c-slip', n: l.slipping, t: 'بدأ يغيب', d: 'آخر تسجيل له قبل 15 إلى 30 يومًا.' },
      { c: 'c-gone', n: l.gone, t: 'منقطع', d: 'لم يسجّل منذ أكثر من 30 يومًا.' }
    ];
    const fams = [
      ['لم يبدأوا', l.noGroup + l.notRegistered],
      ['يلعبون', l.active],
      ['يبتعدون', l.slipping + l.gone]
    ];
    const shown = boxes.filter((b) => b.n > 0);

    return panel('أين مستخدموك الآن؟', `${num(l.total)} مستخدمًا · كل مستخدم في خانة واحدة فقط`, `
      <div class="ov-body">
        <div class="life-fam" aria-hidden="true">${fams.filter((f) => f[1] > 0).map((f) =>
          `<span style="flex: ${f[1]}"><b>${f[0]}</b><em> · ${num(f[1])}</em></span>`).join('')}</div>
        <div class="life-bar num" role="img" aria-label="توزيع المستخدمين على خمس خانات">${shown.map((b) => {
          const p = pct(b.n, l.total);
          return `<i class="${b.c}" style="flex: ${b.n}">${p >= 6 ? `${num(p)}%` : ''}</i>`;
        }).join('')}</div>
        <div class="life-keys">${boxes.map((b) => `
          <div class="life-key">
            <span class="t"><i class="${b.c}"></i>${b.t}</span>
            <span class="n num">${num(b.n)} <small>${num(pct(b.n, l.total))}%</small></span>
            <span class="d">${b.d}</span>
          </div>`).join('')}</div>
      </div>`);
  }

  function journeyPanel(j) {
    const steps = [
      ['أنشأ حسابًا', j.signups],
      ['دخل مجموعة', j.joined],
      ['سجّل في فعالية', j.registered],
      ['سجّل مرة ثانية', j.registeredTwice]
    ];
    const drops = steps.slice(1).map((s, i) => steps[i][1] - s[1]);
    const worst = Math.max(...drops);

    let html = '';
    steps.forEach((s, i) => {
      if (i > 0) {
        const d = drops[i - 1];
        html += `<div class="fun-drop num${d === worst && d > 0 ? ' big' : ''}"><span>${num(d)} توقفوا هنا</span></div>`;
      }
      const p = pct(s[1], j.signups);
      html += `<div class="fun-step"><span>${s[0]}</span>
        <span class="track"><i class="num" style="width: ${Math.max(p, 9)}%">${num(s[1])}</i></span>
        <span class="pc num">${num(p)}%</span></div>`;
    });

    return panel('رحلة المستخدم الجديد', `${num(j.signups)} أنشؤوا حسابًا خلال آخر 30 يومًا`, `
      <div class="ov-body">
        ${j.signups > 0 ? `<div class="fun">${html}</div>` : '<p class="ov-empty">لا حسابات جديدة في آخر 30 يومًا.</p>'}
        ${j.joined > 0 ? `<p class="ov-foot num"><b>${num(pct(j.joinedFirstHour, j.joined))}%</b> ممن دخلوا مجموعة دخلوها في أول ساعة بعد إنشاء الحساب.</p>` : ''}
      </div>`);
  }

  function noGroupPanel(g, total) {
    return panel('بلا مجموعة', 'أنشؤوا حسابًا وليسوا في أي مجموعة', `
      <div class="ov-body">
        <div class="big-n"><b class="num">${num(g.total)}</b><span class="num">مستخدمًا · ${num(pct(g.total, total))}% من الكل</span></div>
        <span class="lbl">منذ متى أنشؤوا الحساب؟</span>
        ${split([
          { c: 'c-ink', n: g.d7, label: 'آخر 7 أيام' },
          { c: 'c-none', n: g.d30, label: 'من 8 إلى 30 يومًا' },
          { c: 'c-gone', n: g.older, label: 'أقدم من شهر' }
        ])}
        <ul class="facts">
          <li><b class="num">${num(g.opened7)}</b><span>فتحوا التطبيق خلال آخر 7 أيام<small>ما زالوا مهتمين، وهذا أفضل وقت للتواصل معهم.</small></span></li>
          <li><b class="num">${num(g.reachable)}</b><span>تصلهم الإشعارات<small>يمكن تذكيرهم بإشعار.</small></span></li>
        </ul>
      </div>`,
      `<button type="button" class="ov-go" data-go="nogroup">اعرض القائمة
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
       </button>`);
  }

  const ACTIONS = [
    ['open', 'فتح التطبيق'],
    ['register', 'سجّل في فعالية'],
    ['rate', 'قيّم لاعبًا'],
    ['decline', 'اعتذر عن فعالية'],
    ['join', 'دخل مجموعة'],
    ['create', 'أنشأ فعالية'],
    ['signup', 'أنشأ حسابًا']
  ];

  function activityPanel(a, totalUsers) {
    const weeks = a.weeks || [];
    const cols = weeks.map((w) => ({
      total: w.total,
      parts: [{ c: 'c-lime', n: Math.min(w.first, w.total) }, { c: 'c-act', n: Math.max(w.total - w.first, 0) }]
    }));
    const first7 = weeks.length ? weeks[weeks.length - 1].first : 0;

    let change = '';
    if (a.prev7 > 0) {
      const d = Math.round(((a.active7 - a.prev7) / a.prev7) * 100);
      if (d !== 0) change = `<small${d < 0 ? ' class="down"' : ''}>${d > 0 ? '▲' : '▼'} ${num(Math.abs(d))}%</small>`;
    }

    const acts = ACTIONS.map(([k, label]) => [label, (a.actions || {})[k] || 0]).sort((x, y) => y[1] - x[1]);

    const back = pct(a.prevMonthBack, a.prevMonth);
    const foot = a.prevMonth > 0
      ? `<p class="ov-foot num"><b>${num(back)}%</b> ممن نشطوا الشهر الماضي نشطوا هذا الشهر أيضًا${
          a.olderMonth > 0 ? ` (كانت ${num(pct(a.olderMonthBack, a.olderMonth))}%)` : ''}.</p>`
      : '';

    return panel('نشاط المستخدمين',
      'من قام بأي حركة في التطبيق: فتحه، سجّل، قيّم، اعتذر، دخل مجموعة، أنشأ فعالية', `
      <div class="ov-body">
        <div class="act">
          <div>
            ${weekBars(cols, weeks.map((w) => w.start), 140)}
            ${foot}
          </div>
          <div class="mini">
            <div>
              <span class="lbl">مستخدمون نشطون في آخر 7 أيام</span>
              <div class="v num">${num(a.active7)} ${change}</div>
              <div class="s num">${num(pct(a.active7, totalUsers))}% من كل المستخدمين. منهم ${num(first7)} هذا أول نشاط لهم.</div>
            </div>
            <div>
              <span class="lbl">ماذا فعلوا في آخر 7 أيام؟</span>
              <ul class="rows acts num">${acts.map((x) => row(x[0], '', pct(x[1], a.active7), num(x[1]))).join('')}</ul>
            </div>
          </div>
        </div>
      </div>`,
      `<div class="keys">
         <span><i class="c-act"></i>نشطوا من قبل</span>
         <span><i class="c-lime"></i>أول نشاط لهم</span>
       </div>`);
  }

  /* --------------------------------------------------- تقييم اللاعبين */

  function ratingPanels(r) {
    if (!r.ratings) {
      return panel('التفاعل مع التقييم', 'لا تقييمات بعد', '<p class="ov-empty">لم يقيّم أحدٌ أي لاعب حتى الآن.</p>');
    }
    const weeks = r.weeks || [];
    const cols = weeks.map((w) => ({ total: w.count, parts: [{ c: 'c-ink', n: w.count }] }));

    const main = panel('التفاعل مع التقييم', r.since ? `منذ أول تقييم في ${asDay(r.since)}` : '', `
      <div class="ov-body">
        <div class="life-keys">
          <div class="life-key"><span class="t">قيّموا لاعبًا</span>
            <span class="n num">${num(r.raters)} <small>${num(pct(r.raters, r.members))}%</small></span>
            <span class="d">من أعضاء المجموعات قيّموا لاعبًا واحدًا على الأقل.</span></div>
          <div class="life-key"><span class="t">حصلوا على تقييم</span>
            <span class="n num">${num(r.rated)} <small>${num(pct(r.rated, r.members))}%</small></span>
            <span class="d">من أعضاء المجموعات قيّمهم لاعب آخر.</span></div>
          <div class="life-key"><span class="t">عدد التقييمات</span>
            <span class="n num">${num(r.ratings)}</span>
            <span class="d num">منها ${num(r.ratings7)} في آخر 7 أيام.</span></div>
          <div class="life-key"><span class="t">لكل مقيّم</span>
            <span class="n num">${nf1.format(r.perRater)} <small>لاعبين</small></span>
            <span class="d">متوسط من يقيّمهم الشخص الواحد.</span></div>
        </div>
        <div class="act gap-top">
          <div>
            <span class="lbl">تقييمات جديدة كل أسبوع</span>
            ${weekBars(cols, weeks.map((w) => w.start), 96, true)}
          </div>
          <div class="mini">
            <div>
              <span class="lbl">كم شخصًا قيّم كل لاعب؟</span>
              ${split([
                { c: 'c-gone', n: r.coverNone, label: 'لا أحد' },
                { c: 'c-mint', n: r.coverFew, label: 'واحد أو اثنان' },
                { c: 'c-act', n: r.coverMany, label: '3 فأكثر' }
              ])}
            </div>
            <div>
              <span class="lbl">هل يعود المقيّم ليقيّم مرة أخرى؟</span>
              <div class="v num">${num(pct(r.repeatRaters, r.raters))}%</div>
              <div class="s">من المقيّمين قيّموا في أكثر من أسبوع. الباقون قيّموا في أسبوع واحد فقط.</div>
            </div>
          </div>
        </div>
      </div>`);

    const groups = panel('التقييم في المجموعات',
      `${num(r.groupsRating)} من ${num(r.groupsTotal)} مجموعة فيها تقييم واحد على الأقل`, `
      <div class="table-scroll"><table class="data tight">
        <thead><tr><th scope="col">المجموعة</th><th scope="col">الأعضاء</th><th scope="col">قيّموا</th><th scope="col">التقييمات</th></tr></thead>
        <tbody class="num">${(r.groups || []).map((g) => {
          const p = pct(g.raters, g.members);
          return `<tr><td><b>${esc(g.name)}</b></td><td>${num(g.members)}</td>
            <td><div class="meter"><span class="bar"><i style="width: ${p}%"></i></span><span class="txt">${num(p)}%</span></div></td>
            <td>${num(g.ratings)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`);

    const top = panel('أكثر المقيّمين', 'كل الوقت', `
      <div class="table-scroll"><table class="data tight">
        <thead><tr><th scope="col">المستخدم</th><th scope="col">قيّم</th><th scope="col">آخر تقييم</th></tr></thead>
        <tbody class="num">${(r.topRaters || []).map((t) => `
          <tr class="clickable" data-player="${esc(t.user_id)}">
            <td><span class="who"><span class="avatar">${esc(String(t.name || '؟').trim().charAt(0))}</span><b>${esc(t.name)}</b></span></td>
            <td>${players(t.ratees)}</td><td>${ago(t.last_at)}</td></tr>`).join('')}</tbody>
      </table></div>`);

    return `${main}<div class="ov-row">${groups}${top}</div>`;
  }

  /* ------------------------------------------------------------ الرسم */

  let handlers = {};

  function render(el, d) {
    el.innerHTML = `
      <h3 class="ov-h">التطبيق</h3>
      <div class="ov-row">${featuresPanel(d.features)}${reachPanel(d.reach)}</div>
      <h3 class="ov-h">المستخدمون</h3>
      ${lifePanel(d.life)}
      <div class="ov-row">${journeyPanel(d.journey)}${noGroupPanel(d.noGroup, d.life.total)}</div>
      ${activityPanel(d.activity, d.life.total)}
      <h3 class="ov-h">تقييم اللاعبين</h3>
      ${ratingPanels(d.rating)}`;
  }

  function message(el, title, text) {
    el.innerHTML = `<section class="panel"><div class="ov-empty"><b>${title}</b>${text}</div></section>`;
  }

  function init(el, h) {
    handlers = h || {};
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-go="nogroup"]')) { handlers.onShowNoGroup?.(); return; }
      const tr = e.target.closest('tr[data-player]');
      if (tr) handlers.onOpenPlayer?.(tr.dataset.player);
    });
  }

  global.TamrinHome = { init, render, message };
})(window);
