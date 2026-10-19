# Música de fondo (sin copyright)

El montaje elige una pista al azar de esta carpeta (`*.mp3`) y la mezcla **por debajo de la voz**:
baja sola cuando hay narración, sube en las pausas, entra y sale con fundido, y el audio final
queda normalizado a -14 LUFS (el nivel que usa YouTube).

## De dónde descargarla (gratis y con uso comercial)

**Biblioteca de audio de YouTube** (recomendada: YouTube la reconoce y no genera reclamos):
1. Entra a studio.youtube.com → **Biblioteca de audio** (menú izquierdo).
2. Pestaña **Música gratuita**. Filtra por **Atribución → No se requiere atribución**.
3. Elige pistas **instrumentales** de estilo *Cinematic*, *Ambient* o *Dramatic* (sirven para misterio y ciencia).
4. Descarga 10 a 15 pistas y cópialas aquí.

**Pixabay Music** (alternativa): pixabay.com/music — licencia Pixabay, uso comercial sin atribución.
Evita pistas marcadas con "Content ID".

## Reglas
- Solo instrumentales (sin letra): la letra compite con la narración.
- No subas estas pistas a GitHub (ya están excluidas en `.gitignore`).
- Ajusta el nivel con `VOLUMEN_MUSICA` en `.env` (0.35 por defecto; más alto = música más presente en las pausas).
