-- Tarjetón Digital UTN: únicamente el correo invitado desde Supabase Auth
-- puede convertirse en el primer administrador. Nunca crea perfiles en registros públicos.
create or replace function private.utn_admin_from_owner_invite()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if lower(coalesce(new.email,'')) = 'galindoh.david@gmail.com'
     and new.invited_at is not null
     and not exists (select 1 from public.profiles p where p.role='admin') then
    insert into public.profiles(id,email,full_name,enrollment,department,role,active)
    values(new.id,lower(new.email),'Administrador UTN',null,'Administración','admin',true)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.utn_admin_from_owner_invite() from public, anon, authenticated;
drop trigger if exists utn_admin_on_owner_invited on auth.users;
create trigger utn_admin_on_owner_invited
after insert or update of invited_at on auth.users
for each row
execute function private.utn_admin_from_owner_invite();
