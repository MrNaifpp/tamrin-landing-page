-- =====================================================================
-- تمرين — لوحة التحكم: سجل يومي لفتح التطبيق (اختياري)
-- ---------------------------------------------------------------------
-- يُنفَّذ بعد admin-home-insights.sql على مشروع الإنتاج.
--
-- لماذا؟ القاعدة تحفظ «آخر فتح» فقط لكل مستخدم، فلا نعرف من فتح التطبيق
-- في أسبوع مضى. هذا الملف يحفظ صفًا واحدًا لكل مستخدم في كل يوم يفتح فيه
-- التطبيق، فيمتلئ رسم «نشاط المستخدمين» بالفتح من يوم التنفيذ فصاعدًا.
--
-- كيف؟ التطبيق يسجّل رمز الإشعارات عند كل فتح (device_tokens)، والويب
-- يحدّث last_seen_at (web_push_subscriptions). نضيف محفّزًا بعد الكتابة
-- على كلٍّ منهما يسجّل اليوم.
--
-- تنبيه: هذا الملف الوحيد الذي يلمس جدولين يكتب فيهما التطبيق. المحفّز
-- يبتلع أي خطأ فيه، فلا يمكن أن يُفشل تسجيل الرمز. للتراجع:
--   drop trigger trg_device_tokens_activity on public.device_tokens;
--   drop trigger trg_web_push_activity on public.web_push_subscriptions;
-- =====================================================================

begin;

create or replace function public.log_user_activity_day()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.user_activity_days (user_id, day)
    values (new.user_id, (now() at time zone 'Asia/Riyadh')::date)
    on conflict do nothing;
  exception when others then
    null;  -- السجل لا يُفشل تسجيل رمز الإشعارات أبدًا
  end;
  return null;
end;
$$;

revoke execute on function public.log_user_activity_day() from public, anon, authenticated;

drop trigger if exists trg_device_tokens_activity on public.device_tokens;
create trigger trg_device_tokens_activity
  after insert or update on public.device_tokens
  for each row execute function public.log_user_activity_day();

drop trigger if exists trg_web_push_activity on public.web_push_subscriptions;
create trigger trg_web_push_activity
  after insert or update on public.web_push_subscriptions
  for each row execute function public.log_user_activity_day();

commit;
