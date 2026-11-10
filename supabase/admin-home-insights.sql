-- =====================================================================
-- تمرين — لوحة التحكم: تبويب «نظرة عامة» (سلوك المستخدمين)
-- ---------------------------------------------------------------------
-- يُنفَّذ مرة واحدة على مشروع الإنتاج timrin-prod (hzsxwnmbdkrmipjtfzlp)
-- من محرّر SQL في لوحة Supabase، بعد admin-dashboard.sql.
--
-- ما يضيفه:
--   1) جدول user_activity_days: يوم واحد لكل مستخدم فتح التطبيق فيه.
--      يُنشأ هنا فارغًا. الذي يملؤه هو admin-activity-log.sql (اختياري).
--   2) دالتان داخليتان (لا تُمنحان لأي دور):
--        admin_user_groups()   مجموعات كل مستخدم (عضو أو مالك)
--        admin_user_actions()  كل حركة مسجّلة لكل مستخدم مع وقتها
--   3) admin_home_insights(): كل أرقام تبويب «نظرة عامة» في نداء واحد.
--
-- قراءة فقط. لا يمسّ جدولًا ولا سياسة ولا دالة يستدعيها التطبيق.
-- =====================================================================

begin;

-- ------------------------------------------ 1) أيام فتح التطبيق ---
create table if not exists public.user_activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
alter table public.user_activity_days enable row level security;
revoke all on table public.user_activity_days from public, anon, authenticated;

-- --------------------------------------- 2) مجموعات كل مستخدم ---
-- المالك قد لا يكون له صف في workspace_members، فيُضاف من workspaces.
create or replace function public.admin_user_groups()
returns table (user_id uuid, workspace_id uuid)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select x.user_id, x.workspace_id
  from (
    select m.user_id, m.workspace_id from public.workspace_members m
    union
    select w.owner_id, w.id from public.workspaces w
  ) x
  join public.users u on u.user_id = x.user_id and u.deleted_at is null;
$$;

revoke execute on function public.admin_user_groups() from public, anon, authenticated;

-- ------------------------------------------- 3) حركات المستخدم ---
-- «نشِط» = قام بأي حركة من هذه. kind يحدّد نوعها:
--   signup   أنشأ حسابًا
--   open     فتح التطبيق (آخر فتح من device_tokens / web_push_subscriptions،
--            والتاريخ اليومي من user_activity_days إن كان يُملأ)
--   register سجّل في فعالية بنفسه أو دخل قائمة الانتظار
--   rate     قيّم لاعبًا أو عدّل تقييمه
--   decline  اعتذر عن فعالية
--   join     دخل مجموعة أو أنشأها
--   create   أنشأ فعالية (المتكررة تُحسب مرة عند إنشاء التكرار، لا كل أسبوع)
create or replace function public.admin_user_actions()
returns table (user_id uuid, kind text, ts timestamptz)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select x.user_id, x.kind, x.ts
  from (
    select u.user_id, 'signup'::text as kind, u.created_at as ts from public.users u
    union all
    select p.user_id, 'register', p.created_at
      from public.event_participants p
     where p.user_id is not null and not p.added_manually
    union all
    select w.user_id, 'register', w.joined_at from public.event_waitlist w
    union all
    select r.rater_id, 'rate', r.created_at from public.player_ratings r
    union all
    select r.rater_id, 'rate', r.updated_at
      from public.player_ratings r where r.updated_at > r.created_at
    union all
    select r.user_id, 'decline', r.responded_at
      from public.event_member_responses r where r.status = 'declined'
    union all
    select m.user_id, 'join', m.joined_at from public.workspace_members m
    union all
    select w.owner_id, 'join', w.created_at from public.workspaces w
    union all
    select e.creator_id, 'create', e.created_at
      from public.events e where e.template_id is null
    union all
    select t.creator_id, 'create', t.created_at from public.event_templates t
    union all
    select d.user_id, 'open', d.updated_at from public.device_tokens d
    union all
    select s.user_id, 'open', s.last_seen_at from public.web_push_subscriptions s
    union all
    select a.user_id, 'open', a.day::timestamp at time zone 'Asia/Riyadh'
      from public.user_activity_days a
  ) x
  join public.users u on u.user_id = x.user_id and u.deleted_at is null
  where x.ts is not null and x.ts <= now();
$$;

revoke execute on function public.admin_user_actions() from public, anon, authenticated;

-- --------------------------------------------- 4) نظرة عامة ---
create or replace function public.admin_home_insights()
returns json
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_now      timestamptz := now();
  v_features json;
  v_reach    json;
  v_life     json;
  v_journey  json;
  v_nogroup  json;
  v_activity json;
  v_rating   json;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- ------------------------------------------------ استخدام المزايا
  -- فعاليات منشورة غير ملغاة، موعدها خلال آخر 30 يومًا.
  with ev as (
    select e.id, e.template_id, e.approval_mode
    from public.events e
    where e.published_at is not null and e.cancelled_at is null
      and e.start_date > v_now - interval '30 days' and e.start_date <= v_now
  ),
  seats as (
    select p.user_id, p.guest_name
    from public.event_participants p join ev on ev.id = p.event_id
  )
  select json_build_object(
    'events',     (select count(*) from ev),
    'recurring',  (select count(*) from ev where ev.template_id is not null),
    'mapLink',    (select count(*) from ev where exists (
                     select 1 from public.event_map_links l
                     where l.event_id = ev.id
                        or (ev.template_id is not null and l.template_id = ev.template_id))),
    'lineup',     (select count(*) from ev where exists (
                     select 1 from public.event_lineups l
                     where l.event_id = ev.id and l.status = 'published')),
    'manual',     (select count(*) from ev where ev.approval_mode = 'manual'),
    'seats',      (select count(*) from seats),
    'guestSeats', (select count(*) from seats where seats.guest_name is not null),
    'players',    (select count(distinct seats.user_id) from seats where seats.user_id is not null),
    'raters',     (select count(distinct r.rater_id) from public.player_ratings r
                    join public.users u on u.user_id = r.rater_id and u.deleted_at is null
                    where greatest(r.created_at, r.updated_at) > v_now - interval '30 days'),
    'feedback',   (select coalesce(json_agg(json_build_object(
                             'feature', f.feature, 'avg', f.avg, 'count', f.n) order by f.n desc), '[]'::json)
                     from (select ff.feature, round(avg(ff.stars), 1) as avg, count(*) as n
                             from public.feature_feedback ff group by ff.feature) f)
  ) into v_features;

  -- ------------------------------------------- الوصول إلى المستخدمين
  with live as (
    select u.user_id from public.users u where u.deleted_at is null
  ),
  ios as (
    select distinct d.user_id from public.device_tokens d join live on live.user_id = d.user_id
  ),
  web as (
    select distinct s.user_id from public.web_push_subscriptions s join live on live.user_id = s.user_id
  ),
  last_open as (
    select a.user_id, max(a.ts) as ts
    from public.admin_user_actions() a where a.kind = 'open' group by a.user_id
  )
  select json_build_object(
    'users',     (select count(*) from live),
    'pushUsers', (select count(*) from (select user_id from ios union select user_id from web) x),
    'ios',       (select count(*) from ios),
    'web',       (select count(*) from web),
    'sent7',     (select count(*) from public.push_outbox o
                   where o.status = 'sent' and o.created_at > v_now - interval '7 days'),
    'failed7',   (select count(*) from public.push_outbox o
                   where o.status = 'failed' and o.created_at > v_now - interval '7 days'),
    'openToday', (select count(*) from last_open where ts > v_now - interval '24 hours'),
    'openWeek',  (select count(*) from last_open
                   where ts <= v_now - interval '24 hours' and ts > v_now - interval '7 days'),
    'openOlder', (select count(*) from last_open where ts <= v_now - interval '7 days')
  ) into v_reach;

  -- ------------------------------------------- أين مستخدموك الآن؟
  -- كل مستخدم في خانة واحدة. «آخر تسجيل» = أحدث مقعد له في أي فعالية.
  with u as (
    select usr.user_id,
           exists (select 1 from public.admin_user_groups() g where g.user_id = usr.user_id) as in_group,
           (select max(p.created_at) from public.event_participants p where p.user_id = usr.user_id) as last_reg
    from public.users usr where usr.deleted_at is null
  )
  select json_build_object(
    'total',         count(*),
    'noGroup',       count(*) filter (where not in_group),
    'notRegistered', count(*) filter (where in_group and last_reg is null),
    'active',        count(*) filter (where in_group and last_reg > v_now - interval '14 days'),
    'slipping',      count(*) filter (where in_group and last_reg <= v_now - interval '14 days'
                                        and last_reg > v_now - interval '30 days'),
    'gone',          count(*) filter (where in_group and last_reg <= v_now - interval '30 days')
  ) into v_life from u;

  -- ------------------------------------------ رحلة المستخدم الجديد
  with nu as (
    select usr.user_id, usr.created_at,
           (select min(a.ts) from public.admin_user_actions() a
             where a.user_id = usr.user_id and a.kind = 'join') as first_join,
           exists (select 1 from public.admin_user_groups() g where g.user_id = usr.user_id) as in_group,
           (select count(distinct p.event_id) from public.event_participants p
             where p.user_id = usr.user_id) as regs
    from public.users usr
    where usr.deleted_at is null and usr.created_at > v_now - interval '30 days'
  )
  select json_build_object(
    'signups',         count(*),
    'joined',          count(*) filter (where in_group),
    'registered',      count(*) filter (where in_group and regs >= 1),
    'registeredTwice', count(*) filter (where in_group and regs >= 2),
    'joinedFirstHour', count(*) filter (where in_group and first_join <= created_at + interval '1 hour')
  ) into v_journey from nu;

  -- --------------------------------------------------- بلا مجموعة
  with ng as (
    select usr.user_id, usr.created_at,
           (select max(a.ts) from public.admin_user_actions() a
             where a.user_id = usr.user_id and a.kind = 'open') as last_open,
           (exists (select 1 from public.device_tokens d where d.user_id = usr.user_id)
            or exists (select 1 from public.web_push_subscriptions s where s.user_id = usr.user_id)) as reachable
    from public.users usr
    where usr.deleted_at is null
      and not exists (select 1 from public.admin_user_groups() g where g.user_id = usr.user_id)
  )
  select json_build_object(
    'total',     count(*),
    'd7',        count(*) filter (where created_at > v_now - interval '7 days'),
    'd30',       count(*) filter (where created_at <= v_now - interval '7 days'
                                    and created_at > v_now - interval '30 days'),
    'older',     count(*) filter (where created_at <= v_now - interval '30 days'),
    'opened7',   count(*) filter (where last_open > v_now - interval '7 days'),
    'reachable', count(*) filter (where reachable)
  ) into v_nogroup from ng;

  -- ----------------------------------------------- نشاط المستخدمين
  with a as (
    select x.user_id, x.kind, x.ts from public.admin_user_actions() x
  ),
  firsts as (
    select a.user_id, min(a.ts) as ts from a group by a.user_id
  ),
  wk as (
    select k, v_now - (k + 1) * interval '7 days' as s, v_now - k * interval '7 days' as e
    from generate_series(0, 11) k
  ),
  last30 as (
    select distinct a.user_id from a where a.ts > v_now - interval '30 days'
  ),
  prev30 as (
    select distinct a.user_id from a
    where a.ts > v_now - interval '60 days' and a.ts <= v_now - interval '30 days'
  ),
  older30 as (
    select distinct a.user_id from a
    where a.ts > v_now - interval '90 days' and a.ts <= v_now - interval '60 days'
  )
  select json_build_object(
    'weeks', (select json_agg(json_build_object(
                'start', wk.s,
                'total', (select count(distinct a.user_id) from a where a.ts > wk.s and a.ts <= wk.e),
                'first', (select count(*) from firsts f where f.ts > wk.s and f.ts <= wk.e)
              ) order by wk.k desc) from wk),
    'active7', (select count(distinct a.user_id) from a where a.ts > v_now - interval '7 days'),
    'prev7',   (select count(distinct a.user_id) from a
                 where a.ts > v_now - interval '14 days' and a.ts <= v_now - interval '7 days'),
    'actions', (select coalesce(json_object_agg(k.kind, k.n), '{}'::json)
                  from (select a.kind, count(distinct a.user_id) as n from a
                         where a.ts > v_now - interval '7 days' group by a.kind) k),
    'prevMonth',     (select count(*) from prev30),
    'prevMonthBack', (select count(*) from prev30 p join last30 l on l.user_id = p.user_id),
    'olderMonth',     (select count(*) from older30),
    'olderMonthBack', (select count(*) from older30 o join prev30 p on p.user_id = o.user_id)
  ) into v_activity;

  -- ------------------------------------------------ تقييم اللاعبين
  with members as (
    select distinct g.user_id from public.admin_user_groups() g
  ),
  r as (
    select pr.workspace_id, pr.rater_id, pr.ratee_id, pr.created_at,
           greatest(pr.created_at, pr.updated_at) as last_at
    from public.player_ratings pr
  ),
  cover as (
    select m.user_id,
           (select count(distinct r.rater_id) from r where r.ratee_id = m.user_id) as n
    from members m
  ),
  per_rater as (
    select r.rater_id, count(distinct r.ratee_id) as ratees,
           count(distinct date_trunc('week', r.created_at)) as weeks,
           max(r.last_at) as last_at
    from r group by r.rater_id
  ),
  wk as (
    select k, v_now - (k + 1) * interval '7 days' as s, v_now - k * interval '7 days' as e
    from generate_series(0, 11) k
  )
  select json_build_object(
    'members',  (select count(*) from members),
    'raters',   (select count(*) from per_rater),
    'rated',    (select count(distinct r.ratee_id) from r),
    'ratings',  (select count(*) from r),
    'ratings7', (select count(*) from r where r.created_at > v_now - interval '7 days'),
    'perRater', (select coalesce(round(avg(p.ratees), 1), 0) from per_rater p),
    'repeatRaters', (select count(*) from per_rater p where p.weeks >= 2),
    'since',    (select min(r.created_at) from r),
    'weeks',    (select json_agg(json_build_object(
                   'start', wk.s,
                   'count', (select count(*) from r where r.created_at > wk.s and r.created_at <= wk.e)
                 ) order by wk.k desc) from wk),
    'coverNone', (select count(*) from cover where n = 0),
    'coverFew',  (select count(*) from cover where n between 1 and 2),
    'coverMany', (select count(*) from cover where n >= 3),
    'groupsTotal',  (select count(*) from public.workspaces),
    'groupsRating', (select count(distinct r.workspace_id) from r),
    'groups', (select coalesce(json_agg(g order by g.ratings desc, g.members desc), '[]'::json)
                 from (
                   select w.name,
                          (select count(*) from public.admin_user_groups() ug
                            where ug.workspace_id = w.id) as members,
                          count(distinct r.rater_id) as raters,
                          count(*) as ratings
                   from public.workspaces w join r on r.workspace_id = w.id
                   group by w.id, w.name
                   order by count(*) desc
                   limit 6
                 ) g),
    'topRaters', (select coalesce(json_agg(t order by t.ratees desc, t.last_at desc), '[]'::json)
                    from (
                      select p.rater_id as user_id, u.name, p.ratees, p.last_at
                      from per_rater p
                      join public.users u on u.user_id = p.rater_id and u.deleted_at is null
                      order by p.ratees desc, p.last_at desc
                      limit 5
                    ) t)
  ) into v_rating;

  return json_build_object(
    'generatedAt', v_now,
    'features', v_features,
    'reach',    v_reach,
    'life',     v_life,
    'journey',  v_journey,
    'noGroup',  v_nogroup,
    'activity', v_activity,
    'rating',   v_rating
  );
end;
$$;

revoke execute on function public.admin_home_insights() from public, anon;
grant  execute on function public.admin_home_insights() to authenticated;

commit;
