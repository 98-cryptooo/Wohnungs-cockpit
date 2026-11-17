-- Abo-Links der Kalender, gesperrt fuer den oeffentlichen Schluessel. Liest nur die Funktion calendar (service role).
create table if not exists hh_calendars (
  household text not null references hh_households(code) on delete cascade,
  url text not null,
  label text,
  created_at timestamptz not null default now(),
  primary key (household, url)
);
alter table hh_calendars enable row level security;
revoke all on hh_calendars from anon, authenticated;
create extension if not exists pg_net;
