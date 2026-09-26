-- =====================================================================
-- تمرين — لوحة التحكم: تفاصيل الفعالية
-- ---------------------------------------------------------------------
-- يُنفَّذ على مشروع الإنتاج timrin-prod (hzsxwnmbdkrmipjtfzlp) من محرّر
-- SQL في لوحة Supabase، ونسخته المتتبَّعة في مستودع التطبيق:
--   supabase/migrations/20260926100000_admin_event_details.sql
-- إضافي بالكامل: دالة قراءة واحدة، لا يعدّل جدولًا ولا سياسة RLS.
--
-- قيم الحالة (تُحقّق منها في prod في 2026-09-26):
--   payment_status: confirmed (مدفوع) · waived (معفى) · pending
--   event_member_responses.status: invited · declined
-- =====================================================================

begin;

create or replace function public.admin_event_details(p_event_id uuid)
returns json
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_event  public.events%rowtype;
  v_owner  uuid;
  v_result json;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    return null;
  end if;

  select w.owner_id into v_owner
  from public.workspaces w where w.id = v_event.workspace_id;

  with parts as (
    select p.*,
           u.name       as u_name,
           u.avatar_url as u_avatar,
           u.postion    as u_postion,
           ab.name      as added_by_name
    from public.event_participants p
    left join public.users u  on u.user_id  = p.user_id
    left join public.users ab on ab.user_id = p.added_by
    where p.event_id = p_event_id
  ),
  -- المالك يُعدّ مرة واحدة: قد لا يكون له صف في workspace_members.
  members as (
    select m.user_id from public.workspace_members m
     where m.workspace_id = v_event.workspace_id
    union
    select v_owner where v_owner is not null
  ),
  waiting as (
    select wl.user_id, wl.joined_at
    from public.event_waitlist wl
    where wl.event_id = p_event_id
  ),
  declined as (
    select r.user_id, r.reason_code, r.reason_text, r.responded_at
    from public.event_member_responses r
    where r.event_id = p_event_id
      and r.status = 'declined'
      and not exists (select 1 from parts p where p.user_id = r.user_id)
  ),
  no_reply as (
    select m.user_id from members m
    where not exists (select 1 from parts p    where p.user_id = m.user_id)
      and not exists (select 1 from waiting wt where wt.user_id = m.user_id)
      and not exists (select 1 from declined d where d.user_id = m.user_id)
  )
  select json_build_object(
    'event', (
      select json_build_object(
        'id', v_event.id,
        'name', v_event.name,
        'description', v_event.description,
        'workspace_id', v_event.workspace_id,
        'workspace_name', w.name,
        'creator_name', coalesce(nullif(btrim(cu.name), ''), '—'),
        'location', v_event.location,
        'start_date', v_event.start_date,
        'end_date', v_event.end_date,
        'price_per_person', v_event.price_per_person,
        'total_price', v_event.total_price,
        'max_participants', v_event.max_participants,
        'registration_locked', v_event.registration_locked,
        'published_at', v_event.published_at,
        'cancelled_at', v_event.cancelled_at)
      from public.workspaces w
      left join public.users cu on cu.user_id = v_event.creator_id
      where w.id = v_event.workspace_id),
    'participants', coalesce((
      select json_agg(json_build_object(
        'id', p.id,
        'user_id', p.user_id,
        'name', case when p.user_id is null
                     then coalesce(nullif(btrim(p.guest_name), ''), '—')
                     else coalesce(nullif(btrim(p.u_name), ''), '—') end,
        'avatar_url', p.u_avatar,
        'postion', p.u_postion,
        'is_guest', p.user_id is null and not p.added_manually,
        'added_manually', p.added_manually,
        'added_by_name', nullif(btrim(p.added_by_name), ''),
        'payment_status', p.payment_status,
        'paid_amount', case when p.payment_status = 'confirmed'
                            then coalesce(p.paid_price_per_person, v_event.price_per_person)
                            else 0 end,
        'registered_at', p.created_at
      ) order by p.created_at)
      from parts p), '[]'::json),
    'waitlist', coalesce((
      select json_agg(json_build_object(
        'user_id', wt.user_id,
        'name', coalesce(nullif(btrim(u.name), ''), '—'),
        'avatar_url', u.avatar_url,
        'joined_at', wt.joined_at
      ) order by wt.joined_at)
      from waiting wt left join public.users u on u.user_id = wt.user_id), '[]'::json),
    'declined', coalesce((
      select json_agg(json_build_object(
        'user_id', d.user_id,
        'name', coalesce(nullif(btrim(u.name), ''), '—'),
        'avatar_url', u.avatar_url,
        'reason_code', d.reason_code,
        'reason_text', nullif(btrim(d.reason_text), ''),
        'responded_at', d.responded_at
      ) order by d.responded_at desc nulls last)
      from declined d left join public.users u on u.user_id = d.user_id), '[]'::json),
    'no_reply', coalesce((
      select json_agg(json_build_object(
        'user_id', n.user_id,
        'name', coalesce(nullif(btrim(u.name), ''), '—'),
        'avatar_url', u.avatar_url
      ) order by u.name)
      from no_reply n left join public.users u on u.user_id = n.user_id), '[]'::json),
    'group_size', (select count(*) from members)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_event_details(uuid) from public, anon;
grant  execute on function public.admin_event_details(uuid) to authenticated;

commit;
