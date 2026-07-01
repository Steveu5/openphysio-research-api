# OpenPhysio Research API

Backend del buscador científico inteligente de OpenPhysio AI.

## Endpoints principales

- `GET /health`
- `GET /research/version`
- `POST /research/search`
- `GET /research/history`
- `GET /research/history/:queryId/audit`
- `DELETE /research/history/:queryId`
- `DELETE /research/history`
- `POST /research/save`
- `GET /research/saved`
- `GET /research/collections`

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

La comparación reutiliza el conjunto original de artículos, pero emplea los metadatos actualmente guardados en `research_articles`. Por ello se declara como reproducción parcial y no como reconstrucción histórica exacta.

## Variables de entorno

Ver `.env.example`.

## Flujo

1. Recibe la pregunta del usuario.
2. DeepSeek interpreta la intención científica.
3. Busca primero en caché/Supabase.
4. Si no hay caché, consulta las fuentes científicas configuradas.
5. Normaliza, deduplica y ordena los artículos.
6. Guarda artículos únicos, posiciones y procedencia del sistema.
7. Envía los artículos priorizados a DeepSeek para la respuesta clínica guiada.
8. Devuelve `reply`, `articles`, `searchStrategy` y `researchSystem`.

No pongas claves API en el frontend. Las claves van como variables de entorno en Dokploy.
