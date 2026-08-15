-- Project difficulty as named levels (beginner/intermediate/advanced) instead
-- of the 1-5 numeric scale introduced in 0016.

-- Drop the old 1-5 check before changing the column type.
alter table public.projects drop constraint if exists projects_difficulty_check;

-- Convert an existing numeric difficulty to text. Guarded so it's a no-op when
-- the column is already text (safe to re-run).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'difficulty'
      and data_type <> 'text'
  ) then
    alter table public.projects
      alter column difficulty type text
      using (
        case difficulty
          when 1 then 'beginner'
          when 2 then 'beginner'
          when 3 then 'intermediate'
          when 4 then 'advanced'
          when 5 then 'advanced'
          else null
        end
      );
  end if;
end $$;

alter table public.projects
  add constraint projects_difficulty_check
  check (difficulty is null or difficulty in ('beginner', 'intermediate', 'advanced'));
