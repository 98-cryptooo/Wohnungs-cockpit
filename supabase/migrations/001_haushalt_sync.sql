-- Haushalt-Sync (Wohnungs-Cockpit + Partner-App)
-- Einmalig im Supabase SQL Editor des NEUEN Projekts "Haushalt" ausfuehren.
-- Tabellen sind fuer den oeffentlichen Schluessel gesperrt.
-- Lesen und Schreiben geht nur ueber hh_pull und hh_push und nur mit dem richtigen Haushaltscode.
-- Spalte "list" trennt die Listen: heute nur 'shop' (Einkauf), spaeter z. B. 'tasks' oder 'cats'.

create table if not exists hh_households (
  code text primary key,
  created_at timestamptz not null default now()
);

create table if not exists hh_items (
  household text not null references hh_households(code) on delete cascade,
  list text not null,
  id text not null,
  data jsonb,
  ts bigint not null,
  deleted boolean not null default false,
  server_at timestamptz not null default clock_timestamp(),
  primary key (household, list, id)
);

create index if not exists hh_items_since on hh_items (household, list, server_at);

alter table hh_households enable row level security;
alter table hh_items enable row level security;
revoke all on hh_households, hh_items from anon, authenticated;

create or replace function hh_pull(p_code text, p_list text, p_since timestamptz)
returns table (id text, data jsonb, ts bigint, deleted boolean, server_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from hh_households h where h.code = p_code) then
    raise exception 'unknown household';
  end if;
  return query
    select i.id, i.data, i.ts, i.deleted, i.server_at
    from hh_items i
    where i.household = p_code and i.list = p_list
      and i.server_at > p_since - interval '10 seconds';
end $$;

create or replace function hh_push(p_code text, p_list text, p_items jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare it jsonb; n integer := 0;
begin
  if not exists (select 1 from hh_households h where h.code = p_code) then
    raise exception 'unknown household';
  end if;
  if p_list not in ('shop', 'recipes', 'tasks', 'cats', 'inbox-rik', 'inbox-melina') then
    raise exception 'unknown list';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'too many items';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into hh_items as s (household, list, id, data, ts, deleted, server_at)
    values (p_code, p_list, it->>'id', it->'data', (it->>'ts')::bigint,
            coalesce((it->>'deleted')::boolean, false), clock_timestamp())
    on conflict (household, list, id) do update
      set data = excluded.data, ts = excluded.ts, deleted = excluded.deleted, server_at = clock_timestamp()
      where s.ts < excluded.ts;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function hh_pull(text, text, timestamptz) from public;
revoke all on function hh_push(text, text, jsonb) from public;
grant execute on function hh_pull(text, text, timestamptz) to anon;
grant execute on function hh_push(text, text, jsonb) to anon;

