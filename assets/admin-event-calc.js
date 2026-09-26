/* =========================================================================
   تمرين — منطق صفحة الفعالية الخالص
   ---------------------------------------------------------------------
   لا يلمس DOM ولا الشبكة، فيُختبر وحده في tests/admin-event.test.html.
   قيم payment_status تُحقّق منها في prod في 2026-09-26:
     confirmed (مدفوع) · waived (معفى) · pending
   أي قيمة أخرى تُعامَل «لم يدفع» حتى لا تُحسب مدفوعة خطأً.
   ========================================================================= */

(function (global) {
  'use strict';

  const PAY = { confirmed: 'paid', waived: 'waived' };

  function payState(status) {
    return PAY[status] || 'pending';
  }

  function summary(d) {
    const ev = d.event || {};
    const parts = d.participants || [];
    const filled = parts.length;
    const max = ev.max_participants || null;

    let paid = 0, waived = 0, pending = 0, collected = 0;
    parts.forEach((p) => {
      const s = payState(p.payment_status);
      if (s === 'paid') paid++;
      else if (s === 'waived') waived++;
      else pending++;
      collected += Number(p.paid_amount) || 0;
    });

    // المعفى لا يدين بشيء، فلا يدخل في المتوقّع — فعالية مسدَّدة بالكامل تقرأ 100%.
    const expected = (Number(ev.price_per_person) || 0) * (filled - waived);

    return {
      filled,
      max,
      seatPct: max ? Math.min(100, Math.round((filled / max) * 100)) : null,
      full: !!max && filled >= max,
      paid, waived, pending,
      collected,
      expected,
      collectedPct: expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : null,
      groupSize: d.group_size || 0,
      registeredMembers: new Set(parts.filter((p) => p.user_id).map((p) => p.user_id)).size,
      declined: (d.declined || []).length,
      noReply: (d.no_reply || []).length,
      waitlist: (d.waitlist || []).length
    };
  }

  const FILTERS = {
    all: () => true,
    paid: (p) => payState(p.payment_status) === 'paid',
    waived: (p) => payState(p.payment_status) === 'waived',
    pending: (p) => payState(p.payment_status) === 'pending',
    guests: (p) => !p.user_id
  };

  function filterParticipants(list, filter) {
    return (list || []).filter(FILTERS[filter] || FILTERS.all);
  }

  function filterCounts(list) {
    const out = {};
    Object.keys(FILTERS).forEach((k) => { out[k] = filterParticipants(list, k).length; });
    return out;
  }

  /* مفرد · مثنى · جمع (3–10) · تمييز مفرد (11+) */
  function unit(n, one, two, few) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n <= 10) return `${n} ${few}`;
    return `${n} ${one}`;
  }

  function durationText(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'أقل من دقيقة';
    if (min < 60) return unit(min, 'دقيقة', 'دقيقتين', 'دقائق');
    const hrs = Math.floor(min / 60);
    if (hrs < 48) return unit(hrs, 'ساعة', 'ساعتين', 'ساعات');
    return unit(Math.floor(hrs / 24), 'يوم', 'يومين', 'أيام');
  }

  function pace(d, nowMs) {
    const times = (d.participants || [])
      .map((p) => Date.parse(p.registered_at))
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);
    if (!times.length) return null;

    const ev = d.event || {};
    const max = ev.max_participants;
    const published = Date.parse(ev.published_at);
    if (max && times.length >= max && !Number.isNaN(published)) {
      // الوقت حتى التسجيل الذي أكمل العدد، لا آخر تسجيل
      return { kind: 'filled', text: `اكتمل خلال ${durationText(times[max - 1] - published)} من النشر` };
    }
    return { kind: 'last', text: `آخر تسجيل قبل ${durationText(nowMs - times[times.length - 1])}` };
  }

  global.TamrinEventCalc = {
    payState: payState,
    summary: summary,
    filterParticipants: filterParticipants,
    filterCounts: filterCounts,
    durationText: durationText,
    pace: pace
  };
})(window);
