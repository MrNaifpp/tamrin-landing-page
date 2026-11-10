-- =====================================================================
-- تمرين — لوحة التحكم: أسماء المجموعات في جدول المستخدمين + فلتر المجموعات النشطة
-- ---------------------------------------------------------------------
-- يُنفَّذ مرة واحدة على مشروع الإنتاج timrin-prod (hzsxwnmbdkrmipjtfzlp)
-- من محرّر SQL في لوحة Supabase، بعد admin-dashboard.sql.
--
-- ما يتغيّر:
--   1) admin_list_users تُرجع لكل مستخدم قائمة مجموعاته (id, name) بدل العدد
--      فقط، وتقبل فلترًا جديدًا p_workspace:
--        ''        كل المستخدمين (السلوك القديم)
--        'active'  من هو في مجموعة نشطة واحدة على الأقل
--        <uuid>    أعضاء هذه المجموعة فقط
--   2) admin_list_active_workspaces: المجموعات النشطة لقائمة الفلتر.
--
-- «مجموعة نشطة» = فيها فعالية نشطة بنفس شرط تبويب «الفعاليات النشطة»:
-- منشورة، غير ملغاة، لم ينتهِ موعدها، والمجموعة بأكثر من 3 أعضاء مع المالك.
--
-- لا يمسّ جدولًا ولا سياسة ولا دالة يستدعيها التطبيق.
-- =====================================================================

begin;

-- ------------------------------------- 1) معرّفات المجموعات النشطة ---
-- دالة داخلية: تستدعيها دوال admin_* فقط، فلا تُمنح لأي دور.
create or replace function public.admin_active_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select distinct e.workspace_id
  from public.events e
  join public.workspaces w on w.id = e.workspace_id
  where e.published_at is not null
    and e.cancelled_at is null
    and coalesce(e.end_date, e.start_date) >= now()
    and (select count(*) from public.workspace_members m
          where m.workspace_id = e.workspace_id
            and m.user_id <> w.owner_id) + 1 > 3;
$$;

revoke execute on function public.admin_active_workspace_ids() from public, anon, authenticated;

-- ------------------------------------------- 2) المجموعات النشطة ---
create or replace function public.admin_list_active_workspaces()
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

  select coalesce(json_agg(r order by r.name), '[]'::json) into v_rows
  from (
    select w.id, w.name
    from public.workspaces w
    where w.id in (select public.admin_active_workspace_ids())
  ) r;

  return v_rows;
end;
$$;

revoke execute on function public.admin_list_active_workspaces() from public, anon;
grant  execute on function public.admin_list_active_workspaces() to authenticated;

-- ------------------------------------------------ 3) المستخدمون ---
-- التوقيع يتغيّر (معامل رابع)، فتُحذف القديمة أولًا حتى لا تبقى نسختان
-- تتعارضان عند النداء بالأسماء.
drop function if exists public.admin_list_users(text, integer, integer);

create or replace function public.admin_list_users(
  p_search    text default '',
  p_page      integer default 1,
  p_page_size integer default 12,
  p_workspace text default ''
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
  v_ws     text;
  v_ws_id  uuid;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  p_page      := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 12), 1), 100);
  v_offset    := (p_page - 1) * p_page_size;
  v_q         := nullif(btrim(coalesce(p_search, '')), '');
  v_ws        := nullif(btrim(coalesce(p_workspace, '')), '');
  if v_ws is not null and v_ws <> 'active' then
    v_ws_id := v_ws::uuid;
  end if;

  -- مجموعات المستخدم = ما هو عضو فيه أو يملكه (المالك قد لا يكون له
  -- صف في workspace_members).
  with mine as (
    select m.user_id, m.workspace_id from public.workspace_members m
    union
    select w.owner_id, w.id from public.workspaces w
  ),
  matched as (
    select u.*
    from public.users u
    where u.deleted_at is null
      and (v_q is null
           or u.name ilike '%' || v_q || '%'
           or coalesce(u.stc_pay_number, '') ilike '%' || v_q || '%')
      and (v_ws is null
           or (v_ws = 'active' and exists (
                 select 1 from mine x
                 where x.user_id = u.user_id
                   and x.workspace_id in (select public.admin_active_workspace_ids())))
           or (v_ws_id is not null and exists (
                 select 1 from mine x
                 where x.user_id = u.user_id and x.workspace_id = v_ws_id)))
  )
  select
    (select count(*) from matched),
    coalesce((
      select json_agg(r)
      from (
        select
          u.user_id,
          u.name,
          u.postion,
          u.stc_pay_number,
          u.avatar_url,
          u.created_at,
          coalesce((
            select json_agg(json_build_object('id', w.id, 'name', w.name) order by w.name)
            from mine x join public.workspaces w on w.id = x.workspace_id
            where x.user_id = u.user_id
          ), '[]'::json) as workspaces
        from matched u
        order by u.created_at desc
        limit p_page_size offset v_offset
      ) r
    ), '[]'::json)
  into v_total, v_rows;

  return json_build_object('rows', v_rows, 'total', v_total);
end;
$$;

revoke execute on function public.admin_list_users(text, integer, integer, text) from public, anon;
grant  execute on function public.admin_list_users(text, integer, integer, text) to authenticated;

commit;
