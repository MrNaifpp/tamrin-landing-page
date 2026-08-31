/* =========================================================================
   تمرين — منطق التقييم الخالص
   ---------------------------------------------------------------------
   لا يلمس هذا الملف DOM ولا الشبكة. سببه أنّ حسابات العرض (النسب،
   الترتيب، حالات الفراغ) قابلة للاختبار وحدها في tests/admin-ratings.test.html
   بلا متصفّح كامل ولا أدوات بناء.

   ما ليس هنا بقصد: صيغة التقييم العام. تحسبها دالة player_rating_overall
   على الخادم وتأتي جاهزة في الحمولة — إعادة كتابتها هنا تعني رقمين
   مختلفين للاعب واحد.
   ========================================================================= */

(function (global) {
  'use strict';

  /* الترتيب ثابت في كل مكان: الحمولة، الأشرطة، صفوف المقيّمين. */
  const ATTRS = [
    { key: 'pace',      label: 'السرعة' },
    { key: 'shooting',  label: 'التسديد' },
    { key: 'passing',   label: 'التمرير' },
    { key: 'defending', label: 'الدفاع' },
    { key: 'stamina',   label: 'التحمّل' },
    { key: 'awareness', label: 'الوعي' }
  ];

  /**
   * نسبة الشريط من قيمة التقييم. المقياس يأتي من الخادم لا من الواجهة،
   * فقد يكون ناقصًا أو غير صالح — نُعيد null ليعرض النداء الرقم بلا شريط
   * بدل تخمين مقام.
   */
  function barPercent(value, scale) {
    if (!scale) return null;
    const max = Number(scale.max);
    const min = Number(scale.min);
    if (!isFinite(max) || !isFinite(min) || max <= min) return null;
    const v = Number(value);
    if (value === null || value === undefined || !isFinite(v)) return null;
    const pct = ((v - min) / (max - min)) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  /** صفوف الصفات الستّ لتقييم واحد، جاهزة للعرض. */
  function attributeRows(rating, scale) {
    return ATTRS.map(function (a) {
      const value = rating && rating[a.key] !== undefined ? rating[a.key] : null;
      return {
        key: a.key,
        label: a.label,
        value: value === undefined ? null : value,
        percent: barPercent(value, scale)
      };
    });
  }

  function groups(profile) {
    return profile && Array.isArray(profile.groups) ? profile.groups : [];
  }

  function countOf(g) {
    if (g && typeof g.rater_count === 'number') return g.rater_count;
    return g && Array.isArray(g.raters) ? g.raters.length : 0;
  }

  function hasAnyRatings(profile) {
    return groups(profile).some(function (g) { return countOf(g) > 0; });
  }

  function totalRaterCount(profile) {
    return groups(profile).reduce(function (s, g) { return s + countOf(g); }, 0);
  }

  /** الأكثر تقييمًا أولًا — أغنى مجموعة تستحق أعلى الورقة. slice: لا نُعدّل المُدخل. */
  function sortGroups(list) {
    return (list || []).slice().sort(function (a, b) {
      const d = countOf(b) - countOf(a);
      if (d !== 0) return d;
      return String(a && a.name || '').localeCompare(String(b && b.name || ''), 'ar');
    });
  }

  /** تقييمي أولًا، ثم الأحدث تعديلًا، ثم الاسم. */
  function sortRaters(list) {
    return (list || []).slice().sort(function (a, b) {
      const mine = (b && b.is_me ? 1 : 0) - (a && a.is_me ? 1 : 0);
      if (mine !== 0) return mine;
      const at = String(a && a.updated_at || '');
      const bt = String(b && b.updated_at || '');
      if (at !== bt) return bt.localeCompare(at);
      return String(a && a.name || '').localeCompare(String(b && b.name || ''), 'ar');
    });
  }

  global.TamrinRatings = {
    ATTRS: ATTRS,
    barPercent: barPercent,
    attributeRows: attributeRows,
    hasAnyRatings: hasAnyRatings,
    totalRaterCount: totalRaterCount,
    sortGroups: sortGroups,
    sortRaters: sortRaters
  };
})(window);
