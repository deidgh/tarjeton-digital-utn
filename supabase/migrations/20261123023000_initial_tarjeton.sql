-- TARJETÓN DIGITAL UTN | Esquema para un proyecto Supabase DEDICADO.
-- Ejecutar solo en una base nueva; NO ejecutar en el proyecto NOCTURNA.
-- El único dato de ejemplo se crea en el modo demo del navegador: esta BD nace vacía.

create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  enrollment text,
  department text,
  role text not null default 'student' check (role in ('admin','guard','student')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_enrollment_unique on public.profiles(lower(enrollment)) where enrollment is not null and enrollment<>'';

create table if not exists public.permits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null constraint permits_owner_id_fkey references public.profiles(id) on delete cascade,
  folio text not null unique default ('UTN-' || extract(year from now())::int::text || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  category text not null default 'Estudiante' check (category in ('Estudiante','Docente')),
  vehicle_make text not null,
  vehicle_model text not null,
  license_plate text not null,
  expires_on date not null,
  status text not null default 'vigente' check (status in ('vigente','suspendido','cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists permits_plate_unique on public.permits(upper(license_plate)) where status <> 'cancelado';
create index if not exists permits_owner_idx on public.permits(owner_id);

-- Datos temporales del QR: nunca conceder acceso directo al navegador.
create table if not exists public.permit_qr_tokens (
  token_hash text primary key,
  permit_id uuid not null references public.permits(id) on delete cascade,
  issued_by uuid not null references public.profiles(id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists qr_expiry_idx on public.permit_qr_tokens(expires_at);

create table if not exists public.verification_events (
  id bigint generated always as identity primary key,
  permit_id uuid references public.permits(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  result text not null check (result in ('vigente','vencido','suspendido','cancelado','inactivo')),
  checked_at timestamptz not null default now()
);

create or replace function private.has_role(role_name text)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = role_name and p.active
  );
$$;

alter table public.profiles enable row level security;
alter table public.permits enable row level security;
alter table public.permit_qr_tokens enable row level security;
alter table public.verification_events enable row level security;

-- Los estudiantes leen solo su perfil; el administrador puede gestionar el directorio.
create policy "profile_read_own_or_admin" on public.profiles for select to authenticated
using (id=(select auth.uid()) or (select private.has_role('admin')));
create policy "profile_update_admin" on public.profiles for update to authenticated
using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));

-- Los estudiantes leen solo sus tarjetones; únicamente administración los modifica.
create policy "permits_read_own_or_admin" on public.permits for select to authenticated
using (owner_id=(select auth.uid()) or (select private.has_role('admin')));
create policy "permits_insert_admin" on public.permits for insert to authenticated
with check ((select private.has_role('admin')));
create policy "permits_update_admin" on public.permits for update to authenticated
using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));

-- Nadie puede leer, insertar ni modificar tokens o historial a través del cliente.
revoke all on public.permit_qr_tokens from anon,authenticated;
revoke all on public.verification_events from anon,authenticated;
-- Permisos mínimos de Data API con RLS activa.
grant usage on schema public to authenticated;
grant select on public.profiles,public.permits to authenticated;
grant insert,update on public.permits to authenticated;
grant update on public.profiles to authenticated;
grant usage on schema private to authenticated;
revoke all on function private.has_role(text) from public;
grant execute on function private.has_role(text) to authenticated;

-- Opcional: para evitar cientos de miles de tokens expirados en el tiempo, ejecutar
-- periódicamente desde SQL Editor / Cron: delete from public.permit_qr_tokens where expires_at<now()-interval '1 day';
-- Los permisos no se gestionan por GET públicos: se verifican por Edge Function.

-- Los titulares inactivos pierden acceso a sus credenciales.
drop policy permits_read_own_or_admin on public.permits;
create policy permits_read_own_or_admin on public.permits for select to authenticated
using ((owner_id = (select auth.uid()) and (select private.has_role('student')))
       or (select private.has_role('admin')));

revoke all on public.profiles, public.permits from anon, authenticated;
grant select on public.profiles, public.permits to authenticated;
grant insert on public.permits to authenticated;
grant update (folio, category, vehicle_make, vehicle_model, license_plate, expires_on, status)
on public.permits to authenticated;
grant update (full_name, enrollment, department, active) on public.profiles to authenticated;
grant select on public.verification_events to authenticated;
create policy verification_events_admin on public.verification_events for select to authenticated
using ((select private.has_role('admin')));
create index verification_events_recent on public.verification_events(checked_at desc);

alter table public.permits add constraint permits_folio_format
  check (folio ~ '^[A-Z0-9-]{1,30}$');
alter table public.permits add constraint permits_vehicle_fields
  check (length(btrim(vehicle_make)) between 1 and 60
     and length(btrim(vehicle_model)) between 1 and 60
     and license_plate ~ '^[A-Z0-9 -]{1,30}$' and length(btrim(license_plate)) > 0);
create index qr_permit_issued_idx on public.permit_qr_tokens(permit_id, issued_at desc);

-- Foto privada por titular. Vigilancia la recibe mediante una URL de vida corta al verificar un QR.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('permit-portraits', 'permit-portraits', false, 1048576, array['image/webp']);
create policy permit_portrait_read on storage.objects for select to authenticated
using (bucket_id = 'permit-portraits' and
  ((select private.has_role('admin')) or
   ((select private.has_role('student')) and name = (select auth.uid())::text || '.webp')));
create policy permit_portrait_write on storage.objects for insert to authenticated
with check (bucket_id = 'permit-portraits' and (select private.has_role('admin')));
create policy permit_portrait_update on storage.objects for update to authenticated
using (bucket_id = 'permit-portraits' and (select private.has_role('admin')))
with check (bucket_id = 'permit-portraits' and (select private.has_role('admin')));

create function public.utn_register_profile(account_id uuid, profile_data jsonb, permit_data jsonb)
returns text language plpgsql set search_path = '' as $$
declare issued_folio text;
begin
  insert into public.profiles(id,email,full_name,enrollment,department,role)
  values (account_id, profile_data->>'email', profile_data->>'full_name',
          profile_data->>'enrollment', profile_data->>'department', profile_data->>'role');
  if permit_data is not null then
    insert into public.permits(owner_id,folio,category,vehicle_make,vehicle_model,license_plate,expires_on)
    values (account_id, permit_data->>'folio', permit_data->>'category', permit_data->>'vehicle_make',
            permit_data->>'vehicle_model', permit_data->>'license_plate', (permit_data->>'expires_on')::date)
    returning folio into issued_folio;
  end if;
  return issued_folio;
end;
$$;

create function public.utn_issue_qr(account_id uuid, requested_permit uuid, hashed_token text)
returns jsonb language plpgsql set search_path = '' as $$
declare deadline timestamptz;
begin
  perform 1 from public.permits p join public.profiles u on u.id=p.owner_id
  where p.id=requested_permit and p.owner_id=account_id and u.active and u.role='student'
    and p.status='vigente' and p.expires_on >= (now() at time zone 'America/Mexico_City')::date
  for update of p;
  if not found then return null; end if;
  if exists (select 1 from public.permit_qr_tokens where permit_id=requested_permit
      and issued_at > now() - interval '5 seconds') then
    return jsonb_build_object('rate_limited',true);
  end if;
  delete from public.permit_qr_tokens where expires_at <= now();
  deadline := now() + interval '90 seconds';
  insert into public.permit_qr_tokens(token_hash,permit_id,issued_by,expires_at)
  values (hashed_token,requested_permit,account_id,deadline);
  return jsonb_build_object('expires_at',deadline,'issued_at',now());
end;
$$;

create function public.utn_verify_qr(account_id uuid, hashed_token text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  credential record;
  effective_status text;
begin
  if not exists (select 1 from public.profiles where id=account_id and active and role in ('guard','admin')) then
    return jsonb_build_object('forbidden',true);
  end if;
  select p.id,p.owner_id,p.folio,p.category,p.vehicle_make,p.vehicle_model,p.license_plate,
    p.expires_on,p.status,u.full_name,u.enrollment,u.department,u.active
  into credential from public.permit_qr_tokens q
  join public.permits p on p.id=q.permit_id
  join public.profiles u on u.id=p.owner_id
  where q.token_hash=hashed_token and q.expires_at > now();
  if not found then return jsonb_build_object('found', false, 'valid', false); end if;
  effective_status := case
    when not credential.active then 'inactivo'
    when credential.status='vigente' and credential.expires_on < (now() at time zone 'America/Mexico_City')::date then 'vencido'
    else credential.status
  end;
  insert into public.verification_events(permit_id,actor_id,result)
  values (credential.id,account_id,effective_status);
  return jsonb_build_object('found',true,'valid',effective_status='vigente','status',effective_status,
    'permit',to_jsonb(credential) - 'id' - 'active');
end;
$$;

revoke all on function public.utn_register_profile(uuid,jsonb,jsonb),
  public.utn_issue_qr(uuid,uuid,text), public.utn_verify_qr(uuid,text) from public, anon, authenticated;
grant execute on function public.utn_register_profile(uuid,jsonb,jsonb),
  public.utn_issue_qr(uuid,uuid,text), public.utn_verify_qr(uuid,text) to service_role;

grant select, insert, update, delete on public.profiles, public.permits,
  public.permit_qr_tokens, public.verification_events to service_role;
grant usage, select on sequence public.verification_events_id_seq to service_role;
