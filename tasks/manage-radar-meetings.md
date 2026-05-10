# Task: manage-radar-meetings

> CRUD radar_meetings + action_plans linkados. admin/owner. F-14.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Manage Radar Meetings`

### responsible_executor `platform-specialist` com gate admin/owner

### execution_type `Agent` — confirmation per action.

### input
- `action` (`'create_meeting' | 'create_action_plan' | 'list_meetings'`)
- **`create_meeting`:** `{setor, scheduled_at, agenda_template}`
- **`create_action_plan`:** `{meeting_id, description, assigned_to, due_date, linked_task (auto-create)}`
- **`list_meetings`:** filter status/period

### output
- `meeting_id` OR `action_plan_id` OR `meetings` array
- `verdict`: `DONE`

### action_items

1. **Role admin/owner.**
2. **create_meeting:** INSERT `radar_meetings` + opcional generate slides via edge `radar-generate-slides`.
3. **create_action_plan:** INSERT `radar_action_plans` + se `linked_task=true`, handoff para `create-task` com link.
4. Confirmation com preview.
5. Activity log.

### acceptance_criteria
- A1 admin/owner
- A2 Setor enum
- A3 Action plan linkagem opcional a tasks
- A4 Audit

---

**Mantido por:** platform-specialist
