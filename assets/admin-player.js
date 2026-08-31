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

  /** يستبدلها المحتوى الكامل في الخطوة التالية. */
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
