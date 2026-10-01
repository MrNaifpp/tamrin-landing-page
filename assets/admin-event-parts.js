/* =========================================================================
   تمرين — أجزاء صفحة الفعالية المشتركة
   ---------------------------------------------------------------------
   صفّ المسجّل نفسه يُرسم في تبويب «هذه الفعالية» وفي الفعاليات السابقة
   المفتوحة، فيعيش هنا مرة واحدة حتى لا يختلف العرضان.
   ========================================================================= */

(function (global) {
  'use strict';

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

  function who(name, sub) {
    return `
      <span class="who">
        <span class="avatar sm" aria-hidden="true">${esc(initials(name))}</span>
        <span><b>${esc(name)}</b>${sub ? `<span class="ev-sub">${sub}</span>` : ''}</span>
      </span>`;
  }

  function payTag(p) {
    const s = global.TamrinEventCalc.payState(p.payment_status);
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

  /* الأعضاء الحقيقيون صفوف قابلة للنقر؛ الضيوف بلا ملف فلا ينقرون. */
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

  const MEMBER_HEAD = `<tr>
    <th scope="col">الاسم</th><th scope="col">المركز</th>
    <th scope="col">سجّل</th><th scope="col">الدفع</th>
  </tr>`;

  global.TamrinEventParts = { esc, num, asWhen, initials, who, payTag, badges, memberRow, MEMBER_HEAD };
})(window);
