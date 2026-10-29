-- Demonstration districts that tell their story more plainly.
--
-- The visitor CRP's next visits now include a Class 2 and a Class 3 that teach in Hindi, and the
-- sample recordings are placed there, so that opening a planned visit leads straight to recordings
-- to hear. A class whose teacher asked for a visit is visited soon after, as a CRP would, and about
-- one visit in three goes to a class not seen for a while instead of another follow-up, so that no
-- class goes a whole term unseen.

create or replace function private.demo_build_coaching(target_sandbox uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  first_month date;
  crp_number integer;
  crp_id uuid;
  visit_days integer[];
  day date;
  month_index integer;
  chosen record;
  visit_id uuid;
  key text;
  started timestamptz;
  lesson_seconds integer;
  moment_count integer;
  moment_number integer;
  moment_id uuid;
  moment_seconds integer;
  last_moment integer;
  agreed timestamptz;
  items text[];
  item_code text;
  item_number integer;
  answer text;
  first_no text;
  yes_chance double precision;
  practice text;
  strength_text text;
  child_name text;
  evidence text[];
  evidence_json jsonb;
  demo_given boolean;
  plan_note text;
  check_back date;
  result text;
  follows uuid;
  scored boolean;
  part_specific integer;
  part_evidence integer;
  part_focus integer;
  part_demo integer;
  part_check integer;
  part_respect integer;
  lowest text;
  visits_written integer := 0;
  focus_codes constant text[] := array[
    'sounds-before-letters', 'reads-for-meaning', 'teacher-models-reading', 'todays-textbook-page',
    'children-write', 'english-own-sentences', 'english-picture-talk', 'home-language-bridge',
    'bottom-group-turns', 'mistakes-handled-kindly', 'thinking-time', 'children-talk-more',
    'book-in-every-hand', 'walls-in-use', 'checks-understanding'
  ];
  strength_tags constant text[] := array['good-question', 'all-reading', 'child-helps-child', 'effort-praised', 'english-sentence', 'home-language-used'];
  concern_tags constant text[] := array['group-left-out', 'long-teacher-talk', 'chorus-only', 'off-task', 'harsh-correction', 'copying-only'];
  first_cluster uuid;
  open_request uuid;
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  first_month := date_trunc('month', sandbox.history_from)::date;

  drop table if exists demo_visit_state;
  create temporary table demo_visit_state on commit drop as
  select p.class_section_id, p.school_id, p.school_index, p.cluster_index, p.grade, p.medium,
    null::uuid as last_visit, null::date as last_visit_on, null::date as check_back_on, 0 as visits,
    p.grade + private.demo_rand(p.class_section_id::text || ':order') as priority
  from private.demo_places as p
  where p.sandbox_id = target_sandbox;

  -- Requests teachers sent; a later visit to the class answers each.
  insert into public.visit_requests (id, class_section_id, school_id, requested_by, topic, note, created_at)
  select private.demo_id(target_sandbox::text || ':request:' || n), s.class_section_id, s.school_id,
    private.demo_class_teacher(s.class_section_id),
    (array['reading', 'english', 'classroom'])[n],
    (array[
      'आधे बच्चे अभी भी मात्राओं पर अटकते हैं। कृपया अगली बार पठन पर साथ बैठें।',
      'बच्चे अंग्रेज़ी में एक शब्द से आगे नहीं बोलते। कोई आसान तरीका बताइए।',
      'कक्षा में 38 बच्चे हैं और पीछे वाले ध्यान नहीं देते। समूह कैसे बनाऊँ?'
    ])[n],
    private.demo_at(sandbox.history_from + 12 + n * 17, 900)
  from generate_series(1, 3) as n
  join demo_visit_state as s on s.cluster_index = 1 and s.school_index = 2 + n and s.grade = 1 + (n % 3);

  for crp_number in 1 .. 2 loop
    crp_id := private.demo_crp(target_sandbox, crp_number);
    visit_days := case crp_number when 1 then array[2, 3, 4] else array[1, 3, 5] end;

    for day in
      select d from private.demo_school_days(sandbox.history_from + 3, sandbox.built_on - 1) as d
      where extract(isodow from d)::integer = any (visit_days)
    loop
      -- An exam week or a block meeting now and then keeps the CRP away from the classroom.
      continue when private.demo_rand(crp_id::text || day::text || ':away') < 0.12;
      perform set_config('agla.demo_today', day::text, true);
      month_index := ((extract(year from day) - extract(year from first_month)) * 12
        + extract(month from day) - extract(month from first_month))::integer;

      -- A class whose teacher asked for a visit comes first. Then a step due to be checked, though
      -- about one visit in three goes to a class not seen for a while, so that every class is seen;
      -- otherwise the class seen least, Class 1 first.
      select s.* into chosen from demo_visit_state as s
      where s.cluster_index = crp_number
        and exists (
          select 1 from public.visit_requests as r
          where r.class_section_id = s.class_section_id
            and r.answered_by_visit_id is null
            and r.withdrawn_at is null
            and r.created_at < private.demo_at(day, 540)
        )
      order by s.priority
      limit 1;
      if not found and private.demo_rand(crp_id::text || day::text || ':widen') >= 0.35 then
        select * into chosen from demo_visit_state as s
        where s.cluster_index = crp_number and s.check_back_on is not null and s.check_back_on <= day
        order by s.check_back_on
        limit 1;
      end if;
      if not found then
        select * into chosen from demo_visit_state as s
        where s.cluster_index = crp_number and (s.last_visit_on is null or s.last_visit_on < day - 20)
        order by s.visits, s.priority
        limit 1;
      end if;
      if not found then
        select * into chosen from demo_visit_state as s
        where s.cluster_index = crp_number and s.check_back_on is not null and s.check_back_on <= day
        order by s.check_back_on
        limit 1;
      end if;
      continue when not found;

      key := target_sandbox::text || ':visit:' || crp_number || ':' || day::text;
      visit_id := private.demo_id(key);
      started := private.demo_at(day, 590 + 100 * private.demo_rand(key || ':start'));
      lesson_seconds := 2100 + floor(900 * private.demo_rand(key || ':length'))::integer;
      follows := chosen.last_visit;
      result := null;
      if follows is not null and chosen.check_back_on is not null and chosen.check_back_on <= day then
        result := case
          when private.demo_rand(key || ':result') < case crp_number when 1 then 0.28 + 0.13 * month_index else 0.3 + 0.04 * month_index end then 'practised'
          when private.demo_rand(key || ':result') < case crp_number when 1 then 0.62 + 0.09 * month_index else 0.64 + 0.03 * month_index end then 'partly'
          else 'not_yet'
        end;
      else
        follows := null;
      end if;

      select split_part(st.full_name, ' ', 1) into child_name
      from public.enrolments as e
      join public.students as st on st.id = e.student_id
      where e.class_section_id = chosen.class_section_id and st.status = 'active'
      order by private.demo_rand(st.id::text || key)
      limit 1;

      yes_chance := least(0.85, case crp_number when 1 then 0.32 + 0.11 * month_index else 0.34 + 0.05 * month_index end
        + case result when 'practised' then 0.15 when 'partly' then 0.05 else 0 end);

      insert into public.visits (
        id, class_section_id, school_id, crp_id, teacher_id, status, visited_on, started_at,
        lesson_note, follows_visit_id, follow_up_result, created_at, updated_at
      )
      values (
        visit_id, chosen.class_section_id, chosen.school_id, crp_id,
        private.demo_class_teacher(chosen.class_section_id), 'done', day, started,
        private.demo_pick(
          case chosen.medium
            when 'en' then array['English: story "The Thirsty Crow", page 24', 'English: reading words with "a", page 15',
                                 'English: picture talk, page 9', 'English: rhyme and new words, page 31']
            else array['हिंदी: कहानी "प्यासा कौआ", पृष्ठ 24', 'हिंदी: मात्राएँ ा और ि, पृष्ठ 18',
                       'हिंदी: कविता "बादल", पृष्ठ 36', 'हिंदी: शब्द पढ़ना और लिखना, पृष्ठ 12',
                       'अंग्रेज़ी: चित्र पर बातचीत, पृष्ठ 9']
          end,
          key || ':lesson'
        ),
        follows, result, started, started
      );

      -- Four focus items: whether every child read, and three more.
      items := array['every-child-reads'] || array(
        select code from unnest(focus_codes) as code
        order by private.demo_rand(key || code)
        limit 3
      );
      first_no := null;
      item_number := 0;
      foreach item_code in array items loop
        item_number := item_number + 1;
        answer := case
          when private.demo_rand(key || item_code || ':seen') < 0.08 then 'not_seen'
          when private.demo_rand(key || item_code || ':answer') < yes_chance then 'yes'
          else 'no'
        end;
        if answer = 'no' and first_no is null then
          first_no := item_code;
        end if;
        insert into public.visit_observations (visit_id, item_code, position, answer)
        values (visit_id, item_code, item_number, answer);
      end loop;

      -- Moments tapped while the lesson went on.
      moment_count := 4 + floor(4 * private.demo_rand(key || ':moments'))::integer;
      evidence := '{}';
      last_moment := 0;
      for moment_number in 1 .. moment_count loop
        moment_id := private.demo_id(key || ':moment:' || moment_number);
        moment_seconds := least(
          lesson_seconds,
          120 + (moment_number - 1) * (lesson_seconds - 240) / moment_count
            + floor(90 * private.demo_rand(key || ':at' || moment_number))::integer
        );
        last_moment := greatest(last_moment, moment_seconds);
        if private.demo_rand(key || ':tone' || moment_number) < yes_chance + 0.1 then
          insert into public.visit_moments (id, visit_id, tag_code, at_seconds, note)
          values (
            moment_id, visit_id,
            private.demo_pick(strength_tags, key || ':tag' || moment_number),
            moment_seconds,
            case when private.demo_rand(key || ':note' || moment_number) < 0.35 then
              replace(private.demo_pick(array[
                '{child} ने बिना रुके पूरी पंक्ति पढ़ी।',
                '{child} ने साथी को शब्द पढ़ने में मदद की।',
                '{child} ने अंग्रेज़ी में पूरा वाक्य बोला।',
                'पीछे की बेंच से {child} ने पहली बार उत्तर दिया।'
              ], key || ':notetext' || moment_number), '{child}', child_name)
            end
          );
          if cardinality(evidence) < (case when private.demo_rand(key || ':evidence') < 0.35 + 0.2 * month_index then 2 else 1 end)
             and (crp_number = 2 or month_index > 0 or private.demo_rand(key || ':cite') < 0.5)
          then
            evidence := evidence || ('moment:' || moment_id::text);
          end if;
        else
          insert into public.visit_moments (id, visit_id, tag_code, at_seconds, note)
          values (
            moment_id, visit_id,
            private.demo_pick(concern_tags, key || ':tag' || moment_number),
            moment_seconds,
            case when private.demo_rand(key || ':note' || moment_number) < 0.3 then
              private.demo_pick(array[
                'पीछे बैठे पाँच बच्चे किताब नहीं खोल रहे थे।',
                'पढ़ना केवल सामूहिक रूप से हुआ, किसी बच्चे ने अकेले नहीं पढ़ा।',
                'शिक्षक लगभग आठ मिनट लगातार बोलते रहे।',
                'बोर्ड से नकल में आधा समय गया।'
              ], key || ':notetext' || moment_number)
            end
          );
        end if;
      end loop;

      practice := private.demo_practice_for(coalesce(first_no, items[1]));
      if first_no is not null and private.demo_rand(key || ':cite-item') < 0.5 then
        evidence := evidence || ('item:' || first_no);
      end if;
      strength_text := private.demo_strength(key || ':strength', child_name, 6 + floor(14 * private.demo_rand(key || ':count'))::integer);
      demo_given := private.demo_rand(key || ':demo') < case crp_number when 1 then 0.3 + 0.17 * month_index else 0.35 end;
      plan_note := private.demo_pick(array[
        'अगले दो हफ़्ते रोज़ हिंदी के पीरियड में 10 मिनट यही अभ्यास। अगली विज़िट में तीन बच्चों को साथ सुनेंगे।',
        'कल से शुरू करेंगे; हर शुक्रवार को देखेंगे कि कितने बच्चों ने अकेले पढ़ा।',
        'पहले हफ़्ते केवल एक समूह के साथ, दूसरे हफ़्ते पूरी कक्षा के साथ।'
      ], key || ':plan');
      check_back := day + 14 + floor(5 * private.demo_rand(key || ':back'))::integer;
      agreed := least(
        now() - interval '30 minutes',
        started + make_interval(secs => last_moment)
          + make_interval(secs => 60 * greatest(
              4,
              case crp_number when 1 then 48 - 11 * month_index else 58 - 4 * month_index end
                + (private.demo_rand(key || ':delay') - 0.5) * 16
            ))
      );
      select coalesce(jsonb_agg(
          case when entry like 'moment:%'
            then jsonb_build_object('moment', substr(entry, 8))
            else jsonb_build_object('item', substr(entry, 6))
          end
        ), '[]'::jsonb)
      into evidence_json
      from unnest(evidence) as entry;

      insert into public.visit_feedback (
        visit_id, strength, evidence, practice_code, change_note, demo_given, plan_note,
        check_back_on, language, agreed_at
      )
      values (
        visit_id, strength_text, evidence_json, practice, private.demo_change(practice), demo_given,
        plan_note, check_back, 'hi', agreed
      );

      -- The CRP ended the visit a few minutes after agreeing the step.
      update public.visits
      set finished_at = least(started + interval '11 hours', agreed + interval '6 minutes'),
          done_at = least(now(), agreed + interval '6 minutes')
      where id = visit_id;

      -- Sahayak's score of the feedback, on the same six parts as always.
      scored := private.demo_rand(key || ':scored') < case crp_number when 1 then 0.85 else 0.7 end;
      if scored then
        part_specific := case
          when (strength_text like '%' || child_name || '%' or strength_text ~ '[0-9]')
               and private.demo_rand(key || ':specific') < case crp_number when 1 then 0.5 + 0.17 * month_index else 0.6 end
          then 2 else 1 end;
        part_evidence := least(2, cardinality(evidence));
        part_focus := case when private.demo_rand(key || ':focus') < case crp_number when 1 then 0.4 - 0.11 * month_index else 0.3 end then 1 else 2 end;
        part_demo := case when demo_given then 2 when private.demo_rand(key || ':shown') < 0.5 then 1 else 0 end;
        part_check := case when private.demo_rand(key || ':checkback') < case crp_number when 1 then 0.4 - 0.12 * month_index else 0.3 end then 1 else 2 end;
        part_respect := case when private.demo_rand(key || ':respect') < case crp_number when 1 then 0.16 - 0.05 * month_index else 0.12 end then 1 else 2 end;
        lowest := case least(part_specific, part_evidence, part_focus, part_demo, part_check, part_respect)
          when part_evidence then 'evidence'
          when part_demo then 'demonstration'
          when part_specific then 'specific'
          when part_focus then 'focus'
          when part_check then 'check'
          else 'respect'
        end;
        insert into public.visit_feedback_scores (
          visit_id, crp_id, specific, evidence, one_focus, demonstration, check_back, respectful,
          tip, language, model, feedback_agreed_at, feedback_fingerprint, scored_at
        )
        values (
          visit_id, crp_id, part_specific, part_evidence, part_focus, part_demo, part_check, part_respect,
          case lowest
            when 'evidence' then 'अगली बार ताकत के साथ वह पल भी बताइए जिसमें यह दिखा, जैसे किस बच्चे ने क्या पढ़ा।'
            when 'demonstration' then 'सुझाव को दो मिनट खुद करके दिखाइए; देखकर अपनाना आसान होता है।'
            when 'specific' then 'ताकत को किसी देखी हुई बात से जोड़िए: किसने, कब, क्या किया।'
            when 'focus' then 'एक ही बदलाव चुनिए; कई सुझाव एक साथ देने से शिक्षक किसी पर टिक नहीं पाते।'
            when 'check' then 'वापस देखने की तारीख शिक्षक के साथ तय कीजिए और लिख लीजिए।'
            else 'बात किसी अच्छी चीज़ से शुरू कीजिए जो आपने खुद देखी; इससे बातचीत सहज रहती है।'
          end,
          'hi', 'openai/gpt-oss-120b', agreed,
          private.demo_fingerprint(strength_text, evidence, practice, private.demo_change(practice), null, demo_given, plan_note, check_back),
          least(now(), agreed + make_interval(mins => 2 + floor(25 * private.demo_rand(key || ':scored-at'))::integer))
        );
      end if;

      -- In recent weeks the CRP re-checked one or two children the class had recorded.
      if day >= sandbox.built_on - 50 then
        insert into public.visit_rechecks (visit_id, check_id, reading_level, english_level)
        select visit_id, k.id, truth.reading, truth.english
        from public.pulse_checks as k
        join public.pulse_samples as s on s.id = k.sample_id
        join public.pulse_cycles as c on c.id = s.cycle_id
        cross join lateral private.demo_child(
          k.student_id, chosen.school_id, chosen.grade,
          ((extract(year from c.month) - extract(year from first_month)) * 12
            + extract(month from c.month) - extract(month from first_month))::integer,
          crp_number = 1
        ) as truth
        where k.class_section_id = chosen.class_section_id
          and k.mode = 'recorded'
          and (k.recorded_at at time zone 'Asia/Kolkata')::date between day - 30 and day
        order by private.demo_rand(k.id::text || key)
        limit case when private.demo_rand(key || ':rechecks') < 0.5 then 1 else 2 end;
      end if;

      update demo_visit_state
      set last_visit = visit_id, last_visit_on = day, check_back_on = check_back, visits = visits + 1
      where class_section_id = chosen.class_section_id;
      visits_written := visits_written + 1;
    end loop;
  end loop;

  -- What the visitor CRP sees today: an open request, the next visits planned, tasks, rehearsals.
  perform set_config('agla.demo_today', sandbox.built_on::text, true);
  open_request := private.demo_id(target_sandbox::text || ':request:open');
  insert into public.visit_requests (id, class_section_id, school_id, requested_by, topic, note, created_at)
  select open_request, s.class_section_id, s.school_id, private.demo_class_teacher(s.class_section_id),
    'reading', 'कक्षा 1 के छह बच्चे अभी अक्षर पहचान पर अटके हैं। कृपया अगली बार उनके साथ बैठें।',
    least(now() - interval '2 hours', private.demo_at(sandbox.built_on - 2, 940))
  from demo_visit_state as s
  where s.cluster_index = 1 and s.school_index = 1 and s.grade = 1;

  insert into public.visits (
    id, class_section_id, school_id, crp_id, teacher_id, status, planned_on, follows_visit_id,
    request_id, created_at, updated_at
  )
  select
    private.demo_id(target_sandbox::text || ':planned:' || planned.day_position),
    planned.class_section_id, planned.school_id, private.demo_crp(target_sandbox, 1),
    private.demo_class_teacher(planned.class_section_id), 'planned', planned.on_day,
    null,
    case when planned.school_index = 1 and planned.grade = 1 then open_request end,
    now() - interval '1 day', now() - interval '1 day'
  from (
    select s.*, d.on_day, d.position as day_position
    from (
      -- The class whose teacher asked for help, then a Class 2 and a Class 3 that teach in Hindi,
      -- where the sample recordings wait to be heard.
      select row_number() over (order by s.pick) as position, s.*
      from (
        (select s.*, 1 as pick from demo_visit_state as s
         where s.cluster_index = 1 and s.school_index = 1 and s.grade = 1)
        union all
        (select s.*, 2 from demo_visit_state as s
         where s.cluster_index = 1 and s.grade = 2 and s.medium = 'hi' and s.school_index <> 1
         order by s.check_back_on nulls last, s.visits, s.priority
         limit 1)
        union all
        (select s.*, 3 from demo_visit_state as s
         where s.cluster_index = 1 and s.grade = 3 and s.medium = 'hi' and s.school_index <> 1
         order by s.check_back_on nulls last, s.visits, s.priority
         limit 1)
      ) as s
    ) as s
    join (
      select next_day.on_day, row_number() over (order by next_day.on_day) as position
      from private.demo_school_days(sandbox.built_on, sandbox.built_on + 10) as next_day (on_day)
      where extract(isodow from next_day.on_day)::integer in (2, 3, 4)
      limit 3
    ) as d on d.position = s.position
  ) as planned;

  select c.cluster_id into first_cluster from public.schools as c
  join private.demo_places as p on p.school_id = c.id
  where p.sandbox_id = target_sandbox and p.cluster_index = 1 limit 1;

  insert into public.crp_tasks (id, cluster_id, school_id, created_by, title, details, source, due_on, done_at, created_at, updated_at)
  values
    (private.demo_id(target_sandbox::text || ':task:1'), first_cluster, null, private.demo_crp(target_sandbox, 1),
     'BRC को निपुण आकलन का कक्षावार सारांश भेजना', 'खंड शिक्षा अधिकारी के आदेश के अनुसार, सभी आठ विद्यालयों का।', 'order',
     sandbox.built_on + 5, null, now() - interval '6 days', now() - interval '6 days'),
    (private.demo_id(target_sandbox::text || ':task:2'), first_cluster, null, private.demo_crp(target_sandbox, 1),
     'संकुल बैठक: ध्वनि-खेल पर दो नमूना पाठ तैयार करना', null, 'meeting',
     sandbox.built_on + 9, null, now() - interval '3 days', now() - interval '3 days'),
    (private.demo_id(target_sandbox::text || ':task:3'), first_cluster, null, private.demo_crp(target_sandbox, 1),
     'विद्यालयों में पुस्तकालय की नई किताबें बाँटना', null, 'circular',
     sandbox.built_on - 6, now() - interval '8 days', now() - interval '20 days', now() - interval '8 days'),
    (private.demo_id(target_sandbox::text || ':task:4'), first_cluster, null, private.demo_crp(target_sandbox, 1),
     'कक्षा 1 के शिक्षकों के साथ अक्षर-ध्वनि कार्ड का प्रदर्शन', null, 'own',
     sandbox.built_on + 12, null, now() - interval '1 day', now() - interval '1 day');

  insert into public.rehearsal_debriefs (
    crp_id, scenario, language, turns, named_practice, asked_constraints, agreed_check_back,
    kept_blame_out, cited_evidence, went_well, try_next, provider, created_at
  )
  select
    private.demo_crp(target_sandbox, 1),
    (array['tired-veteran', 'pulse-defensive', 'eager-new-teacher', 'overloaded-head-teacher', 'tired-veteran'])[n],
    'hi',
    6 + n * 2,
    n >= 2, n >= 3, n >= 2, n <> 2, n >= 4,
    (array[
      'आपने बातचीत अच्छे माहौल में शुरू की और शिक्षक की बात ध्यान से सुनी।',
      'आपने एक ही अभ्यास पर बात टिकाए रखी और उसे नाम से बताया।',
      'आपने शिक्षक की कठिनाइयाँ पूछीं और उनके हिसाब से कदम छोटा किया।',
      'आपने वापस देखने की तारीख तय की और देखे हुए पल का हवाला दिया।',
      'पूरी बातचीत में दोष नहीं दिया, सबूत दिया, और अगला कदम साफ़ रहा।'
    ])[n],
    (array[
      'अगली बार बताइए कि आपने कक्षा में क्या देखा, और एक ही बदलाव चुनिए।',
      'शिक्षक के बचाव पर बहस नहीं, Pulse के आँकड़े साथ में देखिए।',
      'उत्साह के साथ छोटा, पहला कदम तय कीजिए जो कल से हो सके।',
      'समय की कमी मानिए और अभ्यास को मौजूदा पीरियड में ही जोड़िए।',
      'यही ढाँचा असली विज़िट में भी अपनाइए।'
    ])[n],
    'groq',
    least(now() - interval '1 day', private.demo_at(sandbox.history_from + 20 + n * 18, 1170))
  from generate_series(1, 5) as n
  where sandbox.history_from + 20 + n * 18 < sandbox.built_on;

  return jsonb_build_object('visits', visits_written);
end;
$$;

create or replace function private.demo_build_finish(target_sandbox uuid, details jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sandbox private.demo_sandboxes;
  recording jsonb;
  target record;
  check_id uuid;
  audio_type text;
  audio_path text;
  uploads jsonb := '[]'::jsonb;
  taken uuid[] := '{}';
begin
  select * into sandbox from private.demo_sandboxes where id = target_sandbox;
  perform set_config('agla.demo_today', sandbox.built_on::text, true);

  for recording in select value from jsonb_array_elements(coalesce(details -> 'recordings', '[]'::jsonb)) loop
    select s.id as sample_id, s.class_section_id, s.student_id, s.opens_on into target
    from public.pulse_samples as s
    join public.pulse_cycles as c on c.id = s.cycle_id
    join private.demo_places as p on p.class_section_id = s.class_section_id
    left join public.visits as v
      on v.class_section_id = s.class_section_id and v.status = 'planned'
    where p.sandbox_id = target_sandbox
      and p.cluster_index = 1 and p.medium = 'hi'
      and p.grade = (recording ->> 'grade')::integer
      and c.month = date_trunc('month', sandbox.built_on)::date
      and s.week is not null and s.opens_on <= sandbox.built_on and not s.adapted
      and not exists (select 1 from public.pulse_checks as k where k.sample_id = s.id)
      and not (s.id = any (taken))
      -- A child of this week first: their check is the newest the CRP will see.
      and (s.due_on >= sandbox.built_on or not exists (
        select 1 from public.visits as planned
        where planned.class_section_id = s.class_section_id and planned.status = 'planned'
      ))
    order by (v.id is null), private.demo_rand(s.id::text || (recording ->> 'key'))
    limit 1;
    continue when not found;
    taken := taken || target.sample_id;
    check_id := private.demo_id(target.sample_id::text || ':recording');
    audio_type := case recording ->> 'type' when 'audio/ogg' then 'audio/ogg' when 'audio/mp4' then 'audio/mp4' else 'audio/webm' end;
    audio_path := target.class_section_id || '/' || target.sample_id || '/' || check_id
      || case audio_type when 'audio/ogg' then '.ogg' when 'audio/mp4' then '.m4a' else '.webm' end;

    insert into public.pulse_checks (
      id, sample_id, class_section_id, student_id, mode, attempt, item_code, prompt_code, item,
      audio_path, audio_type, audio_bytes, duration_ms, noise_dbfs, reading_level, english_level,
      clarity, classroom, tags, recorded_at, recorded_by, received_at
    )
    values (
      check_id, target.sample_id, target.class_section_id, target.student_id, 'recorded', 1,
      recording ->> 'item_code', recording ->> 'prompt_code',
      jsonb_build_object(
        'reading', jsonb_build_object('code', recording ->> 'item_code', 'language', 'hi', 'grade', (recording ->> 'grade')::integer),
        'speaking', jsonb_build_object('code', recording ->> 'prompt_code', 'grade', (recording ->> 'grade')::integer),
        'shown', coalesce(recording -> 'shown', '[]'::jsonb),
        'restarts', 0
      ),
      audio_path, audio_type, (recording ->> 'bytes')::integer, (recording ->> 'duration_ms')::integer,
      -38, recording ->> 'teacher_reading', recording ->> 'teacher_english', 'clear', 'normal', '{}',
      least(now() - interval '2 hours', private.demo_at(greatest(target.opens_on, sandbox.built_on - 1), 620)),
      private.demo_class_teacher(target.class_section_id),
      least(now() - interval '1 hour', private.demo_at(greatest(target.opens_on, sandbox.built_on - 1), 650))
    );

    insert into public.pulse_scores (
      check_id, class_section_id, engine_version, reading_level, reached_level, reading_items,
      reading_correct, reading_seconds, wcpm, english_level, english_words, english_seconds,
      keyword_hits, other_language_share, confidence, flags
    )
    select check_id, target.class_section_id, score.engine_version, score.reading_level,
      score.reached_level, score.reading_items, score.reading_correct, score.reading_seconds,
      score.wcpm, score.english_level, score.english_words, score.english_seconds,
      score.keyword_hits, score.other_language_share, score.confidence, score.flags
    from jsonb_to_record(recording -> 'score') as score (
      engine_version text, reading_level text, reached_level text, reading_items smallint,
      reading_correct smallint, reading_seconds real, wcpm real, english_level text,
      english_words smallint, english_seconds real, keyword_hits smallint,
      other_language_share real, confidence real, flags text[]
    );

    uploads := uploads || jsonb_build_object('key', recording ->> 'key', 'path', audio_path, 'type', audio_type);
  end loop;

  update private.demo_sandboxes set status = 'ready', ready_at = now() where id = target_sandbox;
  return jsonb_build_object('uploads', uploads);
end;
$$;
