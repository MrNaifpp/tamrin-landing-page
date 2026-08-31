-- =====================================================================
-- تمرين — لوحة التحكم: ملفّ اللاعب وتقييماته
-- ---------------------------------------------------------------------
-- يُنفَّذ مرة واحدة على مشروع الإنتاج timrin-prod (hzsxwnmbdkrmipjtfzlp)
-- من محرّر SQL في لوحة Supabase. إضافي بالكامل: لا يعدّل جدولًا قائمًا
-- ولا سياسة RLS ولا أي دالة يستدعيها التطبيق.
--
-- لماذا دالة admin_ جديدة بدل إعادة استخدام get_player_rating؟
--   دالة التطبيق محصورة بعضوية المجموعة: تتحقّق أنّ المستدعي عضو في
--   workspace_id. المشرف ليس عضوًا في مجموعات المستخدمين، فستردّه.
--
-- لماذا يُحسب التقييم العام بنداء player_rating_overall لا بصيغة هنا؟
--   الصيغة موزونة بمركز اللاعب وقد تتغيّر في التطبيق. نسخها هنا يعني
--   رقمين مختلفين للاعب واحد: أحدهما في التطبيق والآخر في اللوحة.
-- =====================================================================

begin;

-- --------------------------------------------------- 1) سجلّ الإجراءات ---
-- حذف التقييم لا رجعة فيه: الجدول لا يحتفظ بنسخة، والتطبيق يعيد حساب
-- تقييم اللاعب فورًا. نُصوّر الصفّ المحذوف هنا حتى يبقى الخطأ قابلًا
-- للإصلاح يدويًا.
create table if not exists public.admin_audit_log (
  id             bigserial primary key,
  actor_id       uuid        not null,
  action         text        not null,
  target_user_id uuid,
  payload        jsonb,
  created_at     timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

-- بلا سياسات عن قصد — نفس نمط admin_users: مع تفعيل RLS وغياب السياسات
-- يصبح الجدول غير مرئي عبر PostgREST. الدوال security definer تتجاوز RLS.
revoke all on public.admin_audit_log from anon, authenticated;
revoke all on sequence public.admin_audit_log_id_seq from anon, authenticated;

-- ------------------------------------------------------ 2) ملفّ اللاعب ---
create or replace function public.admin_get_player_profile(p_user_id uuid)
returns json
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  -- حدود التقييم. ثابتة عن قصد: قيد التحقّق على player_ratings غير مقروء
  -- من الواجهة، فتُثبَّت هنا وتُرسل في الحمولة كي لا تُثبّتها الواجهة.
  -- تحقّق منها بالاستعلام في نهاية هذا الملف وصحّحها إن اختلفت.
  v_scale_min constant integer := 1;
  v_scale_max constant integer := 99;

  v_position text;
  v_user     json;
  v_groups   json;
  v_mine     json;
  v_activity json;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- المركز يأتي من صفّ اللاعب لا من صفّ التقييم: الصيغة موزونة بالمركز
  -- والمركز غير مُصوَّر على صفّ التقييم، فتغييره يعيد حساب كل التقييمات.
  select u.postion into v_position
  from public.users u
  where u.user_id = p_user_id and u.deleted_at is null;

  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  select json_build_object(
    'user_id',        u.user_id,
    'name',           coalesce(nullif(btrim(u.name), ''), '—'),
    'postion',        u.postion,
    'avatar_url',     u.avatar_url,
    'stc_pay_number', u.stc_pay_number,
    'created_at',     u.created_at
  ) into v_user
  from public.users u
  where u.user_id = p_user_id;

  -- التقييمات بحسب المجموعة. تسمية الوسائط بالاسم مقصودة: ترتيب وسائط
  -- player_rating_overall غير مضمون من التوقيع، والخطأ فيه يُنتج رقمًا
  -- معقولًا لكنه غلط.
  with r as (
    select
      pr.rater_id, pr.workspace_id, pr.created_at, pr.updated_at,
      pr.pace, pr.shooting, pr.passing, pr.defending, pr.stamina, pr.awareness,
      public.player_rating_overall(
        p_position  => v_position,
        p_pace      => pr.pace,
        p_shooting  => pr.shooting,
        p_passing   => pr.passing,
        p_defending => pr.defending,
        p_stamina   => pr.stamina,
        p_awareness => pr.awareness
      ) as overall
    from public.player_ratings pr
    where pr.ratee_id = p_user_id
  ),
  agg as (
    select
      r.workspace_id,
      count(*)            as rater_count,
      avg(r.pace)         as a_pace,
      avg(r.shooting)     as a_shooting,
      avg(r.passing)      as a_passing,
      avg(r.defending)    as a_defending,
      avg(r.stamina)      as a_stamina,
      avg(r.awareness)    as a_awareness,
      -- left join مقصود: rater_id بلا مفتاح أجنبي على users، فالمقيّم قد
      -- لا يملك صفًّا. نُبقي تقييمه في المتوسّط — الصفّ موجود والتطبيق
      -- يحسبه، وإسقاطه هنا يجعل اللوحة تخالف التطبيق.
      json_agg(json_build_object(
        'rater_id',   r.rater_id,
        'name',       coalesce(nullif(btrim(ru.name), ''), 'مستخدم محذوف'),
        'avatar_url', ru.avatar_url,
        'is_me',      (r.rater_id = auth.uid()),
        'overall',    r.overall,
        'pace',       r.pace,
        'shooting',   r.shooting,
        'passing',    r.passing,
        'defending',  r.defending,
        'stamina',    r.stamina,
        'awareness',  r.awareness,
        'created_at', r.created_at,
        'updated_at', r.updated_at
      ) order by (r.rater_id = auth.uid()) desc, r.updated_at desc) as raters
    from r
    left join public.users ru on ru.user_id = r.rater_id
    group by r.workspace_id
  )
  select coalesce(json_agg(json_build_object(
    'workspace_id', a.workspace_id,
    'name',         coalesce(nullif(btrim(w.name), ''), '—'),
    'rater_count',  a.rater_count,
    -- التقريب إلى صحيح قبل النداء مقصود ولازم: avg تُرجع numeric، وإن كانت
    -- وسائط player_rating_overall من نوع integer فلا يوجد تحويل ضمني من
    -- numeric إليه — يفشل النداء بـ «function does not exist». التحويل إلى
    -- integer سليم في الحالتين: integer→numeric ضمني لو كانت الوسائط numeric.
    'overall',      public.player_rating_overall(
                      p_position  => v_position,
                      p_pace      => round(a.a_pace)::integer,
                      p_shooting  => round(a.a_shooting)::integer,
                      p_passing   => round(a.a_passing)::integer,
                      p_defending => round(a.a_defending)::integer,
                      p_stamina   => round(a.a_stamina)::integer,
                      p_awareness => round(a.a_awareness)::integer
                    ),
    'averages',     json_build_object(
                      'pace',      round(a.a_pace, 1),
                      'shooting',  round(a.a_shooting, 1),
                      'passing',   round(a.a_passing, 1),
                      'defending', round(a.a_defending, 1),
                      'stamina',   round(a.a_stamina, 1),
                      'awareness', round(a.a_awareness, 1)
                    ),
    'raters',       a.raters
  ) order by a.rater_count desc, w.name), '[]'::json) into v_groups
  from agg a
  join public.workspaces w on w.id = a.workspace_id;

  -- تقييمي. مصفوفة لا كائن: التقييم محصور بمجموعة، وقد أُقيّم اللاعب
  -- نفسه في أكثر من مجموعة.
  select coalesce(json_agg(json_build_object(
    'workspace_id',   pr.workspace_id,
    'workspace_name', coalesce(nullif(btrim(w.name), ''), '—'),
    'pace',           pr.pace,
    'shooting',       pr.shooting,
    'passing',        pr.passing,
    'defending',      pr.defending,
    'stamina',        pr.stamina,
    'awareness',      pr.awareness,
    'overall',        public.player_rating_overall(
                        p_position  => v_position,
                        p_pace      => pr.pace,
                        p_shooting  => pr.shooting,
                        p_passing   => pr.passing,
                        p_defending => pr.defending,
                        p_stamina   => pr.stamina,
                        p_awareness => pr.awareness
                      ),
    'created_at',     pr.created_at,
    'updated_at',     pr.updated_at
  ) order by pr.updated_at desc), '[]'::json) into v_mine
  from public.player_ratings pr
  join public.workspaces w on w.id = pr.workspace_id
  where pr.ratee_id = p_user_id and pr.rater_id = auth.uid();

  select json_build_object(
    'workspace_count', (select count(*) from public.workspace_members m
                         where m.user_id = p_user_id),
    -- user_id يقبل NULL (المشاركون الضيوف)، فالمساواة تتجاهلهم من نفسها
    'events_joined',   (select count(*) from public.event_participants ep
                         where ep.user_id = p_user_id),
    'events_created',  (select count(*) from public.events e
                         where e.creator_id = p_user_id)
  ) into v_activity;

  return json_build_object(
    'user',       v_user,
    'scale',      json_build_object('min', v_scale_min, 'max', v_scale_max),
    'my_ratings', v_mine,
    'groups',     v_groups,
    'activity',   v_activity
  );
end;
$$;

revoke execute on function public.admin_get_player_profile(uuid) from public, anon;
grant  execute on function public.admin_get_player_profile(uuid) to authenticated;

-- --------------------------------------------------- 3) حذف تقييم واحد ---
-- أول كتابة تصل من اللوحة إلى قاعدة البيانات: كل دوال admin_ الأخرى
-- stable للقراءة. الحذف بالمفتاح المركّب كاملًا لأنّ player_ratings
-- بلا عمود id — هويّة التقييم هي (المقيّم، المُقيَّم، المجموعة).
create or replace function public.admin_delete_player_rating(
  p_rater_id     uuid,
  p_ratee_id     uuid,
  p_workspace_id uuid
)
returns json
language plpgsql
security definer
volatile
set search_path = public, pg_temp
as $$
declare v_row public.player_ratings;
begin
  if not public.is_current_user_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.player_ratings pr
   where pr.rater_id     = p_rater_id
     and pr.ratee_id     = p_ratee_id
     and pr.workspace_id = p_workspace_id
  returning pr.* into v_row;

  -- الرفع عند عدم التطابق مقصود: لو كانت الورقة قديمة (حُذف التقييم من
  -- مكان آخر) فالصمت يعني إبلاغ المشرف بنجاحٍ لم يحدث.
  if not found then
    raise exception 'rating not found' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_user_id, payload)
  values (auth.uid(), 'delete_player_rating', p_ratee_id, to_jsonb(v_row));

  return json_build_object('deleted', 1);
end;
$$;

revoke execute on function public.admin_delete_player_rating(uuid, uuid, uuid) from public, anon;
grant  execute on function public.admin_delete_player_rating(uuid, uuid, uuid) to authenticated;

commit;


-- =====================================================================
-- التحقّق — تُنفَّذ بعد التطبيق
-- ---------------------------------------------------------------------
-- 1) حدود التقييم الحقيقية. إن خالفت 1..99 فصحّح v_scale_min/v_scale_max
--    في admin_get_player_profile أعلاه:
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.player_ratings'::regclass and contype = 'c';
--
-- 2) وسند من البيانات نفسها:
--
--   select min(least(pace, shooting, passing, defending, stamina, awareness)) as lo,
--          max(greatest(pace, shooting, passing, defending, stamina, awareness)) as hi
--   from public.player_ratings;
--
-- 3) صيغة تقييم المجموعة. يحسب هذا الملف overall(متوسّط الصفات). قارنه
--    بمتوسّط overall لكل مقيّم؛ الفرق يظهر عند التقريب أو الحدّ:
--
--   with r as (
--     select pr.workspace_id, pr.pace, pr.shooting, pr.passing,
--            pr.defending, pr.stamina, pr.awareness,
--            public.player_rating_overall(
--              p_position => (select postion from public.users where user_id = '<ratee>'),
--              p_pace => pr.pace, p_shooting => pr.shooting, p_passing => pr.passing,
--              p_defending => pr.defending, p_stamina => pr.stamina,
--              p_awareness => pr.awareness) as overall
--     from public.player_ratings pr where pr.ratee_id = '<ratee>'
--   )
--   select workspace_id,
--          avg(overall) as avg_of_overall,
--          public.player_rating_overall(
--            p_position => (select postion from public.users where user_id = '<ratee>'),
--            p_pace => round(avg(pace))::integer,
--            p_shooting => round(avg(shooting))::integer,
--            p_passing => round(avg(passing))::integer,
--            p_defending => round(avg(defending))::integer,
--            p_stamina => round(avg(stamina))::integer,
--            p_awareness => round(avg(awareness))::integer) as overall_of_avg
--   from r group by workspace_id;
--
--    لو فشل النداء بـ «function does not exist» فوسائط الدالة numeric لا
--    integer — احذف ::integer وأعد التنفيذ، وصحّح الدالة أعلاه بالمثل.
--
--    ثم قارن overall_of_avg بما يُظهره التطبيق عبر
--    get_player_rating('<ratee>', '<workspace>').
--
-- 4) البوابة تعمل: نفّذ بحساب غير مشرف وتوقّع 42501.
--
--   select public.admin_get_player_profile('<any-user-id>');
-- =====================================================================
