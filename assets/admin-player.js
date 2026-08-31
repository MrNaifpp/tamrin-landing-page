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
    /* الرجوع إلى زرّ البحث إن لم يكن هناك ما يُعاد إليه التركيز — نفس سبب
       الرجوع في طبقة البحث: body تُفقد مستخدم لوحة المفاتيح موضعه. */
    const restoreTo = (lastFocus && lastFocus.focus && lastFocus !== document.body)
      ? lastFocus : $('searchTrigger');
    if (restoreTo && restoreTo.focus) restoreTo.focus();
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
