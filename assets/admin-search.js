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
    /* الرجوع إلى الزرّ إن لم يكن هناك ما يُعاد إليه التركيز: فتح الطبقة
       بـ ⌘K يترك التركيز على body، وإعادته إلى body تُفقد مستخدم لوحة
       المفاتيح موضعه في الصفحة. */
    const restoreTo = (lastFocus && lastFocus.focus && lastFocus !== document.body)
      ? lastFocus : trig;
    if (restoreTo && restoreTo.focus) restoreTo.focus();
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
