# Handoff Card Template

> Template obrigatório usado por specialists ao retornar trabalho para o `ops-chief`. Cada retorno PRECISA conter esta estrutura completa para passar no handoff-quality-gate.

**Cumpre:** V18 (squad-creator requirement) + V11 (output_package)

---

## Formato obrigatório

Todo retorno de specialist ao chief segue este formato markdown:

```markdown
## Handoff: {specialist_id} → @ops-chief

**Cycle ID:** cyc-YYYY-MM-DD-NNN
**Specialist:** @{specialist_id}
**Timestamp:** YYYY-MM-DDTHH:MM:SSZ (ISO 8601)

### Announcement (obrigatório, regex-validado)

Retornando ao @ops-chief. {trabalho breve} concluído.

---

### 1. File List (obrigatório)

Arquivos tocados nesta task, com ação explícita:

| Path | Action | Lines changed |
|------|--------|---------------|
| `src/components/finance/NewTransactionForm.tsx` | created | +142 |
| `src/hooks/finance/useFinanceTransactions.ts` | modified | +8 -3 |
| `src/lib/i18n/finance.ts` | modified | +4 |

**Nenhum arquivo tocado?** Escrever "Nenhum arquivo criado ou modificado. Operação read-only."

---

### 2. Change Log (obrigatório)

Descrição em prosa do que foi feito e **por quê**. 1-3 parágrafos.

Criei nova transação finance para Jessica (−€250, categoria Equipe). Usei RPC
`create_finance_transaction_rpc` em vez de INSERT direto para disparar side-effects
(atualização de budget consumido + audit log). Idioma IT e PT-BR para descrição
adicionados em `finance.ts` namespace.

---

### 3. Convention Verification Report (obrigatório)

Checklist de convenções da plataforma PrimeTeam. Cada item deve ser ✅ ou justificar ausência:

- [x] **i18n:** strings visíveis usam `t()` em IT + PT-BR
- [x] **@/ alias:** imports usam `@/` (não caminhos relativos)
- [x] **shadcn/ui:** componentes seguem padrão
- [x] **react-hook-form + zod:** forms com validação
- [x] **TanStack Query:** cache bust via `invalidateQueriesWithDelay`
- [x] **Supabase client:** import de `@/integrations/supabase/client`
- [x] **Mobile-first:** testado em viewport 375px
- [x] **RLS:** tabelas novas têm policy; tabelas existentes respeitam policy atual
- [x] **ArchPrime DS:** cores e typography usam tokens (`--gold`, `--bg`, etc.)
- [x] **Secrets:** nenhum hardcoded; env vars respeitadas
- [ ] **Tests:** não aplicável (operação CRUD direta)

---

### 4. Deploy Flag (obrigatório)

Indica se o trabalho pode ir para produção imediatamente:

- **safe-to-deploy:** yes | no | with-caveats
- **Caveats (se with-caveats):** {lista de condições que precisam ser satisfeitas}

Exemplo `with-caveats`:
safe-to-deploy: with-caveats
- Migration precisa rodar antes do frontend fazer merge
- Variável de ambiente `NEW_FLAG` precisa ser setada em produção

---

### 5. Suggested Next (obrigatório)

Recomendação para o chief sobre próximo passo:

**Opções:**
- `close` — trabalho completo, ciclo pode encerrar
- `route_to @{specialist_id}` — precisa outro specialist (ex: `route_to @quality-guardian` para validação i18n)
- `escalate_to_user` — decisão que exige input do usuário (ambiguidade, trade-off)
- `retry` — falhou, tentar de novo com contexto adicional

Exemplo:
suggested_next: route_to @quality-guardian
reason: "i18n tem 4 novas keys; quality-guardian precisa validar que ambos idiomas passam no lint"

---

### 6. Metadata adicional (opcional, mas útil)

**Dependencies consumed:**
- `supabase` (Edge Functions)
- `@tanstack/react-query` v5.0.0

**New dependencies added:**
- Nenhuma

**Ambient context:**
- User role durante execução: financeiro
- Timezone: Europe/Rome
- Feature flags ativos: none

```

---

## Como o chief usa este card

1. **Recebe** o handoff card completo
2. **Executa** `checklists/handoff-quality-gate.md` em cima do card
3. **Se PASS:** atualiza CHANGELOG.md, decide suggested_next (route ou close)
4. **Se REJECT:** retorna ao specialist com o gate report (mostra qual check falhou)
5. **Se ESCALATE:** pausa ciclo, pede input ao usuário

---

## Anti-patterns

❌ **Handoff sem announcement:** regex não valida → VETO automático
❌ **File List vazio com work não trivial:** suspeito, rejeita
❌ **Convention Verification com muitos N/A sem justificativa:** rejeita
❌ **suggested_next = "route_to @outro-specialist" sem razão clara:** ambiguidade, ESCALATE para usuário decidir

---

## Referência

- Exigência V18: toda squad deve ter `data/handoff-card-template.md`
- Output package V11: os 5 elementos (File List, Change Log, Convention Verification, Deploy flag, Suggested Next) são obrigatórios
- Validação: `checklists/handoff-quality-gate.md`
