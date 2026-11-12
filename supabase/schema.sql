-- Essensplan: Tabellen, Zugriffsregeln und Funktionen für Supabase.
-- Einmal komplett im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Jede Person sieht nur die Daten ihrer eigenen Gruppe. Das prüft die Datenbank selbst.

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tabellen ----------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_at timestamptz not null default now()
);

create table public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  created_at timestamptz not null default now()
);

-- Liefert die Gruppe der angemeldeten Person. Läuft mit erhöhten Rechten,
-- damit die Zugriffsregeln der Tabelle members sich nicht selbst aufrufen.
create or replace function public.my_group()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select group_id from public.members where user_id = auth.uid()
$$;

create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null default public.my_group() references public.groups (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  tags text[] not null default '{}',
  minutes int check (minutes between 1 and 999),
  servings int not null default 4 check (servings between 1 and 99),
  ingredients jsonb not null default '[]',
  recipe text not null default '',
  link text not null default '',
  photo text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- owner ist 'group' für den gemeinsamen Plan oder die user_id für "Mein Plan".
create table public.plan_entries (
  group_id uuid not null default public.my_group() references public.groups (id) on delete cascade,
  owner text not null,
  day date not null,
  slot text not null check (slot in ('lunch', 'dinner')),
  dish_id uuid references public.dishes (id) on delete cascade,
  is_none boolean not null default false,
  locked boolean not null default false,
  persons int check (persons between 1 and 30),
  eaten boolean,
  primary key (group_id, owner, day, slot)
);

create table public.group_settings (
  group_id uuid primary key default public.my_group() references public.groups (id) on delete cascade,
  data jsonb not null default '{}'
);

create table public.change_log (
  id bigint generated always as identity primary key,
  group_id uuid not null default public.my_group() references public.groups (id) on delete cascade,
  at timestamptz not null default now(),
  by_name text not null,
  text text not null check (char_length(text) <= 500),
  dish_ids uuid[] not null default '{}'
);
create index change_log_group_at on public.change_log (group_id, at desc);

-- ---------- Freigaben für die Data API ----------
-- Nötig, falls neue Tabellen im Projekt nicht automatisch freigegeben werden.
-- Welche Zeilen jemand sehen darf, regeln die Zugriffsregeln darunter.

grant usage on schema public to authenticated;
grant select on public.groups, public.members to authenticated;
grant update (name) on public.members to authenticated;
grant select, insert, update, delete on public.dishes, public.plan_entries, public.group_settings to authenticated;
grant select, insert on public.change_log to authenticated;
grant execute on function public.my_group() to authenticated;

-- ---------- Zugriffsregeln ----------

alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.dishes enable row level security;
alter table public.plan_entries enable row level security;
alter table public.group_settings enable row level security;
alter table public.change_log enable row level security;

create policy "Eigene Gruppe lesen" on public.groups
  for select to authenticated using (id = public.my_group());

create policy "Mitglieder der Gruppe lesen" on public.members
  for select to authenticated using (group_id = public.my_group());
create policy "Eigenen Namen ändern" on public.members
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and group_id = public.my_group());

create policy "Gerichte der Gruppe" on public.dishes
  for all to authenticated using (group_id = public.my_group())
  with check (group_id = public.my_group());

create policy "Gemeinsamer und eigener Plan" on public.plan_entries
  for all to authenticated
  using (group_id = public.my_group() and (owner = 'group' or owner = auth.uid()::text))
  with check (group_id = public.my_group() and (owner = 'group' or owner = auth.uid()::text));

create policy "Einstellungen der Gruppe" on public.group_settings
  for all to authenticated using (group_id = public.my_group())
  with check (group_id = public.my_group());

create policy "Verlauf lesen" on public.change_log
  for select to authenticated using (group_id = public.my_group());
create policy "Verlauf ergänzen" on public.change_log
  for insert to authenticated with check (group_id = public.my_group());

-- ---------- Gruppe erstellen und beitreten ----------

create or replace function public.create_group(member_name text)
returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  new_code text;
  bytes bytea;
  new_group uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  loop
    bytes := gen_random_bytes(8);
    new_code := '';
    for i in 0..7 loop
      new_code := new_code || substr(alphabet, 1 + get_byte(bytes, i) % 32, 1);
    end loop;
    exit when not exists (select 1 from public.groups where code = new_code);
  end loop;
  insert into public.groups (code) values (new_code) returning id into new_group;
  insert into public.group_settings (group_id) values (new_group);
  insert into public.members (user_id, group_id, name)
    values (auth.uid(), new_group, trim(member_name))
    on conflict (user_id) do update set group_id = excluded.group_id, name = excluded.name;
  return new_code;
end;
$$;

create or replace function public.join_group(group_code text, member_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  found_group uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select id into found_group from public.groups
    where code = upper(replace(replace(trim(group_code), ' ', ''), '-', ''));
  if found_group is null then raise exception 'Diesen Gruppencode gibt es nicht'; end if;
  insert into public.members (user_id, group_id, name)
    values (auth.uid(), found_group, trim(member_name))
    on conflict (user_id) do update set group_id = excluded.group_id, name = excluded.name;
  return found_group;
end;
$$;

revoke all on function public.create_group(text) from public, anon;
revoke all on function public.join_group(text, text) from public, anon;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text, text) to authenticated;

-- ---------- Live-Updates ----------

alter publication supabase_realtime add table
  public.dishes, public.plan_entries, public.group_settings, public.change_log, public.members;

-- ---------- Fotos ----------
-- Öffentlich lesbar über zufällige, nicht erratbare Dateinamen.
-- Hochladen und Löschen nur in den Ordner der eigenen Gruppe.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy "Fotos der Gruppe hochladen" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = public.my_group()::text);
-- Supabase braucht zum Löschen auch eine Leseregel auf die Dateieinträge.
create policy "Fotos der Gruppe auflisten" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.my_group()::text);
create policy "Fotos der Gruppe löschen" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.my_group()::text);
