-- Essensplan, Update 2: mehrere Geräte pro Person.
-- Einmal komplett im SQL Editor ausführen (nach schema.sql).
-- Bisher war jedes Gerät eine eigene Person. Danach gehören Geräte zu einer Person
-- und lassen sich mit einem kurzen Kopplungscode verbinden.
-- Bestehende Gerichte, Pläne und Mitglieder bleiben erhalten.

begin;

-- ---------- 1. Personen bekommen eine eigene ID ----------

alter table public.members add column id uuid not null default gen_random_uuid();
alter table public.members drop constraint members_pkey;
alter table public.members add primary key (id);

create table public.devices (
  user_id uuid primary key references auth.users (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  created_at timestamptz not null default now()
);
insert into public.devices (user_id, member_id) select user_id, id from public.members;

-- "Mein Plan" gehört künftig der Person statt dem Gerät.
update public.plan_entries p set owner = m.id::text
  from public.members m where p.owner = m.user_id::text;

-- ---------- 2. Regeln und Funktionen umstellen ----------

drop policy "Eigenen Namen ändern" on public.members;
drop policy "Gemeinsamer und eigener Plan" on public.plan_entries;
alter table public.members drop column user_id;

create or replace function public.my_member()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select member_id from public.devices where user_id = auth.uid()
$$;

create or replace function public.my_group()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select m.group_id from public.devices d
  join public.members m on m.id = d.member_id
  where d.user_id = auth.uid()
$$;

create policy "Eigenen Namen ändern" on public.members
  for update to authenticated using (id = public.my_member())
  with check (id = public.my_member() and group_id = public.my_group());

create policy "Gemeinsamer und eigener Plan" on public.plan_entries
  for all to authenticated
  using (group_id = public.my_group() and (owner = 'group' or owner = public.my_member()::text))
  with check (group_id = public.my_group() and (owner = 'group' or owner = public.my_member()::text));

alter table public.devices enable row level security;
create policy "Eigenes Gerät lesen" on public.devices
  for select to authenticated using (user_id = auth.uid());

grant select on public.devices to authenticated;
grant execute on function public.my_member() to authenticated;

-- Gruppe erstellen und beitreten legen jetzt Person und Gerät an.
-- Bestehende Rechte (z. B. die Sperre für neue Gruppen) bleiben beim Ersetzen erhalten.

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
  new_member uuid;
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
  insert into public.members (group_id, name) values (new_group, trim(member_name)) returning id into new_member;
  insert into public.devices (user_id, member_id) values (auth.uid(), new_member)
    on conflict (user_id) do update set member_id = excluded.member_id;
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
  new_member uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select id into found_group from public.groups
    where code = upper(replace(replace(trim(group_code), ' ', ''), '-', ''));
  if found_group is null then raise exception 'Diesen Gruppencode gibt es nicht'; end if;
  insert into public.members (group_id, name) values (found_group, trim(member_name)) returning id into new_member;
  insert into public.devices (user_id, member_id) values (auth.uid(), new_member)
    on conflict (user_id) do update set member_id = excluded.member_id;
  return found_group;
end;
$$;

-- ---------- 3. Kopplungscodes ----------
-- Nur über die Funktionen erreichbar, kein direkter Zugriff auf die Tabelle.

create table public.pairing_codes (
  code text primary key,
  member_id uuid not null references public.members (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.pairing_codes enable row level security;

create or replace function public.create_pairing_code()
returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  me uuid := public.my_member();
  new_code text;
  bytes bytea;
begin
  if me is null then raise exception 'Nicht in einer Gruppe'; end if;
  delete from public.pairing_codes where expires_at < now() or member_id = me;
  loop
    bytes := gen_random_bytes(6);
    new_code := '';
    for i in 0..5 loop
      new_code := new_code || substr(alphabet, 1 + get_byte(bytes, i) % 32, 1);
    end loop;
    exit when not exists (select 1 from public.pairing_codes where code = new_code);
  end loop;
  insert into public.pairing_codes (code, member_id) values (new_code, me);
  return new_code;
end;
$$;

-- Verbindet das aufrufende Gerät mit der Person hinter dem Code.
-- War das Gerät vorher eine eigene Person ohne weitere Geräte, wird diese zusammengeführt:
-- ihr "Mein Plan" wandert dorthin (wo noch nichts eingetragen ist), dann wird sie entfernt.
create or replace function public.redeem_pairing_code(pair_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  target uuid;
  old_member uuid := public.my_member();
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  delete from public.pairing_codes
    where code = upper(replace(replace(trim(pair_code), ' ', ''), '-', '')) and expires_at > now()
    returning member_id into target;
  if target is null then raise exception 'Dieser Kopplungscode ist ungültig oder abgelaufen'; end if;

  insert into public.devices (user_id, member_id) values (auth.uid(), target)
    on conflict (user_id) do update set member_id = excluded.member_id;

  if old_member is not null and old_member <> target
     and not exists (select 1 from public.devices where member_id = old_member) then
    insert into public.plan_entries (group_id, owner, day, slot, dish_id, is_none, locked, persons, eaten)
      select p.group_id, target::text, p.day, p.slot, p.dish_id, p.is_none, p.locked, p.persons, p.eaten
      from public.plan_entries p
      join public.members t on t.id = target and t.group_id = p.group_id
      where p.owner = old_member::text
      on conflict do nothing;
    delete from public.plan_entries where owner = old_member::text;
    delete from public.members where id = old_member;
  end if;
  return target;
end;
$$;

revoke all on function public.create_pairing_code() from public, anon;
revoke all on function public.redeem_pairing_code(text) from public, anon;
grant execute on function public.create_pairing_code() to authenticated;
grant execute on function public.redeem_pairing_code(text) to authenticated;

commit;
