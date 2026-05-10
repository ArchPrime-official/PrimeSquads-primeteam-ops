# Task: search-creative-studio

> Read-only buscar/filtrar assets creative studio (banners, vídeos, templates). marketing/admin.

**✅ SCHEMA ADAPTED (2026-05-10):** `creative_assets` NÃO existe — adaptado para query UNION em 3 tabelas reais:
- `content_items` (banners, templates editorial)
- `ugc_videos` (vídeos creators)
- `tracked_creators` (perfis creators monitorados)

**Query adaptada (UNION):**
```sql
SELECT 'content' AS type, id, title, asset_url, thumbnail_url, tags, created_at
FROM content_items WHERE {filter}
UNION ALL
SELECT 'video' AS type, id, title, video_url AS asset_url, thumbnail_url, tags, created_at
FROM ugc_videos WHERE {filter}
UNION ALL
SELECT 'creator' AS type, id, handle AS title, profile_url AS asset_url, avatar_url AS thumbnail_url, '[]'::text[] AS tags, created_at
FROM tracked_creators WHERE {filter}
ORDER BY created_at DESC LIMIT {limit};
```

Sprint futuro pode unificar em `creative_studio_assets` view materializada.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Search Creative Studio`

### responsible_executor `content-builder`

### execution_type `Agent` — read-only.

### input
- `query` (string opcional — search em title/description/tags)
- `filter` (object): `{type ('banner'|'video'|'template'|'image'), tags, dimensions, created_after, created_before}`
- `limit` (default 50, max 200)

### output
- `assets` (array): `{id, type, title, url, thumbnail_url, dimensions, file_size_kb, tags, created_at, created_by_name}`
- `total_count`
- `verdict`: `DONE`

### action_items

1. **Role:** marketing/admin/owner.
2. Query `creative_assets` com text search via tsvector OR ILIKE em title/description/tags.
3. Stats por type.
4. Activity log filter only.
5. Echo: list condensada + thumbnails URLs + sugestões de uso (ex: "use create-cms-page com asset_id=X").

### acceptance_criteria
- A1 marketing/admin/owner
- A2 Limit cap 200
- A3 Read-only
- A4 Multi-criteria filter
- A5 Signed URLs (24h) para assets privados

---

**Mantido por:** content-builder
