# Task: search-creative-studio

> Read-only buscar/filtrar assets creative studio (banners, vídeos, templates). marketing/admin.

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
