# IA Partidos Analizados — proyecto limpio

Proyecto Next.js reconstruido desde cero para evitar incompatibilidades acumuladas entre versiones.

## Variables de entorno en Render

- `API_FOOTBALL_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (usa un modelo disponible en tu cuenta; el ejemplo usa `gpt-5.2`)

Opcionales:
- `AI_BATCH_SIZE=20`
- `FINALISTS_TO_ENRICH=20`
- `MAX_FIXTURES_TO_SCAN=500`

## Flujo

1. API-Football obtiene todos los fixtures de la fecha.
2. Se eliminan femenino, juveniles, reservas y filiales.
3. Solo se aceptan estados prepartido `NS` / `TBD`.
4. OpenAI analiza todos los candidatos en una primera fase BASIC.
5. Se enriquecen solo los 20 candidatos más prometedores con forma reciente.
6. OpenAI los reanaliza.
7. Solo entran picks cuyo `LO MEJOR QUE VEO` sea ALTA (75+).
8. Se seleccionan hasta 5 y se construye la combinada automáticamente.

La UI muestra mercados individuales, `LO MEJOR QUE VEO`, diagnóstico del pipeline y nota final.
