# Taller de JARVIS · reglas de este producto

Este repositorio es un **producto para clientes**, separado de JARVIS. JARVIS es privado de Manuel: este producto tiene su propio repositorio, su propia app, **su propio proyecto de Supabase**, su dominio y su inicio de sesión para clientes. JARVIS solo lo opera desde afuera por su API.

## Stack
Python 3.12 · FastAPI · Jinja2 + HTMX · Tailwind · Chart.js · Supabase (Postgres, Auth con enlace mágico, RLS por organización, Storage) · WeasyPrint para PDF · pytest + Playwright para pruebas. Gestor de paquetes: `uv` (o `pip` con `requirements.txt` si `uv` no está instalado).

## Cómo se construye
- El plano está en `docs/blueprint.md`. Se construye **un paso a la vez**, en el orden numerado del plano.
- Cada paso termina cuando su **comando de verificación sale con código 0**. Si no, no se marca como hecho.
- El avance se anota en `docs/avance.md`: paso, fecha, quién lo hizo, resultado de la verificación.
- Equipo (subagentes en `.claude/agents/`): `backend`, `frontend`, `pruebas`, `revisor`, `verificador`. El Jefe de obra reparte el trabajo con la herramienta Agent y revisa cada entrega.
- Commits locales pequeños con mensaje en español. **Nunca hacer push** ni desplegar sin aprobación de Manuel.

## Reglas que no se rompen
- Ningún secreto en el repositorio: `.env` está en `.gitignore`; `.env.example` solo lleva nombres.
- Ningún cliente puede ver datos de otra organización (RLS probado con pruebas).
- Solo datos públicos de negocios; opción de baja y borrado (Ley 1581 de 2012).
- Nada de raspar Google Maps ni automatizar la app de ChatGPT: APIs oficiales o trabajo manual.
- Presupuesto de APIs de pago: el que diga el plano; si un paso lo supera, se detiene y se avisa.
