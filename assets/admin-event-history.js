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
