# Task: <nome-kebab-case>

> Uma linha: o que a task cria/muta, em qual tabela, e o gate de permissão. Ex.:
> "Criar linha em `X` respeitando RLS `has_Y_access()`, elicitando todos os campos obrigatórios."

**Cumpre:** HO-TP-001 (anatomy) + **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ⚠️ Antes de escrever: (1) abra `apps/v2/src/integrations/supabase/types.ts` e confirme cada
> coluna que você citar — coluna/tabela fantasma = CRITICAL. (2) Adicione a entrada desta task em
> `data/required-fields-registry.yaml`. O CI `validate-task-fields.py` valida ambos.

---

## Task anatomy

### task_name
`<Nome Legível>`

### status
`pending`

### responsible_executor
`<agent>` — e registrar no `config.yaml` (tasks registry) + no `task_registry` do agent.

### execution_type
`Agent` — dry-run + confirmação (se destrutivo/bulk).

### input
> Liste TODOS os campos do registry (schema NOT NULL + regras de negócio). Marque os que a task
> DEVE PERGUNTAR (nunca defaultar). Para tabela com empresa: `brand`/`company_id` SEMPRE elicitado.
- `<campo_obrigatorio_1>` (source: schema NOT NULL)
- `<campo_de_negocio>` — **ELICITAR sempre** (ex.: empresa, campaign_id, data+hora de execução)
- ...

### output
- `<id criado/atualizado>`, `verdict: DONE | BLOCKED | ESCALATE`

### action_items
1. **Auth**: `has_<X>_access()` / RLS correta (declarar quem pode; admin EXCLUÍDO de finance).
2. **Elicitar obrigatórios**: para cada campo do registry ausente do pedido → PERGUNTAR (não assumir).
   Empresa/`brand` sempre; `campaign_id` sempre (lead/LP/form); tarefa exige `scheduled_start_time`+duração.
3. **Validar** contra o schema real (tipos/enums) + regras de negócio.
4. **HAZARD** (se aplicável): `ALTER TABLE ... DISABLE TRIGGER <nome>` pelo NOME antes do write +
   ENABLE após (nunca `DISABLE TRIGGER USER`). Ver `checklists/finance-triggers-hazard.md`.
5. **Confirmação** (echo dos valores, incl. empresa) — literal uppercase se destrutivo/bulk.
6. **Write** (INSERT/UPDATE) via JWT do user (RLS).
7. **Verificação PÓS-AÇÃO** (obrigatória): re-query confirmando o efeito (contagem/valor mudou).
8. **Activity log**: `action='<agent>.<verb>'`, `cycle_id`, `details` com diff (sem PII/token).

### acceptance_criteria
- **[A1]** Auth correta (papel certo).
- **[A2]** TODOS os campos obrigatórios do registry elicitados (nenhum default silencioso).
- **[A3]** Empresa/`brand` explícita (se a tabela tem empresa).
- **[A4]** Hazard triggers desabilitados pelo nome (se aplicável).
- **[A5]** Verificação pós-ação (re-query) confirma o efeito.
- **[A6]** Nenhuma coluna/tabela fantasma (bate com types.ts).

---

## Exemplos
### Exemplo 1 — Happy path (DONE)
### Exemplo 2 — Campo obrigatório ausente (ELICITAR/ESCALATE, não defaultar)
### Exemplo 3 — Permissão negada (BLOCKED)

## Notas
- Referências: `data/required-fields-registry.yaml`, `data/primeteam-platform-rules.md` §12,
  `checklists/finance-triggers-hazard.md`, `checklists/smoke-tests-high-stakes.md`.
