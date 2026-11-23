import { createClient } from 'npm:@supabase/supabase-js@2.57.2';

export const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json;charset=utf-8',
};
export const respond = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });
export const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export function endpoint(handle: (userId: string, body: Record<string, unknown>) => Promise<Response>) {
  Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return respond({ error: 'Método no permitido' }, 405);
    const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i);
    if (!bearer) return respond({ error: 'Inicia sesión' }, 401);
    const { data, error } = await admin.auth.getUser(bearer[1]);
    if (error || !data.user) return respond({ error: 'Sesión inválida' }, 401);
    let body;
    try {
      body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    } catch {
      return respond({ error: 'Solicitud inválida' }, 400);
    }
    try {
      return await handle(data.user.id, body);
    } catch (failure) {
      console.error('UTN Edge Function', failure instanceof Error ? failure.message : 'Operación rechazada');
      return respond({ error: 'No se pudo completar la operación' }, 500);
    }
  });
}
