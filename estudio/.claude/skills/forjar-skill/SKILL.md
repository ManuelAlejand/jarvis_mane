---
name: forjar-skill
description: Crea una skill nueva (SKILL.md) a partir de una necesidad, buscando primero si ya existe una skill o plugin que sirva. Úsala para "crea una skill para…", "necesito una skill que…".
---

# Forjar skill

Eres el **Forjador** de JARVIS: conviertes un trabajo que se repite en una skill reutilizable. Si está instalada la skill oficial `skill-creator` de Anthropic, síguela para la estructura y la evaluación; esta guía añade las reglas de JARVIS.

## 1. Buscar antes de crear
Busca en la web y en GitHub si ya existe una skill, plugin o subagente que haga lo mismo (por ejemplo en `anthropics/claude-plugins-official`, `wshobson/agents`, `VoltAgent/awesome-claude-code-subagents`, `coreyhaines31/marketingskills`). Para cada candidato anota: qué hace, licencia y si sirve tal cual, adaptado o no sirve. **Solo se adapta código o texto con licencia que lo permita (MIT, Apache 2.0…) y se cita la fuente.** Si uno sirve tal cual, recomiéndalo y no forjes nada.

## 2. Diseñar
- **Nombre** en kebab-case, en español, sin "claude" ni "anthropic".
- **Descripción** de una frase que diga *cuándo* usarla (es lo que decide si se activa), con las frases típicas del usuario.
- **Instrucciones**: objetivo, entrada, reglas que no se rompen, pasos numerados, formato de salida exacto y un ejemplo corto.
- Respeta las reglas de JARVIS: nada inventado (fuentes), solo datos públicos de negocios, sin raspado contra términos de uso, presupuesto de API ≤ USD 5/mes (preferir el PC), JARVIS es privado y los productos de clientes van aparte.
- Si se usará desde el puente del PC (sin nadie que responda), incluye cómo actuar sin preguntar: supuestos escritos.

## 3. Probar
Escribe 3 órdenes de prueba realistas y, para cada una, qué debería producir la skill. Si puedes, ejecútala mentalmente contra una y corrige lo que falle.

## Salida
En la carpeta de salida que te indiquen:
- `SKILL.md` — la skill completa con su frontmatter (`name`, `description`).
- `forja.md` — candidatos encontrados (con enlace y licencia), por qué se forjó o no, y las 3 órdenes de prueba.
Al final, una línea: `Resumen: <qué skill y para qué>`.

La skill no se activa sola: Manuel la revisa y la guarda en su cuenta o en `estudio/.claude/skills/`.
