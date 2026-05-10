# Task: create-editorial-post

> Criar editorial post (Instagram, blog, LP, evento) em editorial_calendar. Sandra planeja conteúdo mensal. F-04.6.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Create Editorial Post`

### responsible_executor `content-builder`

### execution_type `Agent` — confirmation simples.

### input
- `title`, `content_brief` (string)
- `channel` (`'instagram' | 'tiktok' | 'blog' | 'lp' | 'evento' | 'email'`)
- `scheduled_for` (ISO date)
- `assigned_to` (uuid, default auth.uid())
- `tags` (array)
- `status` (`'idea' | 'draft' | 'in_review' | 'scheduled' | 'published'`, default 'idea')
- `linked_campaign_id` (uuid opcional)

### output
- `post_id` (uuid)
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role:** marketing/admin/owner.
2. Validar:
   - `scheduled_for` futuro (warn se passado — backdated post = explanation needed)
   - `channel` enum
   - `assigned_to` existe + role marketing/cs
3. Confirmation: title + channel + scheduled date + assigned name.
4. INSERT em `editorial_calendar_posts`.
5. Activity log + side-effect notification para assigned_to.
6. Echo: "✓ Post criado. Scheduled {date}. Assigned: {name}."

### acceptance_criteria
- A1 marketing/admin/owner
- A2 Channel enum
- A3 Assignee role check
- A4 Future date default
- A5 Audit + notification side-effect

---

**Mantido por:** content-builder
