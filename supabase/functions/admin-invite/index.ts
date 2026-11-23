import { admin, endpoint, respond } from '../_shared/common.ts';

const trim = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

endpoint(async (callerId, body) => {
  const { data: caller, error: callerError } = await admin.from('profiles')
    .select('role,active').eq('id', callerId).maybeSingle();
  if (callerError) throw new Error(callerError.code);
  if (!caller?.active || caller.role !== 'admin') return respond({ error: 'Requiere una cuenta administrativa' }, 403);

  const email = trim(body.email, 180).toLowerCase();
  const full_name = trim(body.name, 100);
  const enrollment = trim(body.enrollment, 70);
  const department = trim(body.department, 100);
  const role = trim(body.role, 16);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || full_name.length < 3 ||
      !enrollment || !['student', 'guard'].includes(role)) {
    return respond({ error: 'Revisa los datos de la cuenta' }, 400);
  }
  const permit = {
    folio: trim(body.folio, 30).toUpperCase(),
    category: trim(body.category, 18),
    vehicle_make: trim(body.vehicle_make, 60),
    vehicle_model: trim(body.vehicle_model, 60),
    license_plate: trim(body.license_plate, 30).toUpperCase(),
    expires_on: trim(body.expires_on, 10),
  };
  const date = new Date(permit.expires_on);
  const assign = role === 'student' && body.assign === true;
  if (assign && (!/^[A-Z0-9-]{1,30}$/.test(permit.folio) ||
      !['Estudiante', 'Docente'].includes(permit.category) || !permit.vehicle_make ||
      !permit.vehicle_model || !/^[A-Z0-9 -]{1,30}$/.test(permit.license_plate) ||
      Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== permit.expires_on ||
      permit.expires_on < new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Mexico_City'}).format(new Date()))) {
    return respond({ error: 'Revisa folio, vehículo, placas y vigencia' }, 400);
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
  if (inviteError || !invited.user) return respond({ error: 'La invitación no pudo enviarse. Revisa el correo y el servicio SMTP.' }, 409);
  const accountId = invited.user.id;
  const { data: folio, error } = await admin.rpc('utn_register_profile', {
    account_id: accountId,
    profile_data: { email, full_name, enrollment, department, role },
    permit_data: assign ? permit : null,
  });
  if (error) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(accountId);
    if (cleanupError) throw new Error('No se pudo revertir un alta incompleta');
    return respond({ error: error.code === '23505'
      ? 'La matrícula, el folio o las placas ya están registrados'
      : 'El alta se revirtió. Revisa los datos antes de reenviar la invitación.' }, 409);
  }

  return respond({ ok: true, folio, account_id: accountId });
});
