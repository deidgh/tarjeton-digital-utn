import { createClient } from 'npm:@supabase/supabase-js@2.57.2';

const headers = {
 'Access-Control-Allow-Origin': 'https://tarjeton-digital-utn.galindoh-david.workers.dev',
 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods': 'POST, OPTIONS',
 'Cache-Control': 'no-store',
 'Content-Type': 'application/json;charset=utf-8',
};
const json=(value: unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});

const definitions = [
 {email:'vigilante.demo@tarjeton-utn.test',full_name:'Luis Mendoza',role:'guard',enrollment:'VIG-DEMO-01',department:'Vigilancia'},
 {email:'acceso1.demo@tarjeton-utn.test',full_name:'Andrea López Ramírez',role:'student',enrollment:'UTN-DEMO-0001',department:'Infraestructura de Redes Digitales',
  folio:'DEMO-UTN-001',category:'Estudiante',vehicle_make:'Honda',vehicle_model:'CB190R',license_plate:'DEM-001-A',expires_on:'2027-08-31'},
 {email:'acceso2.demo@tarjeton-utn.test',full_name:'Miguel Hernández Soto',role:'student',enrollment:'UTN-DEMO-0002',department:'Tecnologías de la Información',
  folio:'DEMO-UTN-002',category:'Estudiante',vehicle_make:'Italika',vehicle_model:'FT150',license_plate:'DEM-002-B',expires_on:'2027-08-31'},
];

function newPassword():string{
 const symbols='abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#_-';
 const random=crypto.getRandomValues(new Uint8Array(24));
 return 'UTN!' + Array.from(random, n=>symbols[n%symbols.length]).join('');
}

Deno.serve(async (request:Request)=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return json({error:'Método no permitido'},405);
 const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
 if(!token)return json({error:'Inicia sesión como administrador'},401);
 const url=Deno.env.get('SUPABASE_URL');
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return json({error:'Servicio no configurado'},500);
 const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await supabase.auth.getUser(token);
 if(authError||!auth.user)return json({error:'Sesión inválida'},401);
 const {data:profile,error:profileError}=await supabase.from('profiles').select('role,active').eq('id',auth.user.id).maybeSingle();
 if(profileError||!profile?.active||profile.role!=='admin')return json({error:'Solo administración puede crear cuentas de prueba'},403);
 const output=[];
 for(const def of definitions){
  const {data:existing,error:existingError}=await supabase.from('profiles').select('id').eq('email',def.email).maybeSingle();
  if(existingError)return json({error:'No se pudieron revisar las cuentas',details:existingError.message},500);
  if(existing){output.push({email:def.email,role:def.role,already_exists:true});continue}
  const password=newPassword();
  const {data:created,error:createError}=await supabase.auth.admin.createUser({
   email:def.email,password,email_confirm:true
  });
  if(createError||!created.user){
   output.push({email:def.email,error:createError?.message||'No se pudo crear'});continue
  }
  const uid=created.user.id;
  const {error:insertError}=await supabase.from('profiles').insert({
   id:uid,email:def.email,full_name:def.full_name,role:def.role,
   enrollment:def.enrollment,department:def.department,active:true
  });
  if(insertError){
   await supabase.auth.admin.deleteUser(uid);
   output.push({email:def.email,error:'No se pudo asignar el perfil'});continue
  }
  if(def.role==='student'){
   const {error:permitError}=await supabase.from('permits').insert({
    owner_id:uid,folio:def.folio,category:def.category,vehicle_make:def.vehicle_make,
    vehicle_model:def.vehicle_model,license_plate:def.license_plate,
    expires_on:def.expires_on,status:'vigente'
   });
   if(permitError){
    await supabase.auth.admin.deleteUser(uid);
    output.push({email:def.email,error:'No se pudo asignar el tarjetón'});continue
   }
  }
  output.push({email:def.email,password,full_name:def.full_name,role:def.role,folio:def.folio||null,created:true});
 }
 return json({ok:output.some(x=>x.created),accounts:output});
});
