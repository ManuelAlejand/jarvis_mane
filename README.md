# JARVIS — Core + Dashboard

Centro de control de proyectos: dashboard web instalable (PWA) + bot de Telegram, sobre Supabase y Vercel.
Una sola app Next.js. Los comandos se resuelven con SQL directo: **0 tokens de IA**.

```
Telegram ──webhook──► /api/telegram ─┐
Dashboard (Consola) ─► /api/command ─┼─► lib/router.ts ─► Supabase
pg_cron (cada 5 min) ► /api/worker ──┘   (cola job_queue, backoff 429)
```

## Despliegue en Vercel

1. **Importar:** vercel.com → *Add New → Project* → elige este repositorio → Framework: Next.js.
2. **Variables de entorno** (*Settings → Environment Variables*, entorno Production):

   | Variable | De dónde sale |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` / secret key (**solo aquí**) |
   | `TELEGRAM_TOKEN` | @BotFather |
   | `TELEGRAM_WEBHOOK_SECRET` | Texto aleatorio (letras, números, `_` y `-`) |
   | `WORKER_SECRET` | Otro texto aleatorio |

   Para generar secretos: `openssl rand -hex 24`.
3. **Deploy.** Comprueba `https://<tu-app>.vercel.app/api/health` → `"ok": true`.
4. **Conectar Telegram:** abre una vez `https://<tu-app>.vercel.app/api/telegram/setup?key=<WORKER_SECRET>`.
   Debe responder `"webhook": { "ok": true }`. Luego escribe `/estado` al bot.

## Login del dashboard

Supabase → *Authentication → URL Configuration*:
- **Site URL:** `https://<tu-app>.vercel.app`
- **Redirect URLs:** agrega `https://<tu-app>.vercel.app/**`

El login es por enlace mágico y **no crea cuentas nuevas**: invita al equipo desde
Supabase → *Authentication → Users → Invite user*. El rol (`admin` / `member`) se cambia en la tabla `profiles`.

Para instalarlo en el celular: abre la URL → menú del navegador → *Agregar a pantalla de inicio*.

## Tareas programadas (Supabase → SQL Editor)

```sql
-- Worker de la cola cada 5 min
select cron.schedule('jarvis-worker', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<tu-app>.vercel.app/api/worker',
    headers := jsonb_build_object('Authorization', 'Bearer <WORKER_SECRET>')
  );
$$);

-- Ping diario para que Supabase Free no pause el proyecto
select cron.schedule('jarvis-keepalive', '0 12 * * *', $$
  select net.http_get(url := 'https://<tu-app>.vercel.app/api/health');
$$);
```

## Comandos

| Comando | Qué hace |
|---|---|
| `/estado` | Resumen: proyectos, tareas por estado, gasto de API |
| `/tareas [proyecto]` | Tareas abiertas, ordenadas por prioridad |
| `/nueva título #proyecto !1` | Crea una tarea (`!1` alta, `!3` baja; sin `#` va a `jarvis-core`) |
| `/hecho 12` · `/mover 12 en_curso` | Cambia el estado de la tarea #12 |
| `/proyecto [nombre]` | Lista o detalle de proyectos |
| `/gasto` | Gasto de API del mes frente al tope |

Atajos de texto: *pendientes*, *cómo va todo*, *cómo va youtube*, *gasto*.
Cualquier otro texto se guarda como tarea con la etiqueta `por_clasificar` (el clasificador IA llega en el hito 4).

## Desarrollo local

```bash
cp .env.example .env.local   # completa las llaves
npm install
npm run dev
```

## Seguridad

- Repositorio público: **ningún secreto en el código**. Todo va en variables de entorno de Vercel.
- El bot solo responde a los `chat_id` de la tabla `telegram_users`.
- El dashboard usa la sesión del usuario y RLS; `service_role` solo existe en el servidor.
