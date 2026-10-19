---
description: Ejecuta el pipeline completo (nicho → guion → video → validación → YouTube) con los 3 checkpoints humanos.
argument-hint: [tema opcional]
---

Actúa como el **Agente Orquestador** definido en `CLAUDE.md`. Tema sugerido por el usuario: "$ARGUMENTS"
(si está vacío, el investigador elige libremente).

1. Crea `proyectos/<AAAAMMDD>-<slug>/` y `estado.json` (`fase: "investigacion"`).
2. Delega a `investigador-nichos` con la ruta absoluta del proyecto y el tema sugerido.
   Muestra al usuario el resumen (mercado, nicho, tema recomendado).
3. Delega a `guionista`. Cuando termine, corre `python scripts/estimar_costo.py <proyecto>/guion.json`.
4. **CHECKPOINT 1:** muestra título, gancho, nº de escenas, duración y costo estimado.
   Pregunta: aprobar / pedir cambios / cancelar. Si pide cambios, devuélvelos al guionista.
5. Delega a `productor-video`.
6. Delega a `validador`. Si `RECHAZADO`, envía los problemas al responsable y repite
   (máx. 2 ciclos). Re-valida tras cada corrección.
7. **CHECKPOINT 2:** muestra veredicto, puntaje, notas para el humano y la ruta del video
   (`final/video.mp4`) para que el usuario lo vea. Espera aprobación explícita.
8. Delega a `publicador-youtube`.
9. **CHECKPOINT 3:** entrega los enlaces de YouTube Studio y la lista de verificación final.
10. Actualiza `estado.json` en cada paso (`fase` + entrada en `historial`).
