# Contribuindo com o primeteam-ops — como criar/editar uma task

> O CI **bloqueia** PRs que violem estas regras (desde F5, 2026-07-03). Não é opcional.

## Criar uma FUNÇÃO NOVA (task de escrita)

1. **Copie o template**: `cp tasks/_TEMPLATE-write-task.md tasks/<sua-task>.md`.
2. **Confirme o schema real**: para CADA coluna/tabela/EF que citar, verifique em
   `apps/v2/src/integrations/supabase/types.ts` (bloco `Insert`) e `supabase/functions/`.
   Coluna/tabela/EF fantasma = **CI reprova** (`validate-squad-refs --strict`).
3. **Registre os campos obrigatórios** em `data/required-fields-registry.yaml`:
   ```yaml
   <sua-task>:
     table: <tabela>
     writes: insert|update|delete
     required:
       - {field: X, source: schema}            # NOT NULL real
       - {field: Y, source: "business: ...", ask: "pergunta"}  # regra de negócio
     forbidden_defaults: [Y]                    # NUNCA defaultar — sempre elicitar
     hazards: [trigger_a]                       # se aplicável (finance)
   ```
   Task de escrita **sem entrada no registry** = **CI reprova** (`validate-task-fields --strict`).
4. **Declare os campos no `input`** da task (todos os `required` do registry) e **elicite** cada
   um ausente — empresa/`brand` SEMPRE perguntada; `campaign_id` sempre (lead/LP/form); tarefa
   exige data+HORA de execução. Regra completa: `data/primeteam-platform-rules.md` §12 (HO-TP-002).
5. **Verificação pós-ação** obrigatória (re-query confirmando o efeito — o smoke).
6. **Registre no `config.yaml`** (tasks registry) com o executor + no `task_registry` do agent.
7. **Gate de permissão**: declare quem pode (RLS real). A matriz role×task é gerada por
   `python3 scripts/gen-role-task-matrix.py` — para gate não-detectável na prosa, adicione o
   override em `CURATED_GATES` do gerador.

## Gates do CI (todos bloqueantes)

| Gate | Script | Reprova quando |
|------|--------|----------------|
| Refs vivas | `validate-squad-refs.py --strict` | tabela/EF citada não existe |
| Campos obrigatórios | `validate-task-fields.py --strict` | task de escrita sem registry OU campo obrigatório não elicitado OU campo fantasma |
| Matriz de permissões | `gen-role-task-matrix.py --check` | task de escrita sem gate detectável |

Rode localmente antes do PR:
```bash
python3 scripts/validate-squad-refs.py --repo . --strict
python3 scripts/validate-task-fields.py --repo . --strict
python3 scripts/gen-role-task-matrix.py --repo . --check
```

## Editar um squad (fluxo git)

Não edite `squads/primeteam-ops/` a partir do parent. Entre no submodule, faça PR no
`ArchPrime-official/PrimeSquads-primeteam-ops`, e após o merge rode `bump-all-squads.sh`.
