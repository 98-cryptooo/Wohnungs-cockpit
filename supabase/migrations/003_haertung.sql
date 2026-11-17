-- Haertung des Haushalt-Sync. Einmalig im Supabase SQL Editor ausfuehren, NACH 001 und 002.
-- Was sich aendert:
--  1. hh_pull prueft die Liste wie hh_push (nur bekannte Listen).
--  2. Neue Funktion hh_now() liefert die Serverzeit fuer die Uhr-Korrektur der App.
--  3. Haushaltscodes muessen mindestens 32 Zeichen lang sein.
--  4. Groessen und Mengen sind begrenzt: pro Eintrag, pro Push, pro Liste.
--  5. Zeitstempel in der Zukunft werden auf "jetzt plus 5 Minuten" gedeckelt.
--  6. Ein Haushalt darf hoechstens 60 Pushes pro Minute senden.
-- Hinweis: Die Edge Function calendar muss danach neu bereitgestellt werden (Codelaenge 32).

alter table hh_households drop constraint if exists hh_code_min_len;
alter table hh_households add constraint hh_code_min_len check (length(code) >= 32);

create table if not exists hh_rate (
  household text not null references hh_households(code) on delete cascade,
  minute bigint not null,
  n integer not null default 0,
  primary key (household, minute)
);
alter table hh_rate enable row level security;
revoke all on hh_rate from anon, authenticated;

create or replace function hh_pull(p_code text, p_list text, p_since timestamptz)
returns table (id text, data jsonb, ts bigint, deleted boolean, server_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from hh_households h where h.code = p_code) then
    raise exception 'unknown household';
  end if;
  if p_list not in ('shop', 'recipes', 'tasks', 'cats', 'inbox-rik', 'inbox-melina') then
    raise exception 'unknown list';
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
declare
  it jsonb;
  v_n integer := 0;
  v_id text;
  v_ts bigint;
  v_max_ts bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint + 300000;
  v_max_bytes integer;
  v_minute bigint := floor(extract(epoch from clock_timestamp()) / 60)::bigint;
  v_rate integer;
begin
  if not exists (select 1 from hh_households h where h.code = p_code) then
    raise exception 'unknown household';
  end if;
  if p_list not in ('shop', 'recipes', 'tasks', 'cats', 'inbox-rik', 'inbox-melina') then
    raise exception 'unknown list';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'too many items';
  end if;

  -- Hoechstens 60 Pushes pro Minute und Haushalt
  insert into hh_rate as r (household, minute, n) values (p_code, v_minute, 1)
    on conflict (household, minute) do update set n = r.n + 1
    returning r.n into v_rate;
  if v_rate > 60 then
    raise exception 'rate limit';
  end if;
  delete from hh_rate where household = p_code and minute < v_minute - 5;

  v_max_bytes := case when p_list = 'recipes' then 100000 else 20000 end;

  for it in select * from jsonb_array_elements(p_items) loop
    v_id := it->>'id';
    if v_id is null or length(v_id) = 0 or length(v_id) > 64 then
      raise exception 'bad id';
    end if;
    begin
      v_ts := (it->>'ts')::bigint;
    exception when others then
      raise exception 'bad ts';
    end;
    if v_ts is null or v_ts < 0 then
      raise exception 'bad ts';
    end if;
    v_ts := least(v_ts, v_max_ts);
    if octet_length(coalesce((it->'data')::text, '')) > v_max_bytes then
      raise exception 'item too large';
    end if;

    insert into hh_items as s (household, list, id, data, ts, deleted, server_at)
    values (p_code, p_list, v_id, it->'data', v_ts,
            coalesce((it->>'deleted')::boolean, false), clock_timestamp())
    on conflict (household, list, id) do update
      set data = excluded.data, ts = excluded.ts, deleted = excluded.deleted, server_at = clock_timestamp()
      where s.ts < excluded.ts;
    v_n := v_n + 1;
  end loop;

  -- Alte Loeschmarken (aelter als 60 Tage) aufraeumen, damit sie die Grenze nicht fuellen
  delete from hh_items
    where household = p_code and list = p_list and deleted and server_at < now() - interval '60 days';
  if (select count(*) from hh_items where household = p_code and list = p_list and not deleted) > 2000 then
    raise exception 'list too large';
  end if;
  return v_n;
end $$;

-- Liefert die Serverzeit in Millisekunden. Die App berechnet damit die Abweichung ihrer Uhr,
-- weil der Date-Header ueber CORS nicht lesbar ist.
create or replace function hh_now()
returns bigint
language sql stable security definer set search_path = public as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;
revoke all on function hh_now() from public;
grant execute on function hh_now() to anon;

revoke all on function hh_pull(text, text, timestamptz) from public;
revoke all on function hh_push(text, text, jsonb) from public;
grant execute on function hh_pull(text, text, timestamptz) to anon;
grant execute on function hh_push(text, text, jsonb) to anon;
