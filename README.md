# Tarjetón Digital UTN

Aplicación web instalable para verificar el estacionamiento de la Universidad Tecnológica de Nezahualcóyotl. Proyecto académico. El titular muestra su tarjetón, vigilancia consulta el QR y administración gestiona cuentas y permisos.

## Ejecutar en local

Requiere Node.js 22. Ejecuta `npm ci`, `UTN_DEMO=true npm run build` y `python3 -m http.server 8080 --directory dist`. Abre http://localhost:8080. La demostración usa registros ficticios y funciona dentro del mismo navegador. Para un build conectado define `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` antes de ejecutar `npm run build`. El resultado sale en `dist/`.

## Publicación y configuración inicial

Utiliza exclusivamente el proyecto [tarjeton-digital-utn en Supabase](https://supabase.com/dashboard/project/fmemnxhzlqsmwhfynqfm) y este repositorio. La migración en `supabase/migrations/` crea las tablas, reglas por rol y el almacenamiento privado. Las funciones `admin-invite` y `permit-qr` validan la identidad contra Supabase Auth y usan credenciales de servidor reservadas a las funciones.

1. En Cloudflare Pages, elige **Importar un repositorio de Git** y selecciona `deidgh/tarjeton-digital-utn`. Usa rama `main`, preset **None**, comando `npm run build` y directorio de salida `dist`.
2. Agrega `SUPABASE_URL=https://fmemnxhzlqsmwhfynqfm.supabase.co` y `SUPABASE_PUBLISHABLE_KEY` con la clave **Publishable** en **Settings → API Keys** del proyecto Supabase. Nunca pongas una clave secreta o `service_role` en Cloudflare Pages ni en GitHub.
3. En Supabase **Authentication → URL Configuration**, pon en **Site URL** el HTTPS definitivo de Pages. En **Authentication → Sign In / Providers**, desactiva **Allow new users to sign up**. Configura un mínimo de 12 caracteres para la contraseña.
4. En **Authentication → Email Templates → Invite user**, usa un vínculo de activación que la persona abra en el navegador. En **Authentication → SMTP Settings**, configura SMTP institucional para poder invitar destinatarios externos al equipo de Supabase.

   ```html
   <p>Recibiste una invitación para ingresar a Tarjetón Digital UTN.</p>
   <p><a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&amp;type=invite">Activar mi cuenta</a></p>
   ```

5. **Primer administrador:** abre [Authentication → Users](https://supabase.com/dashboard/project/fmemnxhzlqsmwhfynqfm/auth/users), elige **Add user → Invite user** y envía la invitación a `galindoh.david@gmail.com` (cuenta vinculada a Cloudflare). **No uses Create new user** para esta primera alta. La migración `20261123042100_bootstrap_first_admin.sql` crea automáticamente su perfil `admin` solo cuando Supabase Auth genera la invitación para ese correo; no admite registro público.
6. Abre el correo de invitación, entra al enlace HTTPS del Tarjetón Digital UTN, establece una contraseña única de al menos 12 caracteres y luego ingresa por **Soy administrador**. La activación se completa en el teléfono o computadora del titular.
7. Desde **Soy administrador** podrás invitar titulares y vigilantes, registrar permisos, subir fotografías, suspender tarjetones y revisar el historial. Para mantener cerrada el alta pública, desactiva **Allow new users to sign up** en Auth si todavía está activada.

**Seguridad inicial:** el primer administrador debe confirmar el acceso a su correo. Ningún colaborador debe guardar su contraseña en el repositorio. Si ya existe un usuario Auth con ese correo sin haber sido invitado, la regla automática no se ejecutará; habrá que comprobar y asignar el rol desde SQL Editor con autorización expresa.

## Verificación

Cada tarjetón vigente tiene un QR de 90 segundos, que la pantalla renueva cada 60 segundos. Cada comprobación requiere una cuenta activa de vigilancia o administración y consulta la vigencia, estado y actividad del titular en tiempo real. La bitácora administrativa muestra las últimas 100 verificaciones de códigos reconocidos. Los registros muestran qué se consultó. Contrasta la fotografía y las placas con el vehículo y la persona presentes.

## Instalación

En Android usa el menú de Chrome. En iPhone usa Safari → Compartir → Agregar a inicio. En Chrome o Edge de escritorio usa el icono de instalación o la opción del menú. La interfaz se puede abrir sin conexión tras la primera visita. La autenticación, los tarjetones y la emisión o verificación de QR requieren internet.
