# Estudio YouTube IA

> **Conectado a JARVIS.** Pides ideas por Telegram, eliges cuáles producir con botones, y este PC
> hace el resto con `puente.py`: guion (Claude Code con tu plan Pro) → voz Kokoro + clips de stock de Pixabay
> → validación → te llega el Short por Telegram con **Publicar / Cambiar / Descartar**.
> Modo por defecto: **gratis** (0 USD por video).

## Instalación en Windows (una sola vez)

Abre **PowerShell** y ejecuta, en orden:

```powershell
# 1. Herramientas
winget install Python.Python.3.12
winget install Gyan.FFmpeg
winget install Git.Git
winget install eSpeak-NG.eSpeak-NG   # voz en español y portugués (si falla: .msi de github.com/espeak-ng/espeak-ng/releases)

# 2. Claude Code (usa tu sesión Pro; la primera vez abre el navegador para iniciar sesión)
irm https://claude.ai/install.ps1 | iex
claude                                # inicia sesión y luego sal con /exit

# 3. El estudio (cierra y vuelve a abrir PowerShell para que reconozca los programas nuevos)
cd $HOME\Documents
git clone https://github.com/ManuelAlejand/jarvis_mane.git
cd jarvis_mane\estudio
python -m pip install -r requirements.txt
copy .env.example .env
notepad .env
```

En `.env` completa `WORKER_SECRET` y `TELEGRAM_TOKEN` (los mismos de Vercel) y `PIXABAY_API_KEY`
(crea una cuenta gratis en pixabay.com; la llave aparece en pixabay.com/api/docs). Luego:

```powershell
python puente.py --probar     # revisa que todo esté listo
python puente.py              # deja esta ventana abierta: el PC queda escuchando a JARVIS
```

Para actualizar el estudio: `git pull` en la carpeta `jarvis_mane`.

### Voz natural (Chatterbox, recomendado)
Chatterbox Multilingual (licencia MIT) suena mucho más humano que Kokoro y usa tu tarjeta NVIDIA.
Si no está instalado o falla, el estudio usa Kokoro automáticamente.

```powershell
python -m pip install chatterbox-tts
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```
Si la segunda línea termina en `False`, instala la versión con CUDA de esa misma versión de PyTorch
(cambia `2.6.0` por la que mostró el comando, sin el `+cpu`):
```powershell
python -m pip install --force-reinstall --no-deps torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
```
La primera vez descarga el modelo (unos GB). Para una voz propia, mira `assets/voces/LEEME.md`.

### Música
Copia 10 a 15 pistas instrumentales sin copyright en `assets/musica/` (cómo conseguirlas: `assets/musica/LEEME.md`).
El montaje baja la música cuando hay voz y normaliza el audio a -14 LUFS.

**Publicar en YouTube** (cuando vayas a subir el primer Short): sigue "Claves que necesitas → YouTube"
más abajo y ejecuta `python scripts/autorizar_youtube.py` una vez.

### Cómo trabaja el puente
| Paso | Quién | Dónde | Costo |
|---|---|---|---|
| Ideas | Investigador (Sonnet) | Servidor JARVIS (API) | ~0.02 USD |
| Guion | Guionista | Claude Code en este PC (plan Pro) | 0 |
| Voz | Chatterbox (MIT) o Kokoro-82M (Apache-2.0), uso comercial | Este PC (GPU) | 0 |
| Clips | Pixabay o Pexels (licencias libres, uso comercial) | Este PC | 0 |
| Montaje y subtítulos | ffmpeg | Este PC | 0 |
| Validación (máx. 2 rondas de corrección) | Validador | Claude Code en este PC | 0 |
| Publicar en privado | Publicador | YouTube API desde este PC | 0 |

El registro queda en `puente.log`. Si cierras la ventana, los videos esperan en cola hasta que la vuelvas a abrir.

---


Orquestador + 5 subagentes de Claude Code para producir videos originales asistidos por IA,
monetizables en YouTube, operando desde Colombia.

```
                    ┌──────────────────────────────┐
  /producir-video → │  ORQUESTADOR (CLAUDE.md)     │
                    └──────────────┬───────────────┘
      ┌───────────────┬────────────┼──────────────┬───────────────────┐
      ▼               ▼            ▼              ▼                   ▼
 1 investigador   2 guionista  3 productor    4 validador        5 publicador
   -nichos          (JSON)     (Kling+Eleven   (guion+video)      (MCP YouTube)
   (WebSearch)                  Labs+ffmpeg)
      │               │   ✋ 1     │              │   ✋ 2           │   ✋ 3
   nicho.json     guion.json  video.mp4      reporte_validacion  privado en YouTube
                             shorts/*.mp4                        → tú lo haces público
```

✋ = checkpoint humano. El sistema nunca avanza sin tu "sí".

## Qué hace cada agente

| Agente | Archivo | Hace |
|---|---|---|
| Orquestador | `CLAUDE.md` + `/producir-video` | Crea el proyecto, delega, aplica checkpoints, reintenta si el QA rechaza |
| 1. Investigador | `.claude/agents/investigador-nichos.md` | Compara mercados (EN/ES/PT), puntúa 5 nichos por RPM, demanda, competencia, viabilidad IA y riesgo de política; elige nicho y 3 temas |
| 2. Guionista | `.claude/agents/guionista.md` | Guion JSON: gancho, personajes/actores con descripción visual fija, escenas de 5/10 s con prompt para Kling, metadatos, Shorts |
| 3. Productor | `.claude/agents/productor-video.md` | Voz (ElevenLabs) → clips (Kling) → ensamblado con subtítulos → Shorts 9:16 |
| 4. Validador | `.claude/agents/validador.md` | Chequeos automáticos + verificación de hechos + revisión visual de fotogramas → APROBADO/RECHAZADO |
| 5. Publicador | `.claude/agents/publicador-youtube.md` | Sube por MCP como **privado** con divulgación de contenido sintético |

## Instalación

Requisitos: Python 3.10+, `ffmpeg` (con libass para subtítulos) y Claude Code / app de escritorio.

```bash
pip install -r requirements.txt
cp .env.example .env        # y completa las claves
```

### Claves que necesitas
1. **Kling** — app.klingai.com/global/dev → crea Access Key + Secret Key y recarga saldo.
   En la consola revisa el nombre exacto del modelo 3.0 para tu cuenta y ponlo en `KLING_MODELO`.
2. **ElevenLabs** — API key y el `VOZ_ID` de la voz que quieras (plan con uso comercial).
3. **YouTube** — Google Cloud Console:
   - Crea un proyecto y activa **YouTube Data API v3**.
   - Pantalla de consentimiento OAuth (tipo externo, agrégate como usuario de prueba).
   - Credencial **ID de cliente OAuth → App de escritorio**; descarga el JSON a
     `credenciales/client_secret.json`.
   - Ejecuta una vez: `python scripts/autorizar_youtube.py`

> **Importante:** los proyectos de Google Cloud sin auditoría de la API suben videos que
> quedan **bloqueados en privado**. Para este flujo está bien (tú los haces públicos en Studio
> tras revisarlos), pero si luego quieres publicar automáticamente debes solicitar la
> auditoría de cumplimiento de la API de YouTube.

## Uso

Abre la carpeta en Claude Code y escribe:

```
/producir-video                       # el investigador elige libremente
/producir-video curiosidades del espacio
/investigar-nichos                    # solo explorar ideas, sin gastar en video
```

Cada video vive en `proyectos/AAAAMMDD-slug/`:
`nicho.json · guion.json · costo_estimado.json · audio/ · clips/ · final/video.mp4 ·
final/subtitulos.srt · shorts/ · qa/ · reporte_validacion.json · publicacion.json · estado.json`

Los scripts también se pueden correr a mano (útil para depurar):

```bash
python scripts/estimar_costo.py   proyectos/<id>/guion.json
python scripts/generar_voz.py     proyectos/<id>
python scripts/generar_clips.py   proyectos/<id> [--solo 3,7]   # reanudable
python scripts/ensamblar.py       proyectos/<id>
python scripts/cortar_shorts.py   proyectos/<id>
python scripts/validar_guion.py   proyectos/<id>/guion.json --comparar proyectos/
python scripts/validar_video.py   proyectos/<id> --fotogramas 6
```

Música de fondo: coloca pistas con licencia (p. ej. de la Biblioteca de Audio de YouTube)
en `assets/musica/*.mp3`; el ensamblador elige una al azar.

## Salvaguardas incorporadas
- Política resumida en `politicas/youtube_ia_2026.md`; todos los agentes la leen.
- Nichos de salud, finanzas y legal con presentador IA quedan descartados.
- El validador rechaza guiones muy parecidos a los anteriores (riesgo de "contenido inauténtico").
- Detección de marcas/personajes con copyright, pantallas negras, silencios, Shorts > 60 s.
- Tope de presupuesto por video (`PRESUPUESTO_MAX_USD`).
- El MCP de YouTube **se niega a subir** sin reporte APROBADO y fuerza privacidad privada.
- Los recortes (Shorts) salen solo de nuestro propio video.

## Por qué Kling y no Sora 2
OpenAI cerró la app de Sora en abril de 2026 y apagó la API el 24 de septiembre de 2026.
El cliente de video está aislado en `scripts/kling_client.py`; para cambiar de proveedor
(p. ej. Veo 3.1) basta con escribir otro cliente con los métodos `crear_texto_a_video`,
`esperar` y `descargar`.
