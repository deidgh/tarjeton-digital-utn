import { admin, endpoint, respond } from '../_shared/common.ts';

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hash(token: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

endpoint(async (accountId, body) => {
  if (body.action === 'issue') {
    if (typeof body.permit_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.permit_id)) {
      return respond({ error: 'Tarjetón inválido' }, 400);
    }
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const { data, error } = await admin.rpc('utn_issue_qr', {
      account_id: accountId, requested_permit: body.permit_id, hashed_token: await hash(token),
    });
    if (error) throw new Error(error.code);
    if (!data) return respond({ error: 'El tarjetón no está vigente o no está asignado a tu cuenta' }, 403);
    if (data.rate_limited) return respond({ error: 'Espera unos segundos antes de solicitar otro código' }, 429);
    const { expires_at, issued_at } = data;
    return respond({ token, expires_at, issued_at });
  }

  if (body.action === 'verify') {
    if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) {
      return respond({ found: false, valid: false });
    }
    const { data, error } = await admin.rpc('utn_verify_qr', {
      account_id: accountId, hashed_token: await hash(body.token),
    });
    if (error) throw new Error(error.code);
    if (data.forbidden) return respond({ error: 'Solo vigilancia y administración pueden verificar' }, 403);
    if (data.found) {
      const { owner_id, ...permit } = data.permit;
      const { data: photo } = await admin.storage.from('permit-portraits').createSignedUrl(owner_id + '.webp', 30);
      if (photo?.signedUrl) permit.photo_url = photo.signedUrl;
      data.permit = permit;
    }
    return respond(data);
  }
  return respond({ error: 'Acción desconocida' }, 400);
});
