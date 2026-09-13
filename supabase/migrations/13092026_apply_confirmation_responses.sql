-- One-time: apply the "Do you accept your position?" confirmation responses to
-- the Fall 2026 draft outcomes.
--
-- Under 0092 the per-card outcome on the ?project=all board is the APPLICANT'S
-- answer, and "accepted" is the only one that does anything: it places them on
-- the project they were drafted under. This script is that same action, in bulk,
-- from the response sheet:
--
--   "Yesss!"  -> accepted: applications.status = 'accepted' + accepted_project_id,
--                a project_members row on their drafted project, members.status
--                = 'active'. Exactly what accept_application (0057) does.
--   "No :("   -> rejected: applications.status = 'rejected', placement cleared,
--                and any membership a previous acceptance created removed. Same
--                as set_draft_outcome(..., 'rejected') (0091). Their draft_pick
--                is KEPT, so the card stays on the board wearing a red chip.
--
-- It writes the rows directly rather than calling set_draft_outcome /
-- accept_application, because both gate on can_review_all_projects() and
-- auth.uid() is null in the SQL editor.
--
-- HOW TO RUN
--   1. Run it as-is. apply = false, so nothing is written -- you just get the
--      report at the bottom: what it would do, and everyone it can't place.
--   2. Read the report. Fix or accept the exceptions (see match_by_localpart).
--   3. Set apply = true in section 1 and run it again.
--
-- Safe to re-run: every write is absolute (set to this status, insert if absent),
-- never incremental.

begin;

-- 1. Knobs --------------------------------------------------------------------

drop table if exists pg_temp.sync_params;
create temp table sync_params as
select
  (select id from application_periods where name = 'Fall 2026') as period_id,
  -- false = report only. Flip to true to write.
  true as apply,
  -- A handful of sheet addresses have a typo'd domain (berkrley.edu,
  -- berkely.edu, berkelet.edu, berkeley.edu.in) or are a personal gmail, and so
  -- match no portal account by email. With this on, such a row is matched to the one
  -- member whose address has the same local part (the bit before the @) when
  -- there is exactly one -- and the report names both addresses so you can
  -- check each before trusting it. Off by default: it is a guess, not a lookup.
  false as match_by_localpart,
  -- Stamped into applications.reviewed_by. auth.uid() is null in the SQL
  -- editor, so name yourself here if you want the audit trail, e.g.
  --   (select user_id from members where lower(email) = 'you@berkeley.edu')
  null::uuid as reviewer_user_id;

-- 2. The response sheet --------------------------------------------------------
-- Pasted verbatim, duplicates and all. Section 3 does the tidying.

drop table if exists pg_temp.confirmation_sheet;
create temp table confirmation_sheet (email_raw text, answer text);
insert into confirmation_sheet (email_raw, answer) values
  ('jaydenszeto@berkeley.edu', 'No :('),
  ('jliu87@berkeley.edu', 'No :('),
  ('ysong111806@berkeley.edu', 'No :('),
  ('tristanmarston@berkeley.edu', 'No :('),
  ('nikkole@berkeley.edu', 'ChessBlitz'),
  ('aliciawang55@berkeley.edu', 'No :('),
  ('kaushik.chandolu@berkeley.edu', 'No :('),
  ('nimirose@berkeley.edu', 'No :('),
  ('anagha_mukunda@berkeley.edu', 'No :('),
  ('jzfang@berkeley.edu', 'No :('),
  ('maggiezliu@berkeley.edu', 'No :('),
  ('tianyueyang@berkeley.edu', 'No :('),
  ('yuwenhao03@berkeley.edu', 'No :('),
  ('ikshit_gupta@berkeley.edu', 'No :('),
  ('leo_yeo@berkeley.edu', 'No :('),
  ('esmebenitez@berkeley.edu', 'No :('),
  ('gavinlai@berkeley.edu', 'Yesss!'),
  ('sriya_bandarupalli@berkeley.edu', 'Yesss!'),
  ('samantha_van@berkeley.edu', 'Yesss!'),
  ('aaronlui@berkeley.edu', 'Yesss!'),
  ('htethtwe@berkeley.edu', 'Yesss!'),
  ('eom175@berkeley.edu', 'Yesss!'),
  ('matthew.rodrigues@berkeley.edu', 'Yesss!'),
  ('Myo_aung@berkeley.edu', 'Yesss!'),
  ('dylancc5@berkeley.edu', 'Yesss!'),
  ('natsimon51@berkeley.edu', 'Yesss!'),
  ('sam8rth@berkeley.edu', 'Yesss!'),
  ('wendyliu033@berkeley.edu', 'Yesss!'),
  ('annie_liu0189@berkeley.edu', 'Yesss!'),
  ('pedro_mt@berkeley.edu', 'Yesss!'),
  ('shelsy_coradope@berkeley.edu', 'Yesss!'),
  ('varunsanjeev@berkeley.edu', 'Yesss!'),
  ('justin_obomeghie@berkeley.edu', 'Yesss!'),
  ('Mattsu@berkeley.edu', 'Yesss!'),
  ('arielshehter@berkeley.edu', 'Yesss!'),
  ('farhankb@berkeley.edu', 'Yesss!'),
  ('kaz.takahashi@berkeley.edu', 'Yesss!'),
  ('qizheng_ye@berkeley.edu', 'Yesss!'),
  ('kaydenw@berkeley.edu', 'Yesss!'),
  ('yuhao1801@berkeley.edu', 'Yesss!'),
  ('evanhuang@berkeley.edu', 'Yesss!'),
  ('jamil_shirinov@berkeley.edu', 'Yesss!'),
  ('anthonyjihoo@gmail.com', 'Yesss!'),
  ('benjamin.woo@berkeley.edu', 'Yesss!'),
  ('venus_zhang@berkeley.edu', 'Yesss!'),
  ('ethan.rhee@berkeley.edu', 'Yesss!'),
  ('morganjiang@berkeley.edu', 'Yesss!'),
  ('christine_nguyen@berkeley.edu', 'Yesss!'),
  ('mpalance@berkeley.edu', 'Yesss!'),
  ('skylin@berkeley.edu', 'Yesss!'),
  ('aayan.agar@berkeley.edu', 'Yesss!'),
  ('17ejones@berkeley.edu', 'Yesss!'),
  ('neildaga@berkeley.edu', 'Yesss!'),
  ('emhuynh1209@berkeley.edu', 'Yesss!'),
  ('plee5@berkeley.edu', 'Yesss!'),
  ('saanvipchhabra@berkeley.edu.in', 'Yesss!'),
  ('rohit_mekkoth@berkeley.edu', 'Yesss!'),
  ('jinylee@berkrley.edu', 'Yesss!'),
  ('alexamrr@berkeley.edu', 'Yesss!'),
  ('camilafern18@berkeley.edu', 'Yesss!'),
  ('vevaan.verma@berkeley.edu', 'Yesss!'),
  ('ali_askari@berkeley.edu', 'Yesss!'),
  ('enochho1@berkeley.edu', 'Yesss!'),
  ('yunjin_huh@berkeley.edu', 'Yesss!'),
  ('tpak1103@berkeley.edu', 'Yesss!'),
  ('sherry1420@berkeley.edu', 'Yesss!'),
  ('george_shen@berkeley.edu', 'Yesss!'),
  ('angie_wang@berkeley.edu', 'Yesss!'),
  ('keira.tan@berkeley.edu', 'Yesss!'),
  ('pragyan_ramamoorthy@berkeley.edu', 'Yesss!'),
  ('kevinxyu@berkeley.edu', 'Yesss!'),
  ('jayjiang@berkeley.edu', 'Yesss!'),
  ('sophiatnguyens@berkeley.edu', 'Yesss!'),
  ('chelsy@berkeley.edu', 'Yesss!'),
  ('pavan_kosuru@berkeley.edu', 'Yesss!'),
  ('krishiv.bhatia@berkeley.edu', 'Yesss!'),
  ('Ronith.cv@berkeley.edu', 'Yesss!'),
  ('exl2813@berkeley.edu', 'Yesss!'),
  ('issacwoo@berkeley.edu', 'Yesss!'),
  ('parsafaraji@berkeley.edu', 'Yesss!'),
  ('zionwang08@berkeley.edu', 'Yesss!'),
  ('henry_do@berkeley.edu', 'Yesss!'),
  ('beverlydong@berkeley.edu', 'Yesss!'),
  ('jessiebao2007@berkeley.edu', 'Yesss!'),
  ('sau.kodak@berkeley.edu', 'Yesss!'),
  ('rickjarrenp@berkeley.edu', 'Yesss!'),
  ('veronicatle@berkeley.edu', 'Yesss!'),
  ('bianca_cardona@berkeley.edu', 'Yesss!'),
  ('karen_li@berkeley.edu', 'Yesss!'),
  ('alicesyli@berkeley.edu', 'Yesss!'),
  ('sanjay.anand@berkeley.edu', 'Yesss!'),
  ('alexa_hlujan@berkeley.edu', 'Yesss!'),
  ('richardluo1kk@berkeley.edu', 'Yesss!'),
  ('annathebest@berkeley.edu', 'Yesss!'),
  ('fxdeng@berkeley.edu', 'Yesss!'),
  ('liwanagronnalyn@berkeley.edu', 'Yesss!'),
  ('ianinearrayales@berkeley.edu', 'Yesss!'),
  ('dlee22@berkeley.edu', 'Yesss!'),
  ('albert_liu25@berkeley.edu', 'Yesss!'),
  ('nwu.cal@berkeley.edu', 'Yesss!'),
  ('kevina_ma@berkeley.edu', 'Yesss!'),
  ('andrei.jacques@berkeley.edu', 'Yesss!'),
  ('noahjkim@berkeley.edu', 'Yesss!'),
  ('timothy_he24@berkeley.edu', 'Yesss!'),
  ('fadriancoo@berkeley.edu', 'Yesss!'),
  ('fadriancoo@berkeley.edu', 'Yesss!'),
  ('mschaffer287@berkeley.edu', 'Yesss!'),
  ('szhang2187@berkeley.edu', 'Yesss!'),
  ('szhang2187@berkeley.edu', 'Yesss!'),
  ('raina_tang@berkeley.edu', 'Yesss!'),
  ('emreg@berkeley.edu', 'Yesss!'),
  ('jackyao@berkeley.edu', 'Yesss!'),
  ('chloeshenclt@berkeley.edu', 'Yesss!'),
  ('jackyao@berkeley.edu', 'Yesss!'),
  ('aidentran@berkeley.edu', 'Yesss!'),
  ('brantton@berkeley.edu', 'Yesss!'),
  ('amy_xie@berkeley.edu', 'Yesss!'),
  ('leqiyang1127@berkeley.edu', 'Yesss!'),
  ('Trinh', 'Yesss!'),
  ('rexhouyang@berkeley.edu', 'Yesss!'),
  ('brantton@berkeley.edu', 'Yesss!'),
  ('joseph_ong@berkeley.edu', 'Yesss!'),
  ('anzhang@berkeley.edu', 'Yesss!'),
  ('daniel.bao@berkeley.edu', 'Yesss!'),
  ('matthewkdj@berkeley.edu', 'Yesss!'),
  ('sri.meduri@berkeley.edu', 'Yesss!'),
  ('rohan_mathew@berkeley.edu', 'Yesss!'),
  ('virajgupta25@berkeley.edu', 'Yesss!'),
  ('ethanngo@berkeley.edu', 'Yesss!'),
  ('arjunagarwal@berkeley.edu', 'Yesss!'),
  ('arjunagarwal@berkeley.edu', 'Yesss!'),
  ('janet_tong@berkeley.edu', 'Yesss!'),
  ('selina_wen@berkeley.edu', 'Yesss!'),
  ('sathvikmalla17@berkeley.edu', 'Yesss!'),
  ('james_cheng24@berkeley.edu', 'Yesss!'),
  ('violet.zimengye@berkeley.edu', 'Yesss!'),
  ('avinanvari@berkeley.edu', 'Yesss!'),
  ('chinopun@berkeley.edu', 'Yesss!'),
  ('aydan_gonzalez@berkeley.edu', 'Yesss!'),
  ('jialei.ni@berkeley.edu', 'Yesss!'),
  ('whjk2001@berkeley.edu', 'Yesss!'),
  ('eric.h.nguyen1213@berkeley.edu', 'Yesss!'),
  ('ganguli.anuja@berkeley.edu', 'Yesss!'),
  ('Sahilshah@berkeley.edu', 'Yesss!'),
  ('monicachen@berkeley.edu', 'Yesss!'),
  ('evanhyip@berkeley.edu', 'Yesss!'),
  ('martinachuyue_wu@berkeley.edu', 'Yesss!'),
  ('will.lopezz_@berkeley.edu', 'Yesss!'),
  ('gia_khanh@berkeley.edu', 'Yesss!'),
  ('himankgangwal@berkeley.edu', 'Yesss!'),
  ('kaiping_cheng@berkeley.edu', 'Yesss!'),
  ('avnig07@berkeley.edu', 'Yesss!'),
  ('divyanam@berkelet.edu', 'Yesss!'),
  ('shaoyu@berkeley.edu', 'Yesss!'),
  ('manoj_cherukuri_08@berkeley.edu', 'Yesss!'),
  ('ramosrangeldavid@berkeley.edu', 'Yesss!'),
  ('aaronperez.11.16@gmail.com', 'Yesss!'),
  ('lindatang0213@berkeley.edu', 'Yesss!'),
  ('rijulr@berkeley.edu', 'Yesss!'),
  ('veronicayting@berkeley.edu', 'Yesss!'),
  ('kelvin.huang@berkeley.edu', 'Yesss!'),
  ('manoj_cherukuri_08@berkeley.edu', 'Yesss!'),
  ('audreyestanislao@berkeley.edu', 'Yesss!'),
  ('abby_zhang@berkeley.edu', 'Yesss!'),
  ('rryanhh@berkely.edu', 'Yesss!'),
  ('anisha.singh@berkeley.edu', 'Yesss!'),
  ('freyas@berkeley.edu', 'Yesss!'),
  ('Akumar07@berkeley.edu', 'Yesss!'),
  ('abby_zhang@berkeley.edu', 'Yesss!'),
  ('zavionlewis@berkeley.edu', 'Yesss!'),
  ('shanzha526@berkeley.edu', 'Yesss!'),
  ('andu@berkeley.edu', 'Yesss!'),
  ('reneeli@berkeley.edu', 'Yesss!'),
  ('meow3082@berkeley.edu', 'Yesss!'),
  ('suwenmei@berkeley.edu', 'Yesss!'),
  ('eva.jiang@berkeley.edu', 'Yesss!'),
  ('Noah.lee@berkeley.edu', 'Yesss!'),
  ('ale275@berkeley.edu', 'Yesss!'),
  ('shengkaijiang0930@berkeley.edu', 'Yesss!'),
  ('austin_liu@berkeley.edu', 'Yesss!'),
  ('jweisser@berkeley.edu', 'Yesss!'),
  ('dylan.t.hunter@berkeley.edu', 'Yesss!'),
  ('bhavya.shanmugam@berkeley.edu', 'Yesss!'),
  ('noiritgc@berkeley.edu', 'Yesss!'),
  ('liuh5469@berkeley.edu', 'Yesss!'),
  ('botu@berkeley.edu', 'Yesss!'),
  ('shreyasmenon@berkeley.edu', 'Yesss!'),
  ('vdkarthikeya@berkeley.edu', 'Yesss!'),
  ('tanay_kumar@berkeley.edu', 'Yesss!'),
  ('davidcruzsantiago@berkeley.edu', 'Yesss!'),
  ('rohankamath@berkeley.edu', 'Yesss!'),
  ('jiunsull@berkeley.edu', 'Yesss!'),
  ('ruthvik_somashekar@berkeley.edu', 'Yesss!'),
  ('cherylbrawijaya@berkeley.edu', 'Yesss!'),
  ('briantran07@berkeley.edu', 'Yesss!'),
  ('dillonpatel@berkeley.edu', 'Yesss!'),
  ('jasonhe@berkeley.edu', 'Yesss!'),
  ('jasonhe@berkeley.edu', 'Yesss!'),
  ('angeline_wibowo@berkeley.edu', 'Yesss!'),
  ('tsiddique@berkeley.edu', 'Yesss!'),
  ('jennifer_yhn@berkeley.edu', 'Yesss!'),
  ('alice_xin@berkeley.edu', 'Yesss!'),
  ('anguyen8592@gmail.com', 'Yesss!'),
  ('shane_mak@berkeley.edu', 'Yesss!'),
  ('mattlim@berkeley.edu', 'Yesss!'),
  ('somesh.sri@berkeley.edu', 'Yesss!'),
  ('harishnarayanan@berkeley.edu', 'Yesss!'),
  ('enguunch07@gmail.com', 'Yesss!'),
  ('zzhao29@berkeley.edu', 'Yesss!'),
  ('kaihua@berkeley.edu', 'Yesss!'),
  ('ymai@berkeley.edu', 'Yesss!'),
  ('carlosalfaro@berkeley.edu', 'Yesss!'),
  ('maxli2030@berkeley.edu', 'Yesss!'),
  ('edwardzfh@berkeley.edu', 'Yesss!'),
  ('Janicedeng@berkeley.edu', 'Yesss!'),
  ('hzhang083@berkeley.edu', 'Yesss!'),
  ('mong_vu@berkeley.edu', 'Yesss!'),
  ('contrerasd@berkeley.edu', 'Yesss!'),
  ('leedoil251@berkeley.edu', 'Yesss!'),
  ('krish_chikara@berkeley.edu', 'Yesss!'),
  ('kathleen_maung@berkeley.edu', 'Yesss!'),
  ('Juliannamunoz30@berkeley.edu', 'Yesss!'),
  ('annieyhan@berkeley.edu', 'Yesss!'),
  ('mtsui0721@berkeley.edu', 'Yesss!'),
  ('clementine_conway@berkeley.edu', 'Yesss!'),
  ('mikeaka@berkeley.edu', 'Yesss!'),
  ('Isabella_widosh@berkeley.edu', 'Yesss!'),
  ('hs_6008909@berkeley.edu', 'Yesss!'),
  ('rodrigo-27@berkeley.edu', 'Yesss!'),
  ('oscardavidorf@berkeley.edu', 'Yesss!'),
  ('anniedli@berkeley.edu', 'Yesss!'),
  ('patrickabarca@berkeley.edu', 'Yesss!'),
  ('aidenson@berkeley.edu', 'Yesss!'),
  ('wangzy07@berkeley.edu', 'Yesss!'),
  ('the.steven123@berkeley.edu', 'Yesss!'),
  ('williec7@berkeley.edu', 'Yesss!'),
  ('soorim.choi@berkeley.edu', 'Yesss!'),
  ('akim242@berkeley.edu', 'Yesss!'),
  ('brian_huang_2030@berkeley.edu', 'Yesss!'),
  ('kimn@berkeley.edu', 'Yesss!'),
  ('julie2025@berkeley.edu', 'Yesss!'),
  ('sahildhar2025@berkeley.edu', 'Yesss!'),
  ('yisha_tang@berkeley.edu', 'Yesss!'),
  ('elepe_1205@berkeley.edu', 'Yesss!'),
  ('hiromaru2026@berkeley.edu', 'Yesss!'),
  ('ansanchez@berkeley.edu', 'Yesss!'),
  ('ayli@berkeley.edu', 'Yesss!'),
  ('yisha_tang@berkeley.edu', 'Yesss!'),
  ('mugdhasharma@berkeley.edu', 'Yesss!'),
  ('jacey_tang@berkeley.edu', 'Yesss!'),
  ('alexisdaniepadilla@berkeley.edu', 'Yesss!'),
  ('marryamzia@berkeley.edu', 'Yesss!'),
  ('tylersheridan@berkeley.edu', 'Yesss!'),
  ('keerath_pujji@berkeley.edu', 'Yesss!'),
  ('achen2030@berkeley.edu', 'Yesss!'),
  ('leticiaalvfranco@berkeley.edu', 'Yesss!'),
  ('bsaravanagupta@berkeley.edu', 'Yesss!'),
  ('benjamin_telanoff@berkeley.edu', 'Yesss!'),
  ('breanna_thayillam@berkeley.edu', 'Yesss!'),
  ('rita_ma@berkeley.edu', 'Yesss!'),
  ('maino_johnston@berkeley.edu', 'Yesss!'),
  ('Tylor-griffin@berkeley.edu', 'Yesss!'),
  ('renjie_tee@berkeley.edu', 'Yesss!'),
  ('matthewkdj@berkeley.edu', 'Yesss!'),
  ('jialinghuang@berkeley.edu', 'Yesss!'),
  ('nurikim@berkeley.edu', 'Yesss!'),
  ('yitorng_chin@berkeley.edu', 'Yesss!'),
  ('tittiranonda@berkeley.edu', 'Yesss!'),
  ('angel_saavedra@berkeley.edu', 'Yesss!'),
  ('jaydenkyw@berkeley.edu', 'No :('),
  ('meganhan@berkeley.edu', 'No :('),
  ('bn910@berkeley.edu', 'Yesss!'),
  ('justin.le@berkeley.edu', 'Yesss!'),
  ('nachiappanhari17@berkeley.edu', 'Yesss!'),
  ('Taito.holdaway@berkeley.edu', 'Yesss!'),
  ('lucas.s@berkeley.edu', 'Yesss!'),
  ('drlopez@berkeley.edu', 'Yesss!'),
  ('aarav_shah@berkeley.edu', 'Yesss!');

-- 3. One row per person, with the answer read -----------------------------------
-- Anything starting "yes" is an acceptance and anything starting "no" a
-- decline; everything else stays null and is reported rather than guessed at.
-- distinct_answers > 1 means the same address said both things on different
-- rows -- also reported, never applied.

drop table if exists pg_temp.sheet_response;
create temp table sheet_response as
select
  email,
  count(*)                                           as sheet_rows,
  count(distinct outcome)                            as distinct_answers,
  min(outcome)                                       as outcome,
  bool_or(outcome is null)                           as has_unreadable_answer
from (
  select
    nullif(lower(trim(email_raw)), '') as email,
    case
      when answer ilike 'yes%' then 'accepted'
      when answer ilike 'no%'  then 'rejected'
    end as outcome
  from confirmation_sheet
) x
where email is not null
group by email;

-- 4. Resolve each response to the pick it belongs to ----------------------------
-- A confirmed pick wins over a staged one, and the earliest of either; 0088's
-- claimed check means an applicant can only be confirmed by one project anyway.

drop table if exists pg_temp.period_pick;
create temp table period_pick as
select distinct on (dp.application_id)
  dp.application_id,
  rp.project_id,
  rp.submitted_at is not null as confirmed
from draft_picks dp
join draft_round_projects rp on rp.id = dp.round_project_id
join draft_rounds dr        on dr.id = rp.round_id
where dr.period_id = (select period_id from sync_params)
order by dp.application_id, (rp.submitted_at is null), dp.created_at;

drop table if exists pg_temp.resolved;
create temp table resolved as
with by_email as (
  select r.*, m.user_id, m.email as account_email, false as by_localpart
  from sheet_response r
  join members m on lower(m.email) = r.email
),
-- Only for addresses that matched nothing above, and only when exactly one
-- member shares the local part.
by_localpart as (
  select r.*, m.user_id, m.email as account_email, true as by_localpart
  from sheet_response r
  cross join lateral (
    select m2.user_id, m2.email
    from members m2
    where split_part(lower(m2.email), '@', 1) = split_part(r.email, '@', 1)
    limit 1
  ) m
  where (select match_by_localpart from sync_params)
    and not exists (select 1 from members m3 where lower(m3.email) = r.email)
    and (select count(*) from members m4
         where split_part(lower(m4.email), '@', 1) = split_part(r.email, '@', 1)) = 1
),
matched as (
  select * from by_email
  union all
  select * from by_localpart
)
select
  r.email,
  r.outcome,
  r.distinct_answers,
  r.has_unreadable_answer,
  mt.user_id,
  mt.account_email,
  coalesce(mt.by_localpart, false)                as by_localpart,
  trim(coalesce(mb.preferred_firstname, '') || ' ' || coalesce(mb.lastname, '')) as name,
  a.id                                            as application_id,
  a.status                                        as status_before,
  -- Read BEFORE anything is written: section 5's cleanup needs the placement
  -- this person had when the script started.
  a.accepted_project_id                           as accepted_project_before,
  pk.project_id,
  pk.confirmed                                    as pick_confirmed,
  p.name                                          as project_name
from sheet_response r
left join matched mt      on mt.email = r.email
left join members mb      on mb.user_id = mt.user_id
left join applications a  on a.applicant_id = mt.user_id
                         and a.period_id = (select period_id from sync_params)
left join period_pick pk  on pk.application_id = a.id
left join projects p      on p.id = pk.project_id;

-- What can actually be acted on: a readable, unanimous answer, from someone with
-- an account, an application this period, and a pick to be placed on.
drop table if exists pg_temp.to_apply;
create temp table to_apply as
select *
from resolved
where outcome is not null
  and distinct_answers = 1
  and application_id is not null
  and project_id is not null;

-- 5. The writes -----------------------------------------------------------------
-- All gated on sync_params.apply, so a report-only run touches nothing.

-- (a) Clear a placement that is being moved or taken away. Mirrors
--     set_draft_outcome's undo block: only rows acceptance itself created
--     (is_pm = false) are ever removed, and the 0013 triggers carry the delete
--     into the project's portal roster. Runs first, while accepted_project_before
--     is still what the database holds.
delete from public.project_members pm
using to_apply t
where (select apply from sync_params)
  and t.accepted_project_before is not null
  and pm.user_id    = t.user_id
  and pm.project_id = t.accepted_project_before
  and not pm.is_pm
  and (t.outcome <> 'accepted' or t.accepted_project_before is distinct from t.project_id);

-- (b) The decision itself.
update public.applications a
set status              = t.outcome,
    accepted_project_id = case when t.outcome = 'accepted' then t.project_id end,
    reviewed_by         = coalesce((select reviewer_user_id from sync_params), auth.uid()),
    reviewed_at         = now()
from to_apply t
where (select apply from sync_params)
  and a.id = t.application_id;

-- (c) Membership for everyone who said yes. on conflict: a returning member may
--     already be on the project.
insert into public.project_members (project_id, user_id, is_pm)
select t.project_id, t.user_id, false
from to_apply t
where (select apply from sync_params)
  and t.outcome = 'accepted'
on conflict (project_id, user_id) do nothing;

-- (d) ... and make them active. The 0065 trigger already promotes anyone (c)
--     actually inserted, but does nothing for a row that hit the conflict, so
--     this closes that gap the way accept_application does. members_status_guard
--     (0042/0065) blocks a status write from a caller that is neither
--     board/exec nor flagged as a system sync, and auth.uid() is null here --
--     hence the GUC, transaction-local, exactly as sync_activate_member sets it.
--     Blacklisted members are left alone: an acceptance must not quietly undo a
--     blacklist.
select set_config('app.member_status_sync', 'on', true)
where (select apply from sync_params);

update public.members m
set status = 'active'
from to_apply t
where (select apply from sync_params)
  and m.user_id = t.user_id
  and t.outcome = 'accepted'
  and m.status is distinct from 'active'
  and m.status is distinct from 'blacklisted';

-- 6. The report ------------------------------------------------------------------

select * from (
  select 0 as ord, '0 · mode' as bucket,
         case when (select apply from sync_params) then 'APPLIED — rows were written'
              else 'DRY RUN — nothing written; set apply = true to write' end as who,
         null::text as detail, null::text as project

  union all select 1, '1 · summary', 'responses (unique addresses)', count(*)::text, null from sheet_response
  union all select 1, '1 · summary', 'set to accepted', count(*)::text, null from to_apply where outcome = 'accepted'
  union all select 1, '1 · summary', 'set to rejected', count(*)::text, null from to_apply where outcome = 'rejected'
  union all select 1, '1 · summary', 'of those, already at that status',
         count(*)::text, null from to_apply where status_before = outcome
  union all select 1, '1 · summary', 'drafted picks this period', count(*)::text, null from period_pick
  union all select 1, '1 · summary', 'drafted, no response in sheet', count(*)::text, null
         from period_pick pk
         join applications a on a.id = pk.application_id
         left join members m on m.user_id = a.applicant_id
         where lower(coalesce(m.email, '')) not in (select email from sheet_response)

  -- Per project, so the headcounts can be eyeballed against what each PM expects.
  union all
  select 2, '2 · accepted by project', p.name, count(*)::text, null
  from to_apply t join projects p on p.id = t.project_id
  where t.outcome = 'accepted'
  group by p.name

  -- Everything below is a response that was NOT applied.
  union all
  select 3, '3 · no portal account', r.email, 'nothing matches this address',
         (select string_agg(m2.email, ', ')
          from members m2
          where split_part(lower(m2.email), '@', 1) = split_part(r.email, '@', 1))
  from resolved r where r.user_id is null

  union all
  select 4, '4 · no application', r.email, 'has an account, but no application this period', r.name
  from resolved r where r.user_id is not null and r.application_id is null

  union all
  select 5, '5 · not drafted', r.email, 'application is ' || r.status_before || ', but no draft pick', r.name
  from resolved r where r.application_id is not null and r.project_id is null

  union all
  select 6, '6 · answer not readable', r.email, 'sheet says something other than yes/no', r.project_name
  from resolved r where r.outcome is null

  union all
  select 7, '7 · conflicting answers', r.email,
         r.distinct_answers::text || ' different answers for this address', r.project_name
  from resolved r where r.distinct_answers > 1

  -- Matched on a guess rather than the address itself; check each one.
  union all
  select 8, '8 · matched by local part', r.email, 'matched to ' || r.account_email, r.project_name
  from resolved r where r.by_localpart

  -- Placed from a pick the draft never confirmed.
  union all
  select 9, '9 · staged pick only', t.email, 'placed from an unconfirmed draft window', t.project_name
  from to_apply t where not t.pick_confirmed

  -- And the other direction: drafted, but the sheet has nothing for them.
  union all
  select 10, '10 · drafted, no response',
         coalesce(nullif(lower(m.email), ''), '(no email on file)'),
         trim(coalesce(m.preferred_firstname, '') || ' ' || coalesce(m.lastname, '')),
         p.name
  from period_pick pk
  join applications a on a.id = pk.application_id
  join projects p     on p.id = pk.project_id
  left join members m on m.user_id = a.applicant_id
  where lower(coalesce(m.email, '')) not in (select email from sheet_response)
) z
order by ord, bucket, who;

commit;
