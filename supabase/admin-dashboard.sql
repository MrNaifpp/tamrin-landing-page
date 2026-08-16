-- =====================================================================
-- تمرين — لوحة التحكم: صلاحية المشرف ودوال القراءة
-- ---------------------------------------------------------------------
-- يُنفَّذ مرة واحدة على مشروع الإنتاج timrin-prod (hzsxwnmbdkrmipjtfzlp)
-- من محرّر SQL في لوحة Supabase.
--
-- كل ما في هذا الملف إضافي: لا يعدّل جدولًا قائمًا، ولا سياسة RLS، ولا
-- أي دالة يستدعيها التطبيق. النسخة المنشورة 1.2 لا تتأثر إطلاقًا.
--
-- لماذا جدول منفصل للمشرفين وليس عمودًا في public.users؟
--   التطبيق يكتب في public.users مباشرة عبر PostgREST (لا توجد دالة
--   update_profile)، أي أن للجدول سياسة تسمح للمستخدم بتعديل صفّه.
--   وضع علم الصلاحية هناك يعني أن أي مستخدم يستطيع ترقية نفسه بطلب
--   PATCH واحد، ثم قراءة أرقام STC Pay للجميع.
-- =====================================================================

begin;

-- ------------------------------------------------ 1) جدول المشرفين ---
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- بلا سياسات عن قصد: مع تفعيل RLS وغياب السياسات يصبح الجدول غير مرئي
-- لأي عميل عبر PostgREST. الدوال أدناه security definer فتتجاوز RLS.
revoke all on public.admin_users from anon, authenticated;

-- ------------------------------------------------ 2) بوابة الصلاحية ---
create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

revoke execute on function public.is_current_user_admin() from public, anon;
grant  execute on function public.is_current_user_admin() to authenticated;

-- ------------------------------------------------------ 3) الملخّص ---
create or replace function public.admin_overview()
returns json
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare v_result json;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with active as (
    select e.id, e.total_price
    from public.events e
    where e.published_at is not null
      and e.cancelled_at is null
      and coalesce(e.end_date, e.start_date) >= now()
  )
  select json_build_object(
    'totalUsers',
      (select count(*) from public.users u where u.deleted_at is null),
    'newUsersThisWeek',
      (select count(*) from public.users u
        where u.deleted_at is null and u.created_at >= now() - interval '7 days'),
    'activeEvents',
      (select count(*) from active),
    'totalParticipants',
      (select count(*) from public.event_participants p
        where p.event_id in (select id from active)),
    'revenue',
      (select coalesce(sum(a.total_price), 0) from active a)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_overview() from public, anon;
grant  execute on function public.admin_overview() to authenticated;

-- --------------------------------------------------- 4) المستخدمون ---
create or replace function public.admin_list_users(
  p_search    text default '',
  p_page      integer default 1,
  p_page_size integer default 12
)
returns json
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_offset integer;
  v_total  integer;
  v_rows   json;
  v_q      text;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- حدود دفاعية: الصفحة لا تقل عن 1، والحجم لا يتجاوز 100 صفّ للنداء
  p_page      := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 12), 1), 100);
  v_offset    := (p_page - 1) * p_page_size;
  v_q         := nullif(btrim(coalesce(p_search, '')), '');

  select count(*) into v_total
  from public.users u
  where u.deleted_at is null
    and (v_q is null
         or u.name ilike '%' || v_q || '%'
         or coalesce(u.stc_pay_number, '') ilike '%' || v_q || '%');

  select coalesce(json_agg(r), '[]'::json) into v_rows
  from (
    select
      u.user_id,
      u.name,
      u.postion,
      u.stc_pay_number,
      u.avatar_url,
      u.created_at,
      (select count(*) from public.workspace_members m where m.user_id = u.user_id)
        as workspace_count
    from public.users u
    where u.deleted_at is null
      and (v_q is null
           or u.name ilike '%' || v_q || '%'
           or coalesce(u.stc_pay_number, '') ilike '%' || v_q || '%')
    order by u.created_at desc
    limit p_page_size offset v_offset
  ) r;

  return json_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke execute on function public.admin_list_users(text, integer, integer) from public, anon;
grant  execute on function public.admin_list_users(text, integer, integer) to authenticated;

-- ---------------------------------------------- 5) الفعاليات النشطة ---
-- «نشطة» = منشورة، غير ملغاة، ولم ينتهِ موعدها بعد.
create or replace function public.admin_list_active_events()
returns json
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare v_rows json;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(json_agg(r), '[]'::json) into v_rows
  from (
    select
      e.id,
      e.name,
      w.name as workspace_name,
      e.location,
      e.start_date,
      e.end_date,
      e.price_per_person,
      e.total_price,
      e.max_participants,
      e.registration_locked,
      e.published_at,
      (select count(*) from public.event_participants p
        where p.event_id = e.id)                      as participant_count,
      (select count(*) from public.event_waitlist wl
        where wl.event_id = e.id)                     as waitlist_count,
      -- 'confirmed' هي القيمة التي يكتبها التطبيق فعليًا (تُحقّق من prod في 2026-08-16).
      -- العمود نصّي بلا قيد، فأي تغيير في التطبيق يجب أن ينعكس هنا.
      (select count(*) from public.event_participants p2
        where p2.event_id = e.id and p2.payment_status = 'confirmed') as paid_count
    from public.events e
    join public.workspaces w on w.id = e.workspace_id
    where e.published_at is not null
      and e.cancelled_at is null
      and coalesce(e.end_date, e.start_date) >= now()
    order by e.start_date asc
  ) r;

  return v_rows;
end;
$$;

revoke execute on function public.admin_list_active_events() from public, anon;
grant  execute on function public.admin_list_active_events() to authenticated;

commit;


-- =====================================================================
-- الخطوة الأخيرة — منح الصلاحية لحسابك (تُنفَّذ بعد إنشاء حساب المشرف)
-- ---------------------------------------------------------------------
-- ضع البريد الذي أنشأته في Authentication → Users:
--
--   insert into public.admin_users (user_id, note)
--   select id, 'لوحة التحكم' from auth.users where email = 'admin@example.com'
--   on conflict (user_id) do nothing;
--
-- للتأكد:
--   select u.email, a.created_at
--   from public.admin_users a join auth.users u on u.id = a.user_id;
-- =====================================================================
