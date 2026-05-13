# OpenPhysio Research API

Backend inicial para el buscador científico inteligente de OpenPhysio AI.

## Endpoints

- `GET /health`
- `POST /research/search`
- `POST /research/save`
- `GET /research/saved?userId=<uuid>`

## Variables de entorno

Ver `.env.example`.

## Flujo

1. Recibe pregunta del usuario.
2. DeepSeek interpreta la intención científica.
3. Busca primero en cache/Supabase.
4. Si no hay cache, consulta Europe PMC, OpenAlex y Crossref.
5. Normaliza, deduplica y rankea artículos.
6. Guarda artículos únicos en Supabase.
7. Envía top 5-10 a DeepSeek para recomendación clínica.
8. Devuelve `reply`, `articles` y `searchStrategy`.

No pongas claves API en el frontend. Las claves van como variables de entorno en Dokploy.
