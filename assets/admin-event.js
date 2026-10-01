/* =========================================================================
   تمرين — صفحة الفعالية
   ---------------------------------------------------------------------
   تُفتح بمعرّف فعالية فقط ولا تعرف شيئًا عن الموجّه (#event/<id>) —
   الربط في admin.js. الحسابات كلها في TamrinEventCalc.
   ========================================================================= */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const { esc, num, asWhen, who, memberRow, MEMBER_HEAD } = global.TamrinEventParts;

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
            <thead>${MEMBER_HEAD}</thead>
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

  function tabsHtml() {
    return `
      <div class="seg ev-tabs" role="tablist" aria-label="أقسام الفعالية">
        <button type="button" role="tab" id="evTabThis" data-tab="this"
                aria-selected="true" aria-controls="evPaneThis">هذه الفعالية</button>
        <button type="button" role="tab" id="evTabPast" data-tab="past"
                aria-selected="false" aria-controls="evPanePast">فعاليات المجموعة السابقة <span id="evPastCount"></span></button>
      </div>`;
  }

  function selectPane(which) {
    const past = which === 'past';
    $('evTabThis').setAttribute('aria-selected', String(!past));
    $('evTabPast').setAttribute('aria-selected', String(past));
    $('evPaneThis').hidden = past;
    $('evPanePast').hidden = !past;
  }

  /* --------------------------------------------------------- حالات */

  function render() {
    $('eventView').innerHTML = headHtml(details.event) + tabsHtml()
      + `<div id="evPaneThis" role="tabpanel" aria-labelledby="evTabThis">`
      + cardsHtml(C().summary(details)) + paceHtml(details) + membersHtml() + listsHtml(details)
      + `</div><div id="evPanePast" role="tabpanel" aria-labelledby="evTabPast" hidden></div>`;

    TamrinEventHistory.mount($('evPanePast'), {
      workspaceId: details.event.workspace_id,
      onCount: (n) => {
        const el = $('evPastCount');
        if (el) el.textContent = n === null ? '' : `(${num(n)})`;
      }
    });
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
    TamrinEventHistory.reset();
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

      const tab = e.target.closest('[data-tab]');
      if (tab && details) { selectPane(tab.dataset.tab); return; }

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
    TamrinEventHistory.reset();
    currentId = null;
    details = null;
    $('eventView').hidden = true;
    $('eventView').innerHTML = '';
  }

  global.TamrinEvent = { init, open, close };
})(window);
