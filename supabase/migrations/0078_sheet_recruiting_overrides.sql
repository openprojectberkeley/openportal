-- Board/exec overrides for recruiting fields from the applications sheet view.
-- Client RLS cannot assign a coffee host other than self, or reliably clear
-- infosession attendance for another applicant; these SECURITY DEFINER RPCs
-- mirror set_member_status (0042).

-- 1. set_applicant_coffee_chat ------------------------------------------------
-- p_status: 'done' | 'booked' | 'none'
-- done/booked require p_host_id; upserts a seat for (host, applicant).
-- none deletes every coffee_chats row for that applicant.

create or replace function public.set_applicant_coffee_chat(
  p_applicant_id uuid,
  p_status text,
  p_host_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_complete boolean;
begin
  if not public.is_board_or_exec() then
    raise exception 'not authorized';
  end if;

  if p_applicant_id is null then
    raise exception 'applicant required';
  end if;

  if p_status not in ('done', 'booked', 'none') then
    raise exception 'invalid status';
  end if;

  if p_status = 'none' then
    delete from public.coffee_chats
    where applicant_id = p_applicant_id;
    return;
  end if;

  if p_host_id is null then
    raise exception 'host required';
  end if;

  if p_host_id = p_applicant_id then
    raise exception 'cannot assign applicant as their own host';
  end if;

  if not exists (select 1 from public.members where user_id = p_applicant_id) then
    raise exception 'applicant not found';
  end if;

  if not exists (select 1 from public.members where user_id = p_host_id) then
    raise exception 'host not found';
  end if;

  v_complete := (p_status = 'done');

  select c.id
    into v_existing_id
  from public.coffee_chats c
  where c.member_id = p_host_id
    and c.applicant_id = p_applicant_id
  order by c.meeting_time desc nulls last
  limit 1;

  if v_existing_id is not null then
    update public.coffee_chats
    set complete = v_complete,
        no_show = case when v_complete then false else no_show end
    where id = v_existing_id;
  else
    insert into public.coffee_chats (
      member_id,
      applicant_id,
      meeting_time,
      complete,
      no_show,
      duration_minutes
    ) values (
      p_host_id,
      p_applicant_id,
      now(),
      v_complete,
      false,
      15
    );
  end if;
end;
$$;

grant execute on function public.set_applicant_coffee_chat(uuid, text, uuid) to authenticated;

-- 2. set_applicant_infosession ------------------------------------------------
-- true: ensure a claimed attendance row exists (synthetic admin code if needed).
-- false: delete claimed rows for that applicant_id.

create or replace function public.set_applicant_infosession(
  p_applicant_id uuid,
  p_attended boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_board_or_exec() then
    raise exception 'not authorized';
  end if;

  if p_applicant_id is null then
    raise exception 'applicant required';
  end if;

  if p_attended then
    if exists (
      select 1 from public.infosesh_attendance
      where applicant_id = p_applicant_id
         or member_id = p_applicant_id
    ) then
      return;
    end if;

    insert into public.infosesh_attendance (code, member_id, applicant_id)
    values (
      'admin-' || gen_random_uuid()::text,
      auth.uid(),
      p_applicant_id
    );
  else
    delete from public.infosesh_attendance
    where applicant_id = p_applicant_id;
  end if;
end;
$$;

grant execute on function public.set_applicant_infosession(uuid, boolean) to authenticated;
