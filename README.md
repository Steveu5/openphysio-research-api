# OpenPhysio Research API

Backend del buscador científico inteligente de OpenPhysio AI.

## Endpoints principales

- `GET /health`
- `GET /health/ready`
- `GET /research/version`
- `POST /research/search`
- `GET /research/history`
- `GET /research/history/:queryId/audit`
- `DELETE /research/history/:queryId`
- `DELETE /research/history`
- `POST /research/save`
- `GET /research/saved`
- `GET /research/collections`

`GET /health` confirma que el proceso HTTP está vivo. `GET /health/ready` confirma además que las variables obligatorias para búsqueda, autenticación y persistencia están configuradas. Un despliegue no debe recibir tráfico real hasta que `/health/ready` responda HTTP 200.

## Auditoría histórica

`GET /research/history/:queryId/audit` devuelve, para una búsqueda perteneciente al usuario autenticado:

- la pregunta y la intención científica almacenadas;
- la versión original del algoritmo, ranking, prompts y configuración;
- la versión actualmente activa;
- las diferencias entre ambas versiones;
- el ranking original guardado;
- un nuevo ranking del mismo conjunto de artículos con el algoritmo actual;
- los artículos que subieron, bajaron, se mantuvieron, aparecieron o desaparecieron;
- el nivel y las limitaciones de reproducibilidad.

Las búsquedas nuevas conservan una copia inmutable y compacta del estado de cada artículo y de sus puntajes originales. La copia se verifica con SHA-256 antes de utilizarse. Esto permite reconstruir exactamente el estado histórico mostrado al usuario y compararlo con el ranking actualmente desplegado.

Las búsquedas antiguas sin snapshot, o con una verificación de integridad fallida, continúan funcionando mediante un modo de compatibilidad que usa los registros actuales de `research_articles` y declara explícitamente una reproducibilidad reducida.

## Variables de entorno

Copia `.env.example` y configura como mínimo:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DEEPSEEK_API_KEY`

En producción configura también `ALLOWED_ORIGINS` con el origen exacto del frontend. No pongas claves privadas en el frontend.

## Desarrollo local

```bash
npm ci
cp .env.example .env
npm run dev
```

## Validación antes de publicar

```bash
npm test
npm run benchmark:ranking
```

Después del despliegue:

```bash
SMOKE_API_ROOT=https://api.openphysiohub.com npm run smoke:production
```

La lista completa para declarar la versión usable está en `docs/MVP_RELEASE_CHECKLIST.md`.

## Flujo

1. Recibe la pregunta del usuario.
2. DeepSeek interpreta la intención científica.
3. Registra la búsqueda, incluso cuando la respuesta proviene del caché.
4. Busca primero en caché/Supabase.
5. Si no hay caché, consulta las fuentes científicas configuradas.
6. Normaliza, deduplica y ordena los artículos.
7. Guarda artículos, posiciones, procedencia y snapshot inmutable.
8. Envía los artículos priorizados a DeepSeek para la respuesta clínica guiada.
9. Devuelve `reply`, `articles`, `searchStrategy` y `researchSystem`.

Las claves se configuran como variables de entorno en Dokploy. Nunca se incluyen claves privadas en el código del frontend.
