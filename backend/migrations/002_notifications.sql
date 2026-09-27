-- Notifications: short in-app messages for a practice (launch messages,
-- billing-code changes, prior auth needed, ready to treat). Each links to the
-- page where the related work happens; the task board stays where work is done.
-- Only adds a new table; no existing table changes.

create table if not exists public.notifications (
  id             bigint generated always as identity primary key,
  practice_id    bigint not null references public.practices (id) on delete cascade,
  role           varchar not null default 'doctor'
                   check (role in ('doctor', 'front_desk', 'nurse', 'biller')),
  kind           varchar not null,
  title          varchar not null,
  body           text,
  link           varchar,
  application_id varchar references public.drugs (application_id) on delete cascade,
  treatment_id   bigint references public.treatments (id) on delete cascade,
  dedupe_key     varchar not null,
  created_at     timestamptz not null default now(),
  read_at        timestamptz,
  unique (practice_id, dedupe_key)
);

create index if not exists notifications_practice_role_idx
  on public.notifications (practice_id, role, read_at);

-- Same pattern as every other table: RLS on with no policies, so only the
-- backend (service role) can read or write it.
alter table public.notifications enable row level security;

comment on table public.notifications is
  'In-app notifications for a practice. One row per message; dedupe_key (unique per practice) makes each message idempotent.';
comment on column public.notifications.role is 'Who it is for: doctor, front_desk, nurse or biller.';
comment on column public.notifications.kind is 'Machine tag: launch_message, code_change_upcoming, code_changed, prior_auth_needed, ready_to_treat.';
comment on column public.notifications.link is 'App route to open, e.g. /drugs/BLA761508.';
comment on column public.notifications.dedupe_key is 'Stable key per message (e.g. launch:BLA761508) so the same message is never created twice.';
comment on column public.notifications.read_at is 'When it was marked read; null means unread.';

-- Tell the Supabase API about the new table right away.
notify pgrst, 'reload schema';
