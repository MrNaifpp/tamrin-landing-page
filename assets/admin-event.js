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
    const seats = s.max ? `${num(s.filled)}<small>/${num(s.max)}</small>` : num(s.filled);
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
