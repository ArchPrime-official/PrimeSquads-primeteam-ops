# Task: test-handoff-flow

> Smoke test obrigatório que valida a topologia hub-and-spoke do squad `primeteam-ops`. Roda em 5 cenários que cobrem o ciclo completo: receive → triage → route → receive → validate → close/next.

**Cumpre:** V20 (squad-creator requirement)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Test Handoff Flow`

### status
`pending` *(default até execução)*

### responsible_executor
`ops-chief` (orquestra) + `auth-specialist` (primeiro handoff test) + mock specialists para cenários 2-5

### execution_type
`Hybrid` — mix de automated test runs (Agent) + human validation (Human) dos resultados

### input

- Squad `primeteam-ops` com estrutura mínima:
  - `ops-chief.md` existe
  - `auth-specialist.md` existe
  - `config.yaml` tem `handoff_protocol`
  - `checklists/handoff-quality-gate.md` existe
  - `data/handoff-card-template.md` existe
- Sessão de teste: usuário de teste simulado (ex: Pablo como owner)

### output

- **Test Report:** markdown com os 5 cenários executados, resultado de cada, e verdict agregado
- **Gate Reports:** para cenários que devem FALHAR (3 e 4), o gate report esperado é comparado
- **Verdict:** `ALL PASS` | `PARTIAL PASS {N}/5` | `FAIL — squad não passa validação`

### action_items

1. **Cenário 1 — Happy path:** chief recebe request, roteia auth-specialist, specialist retorna com announcement correto + card completo, chief PASSA no gate, fecha ciclo
2. **Cenário 2 — Multi-phase:** chief roteia platform-specialist, recebe com `suggested_next = route_to @quality-guardian`, roteia quality-guardian, recebe, PASS, fecha
3. **Cenário 3 — Wrong announcement:** specialist retorna sem o regex correto. Esperado: gate REJECT em 1.1
4. **Cenário 4 — Direct chain attempt:** specialist tenta fazer `*handoff @outro-specialist` direto (sem voltar ao chief). Esperado: VETO automático do framework (V9, V13)
5. **Cenário 5 — Escalate:** specialist retorna com `suggested_next = escalate_to_user`. Esperado: chief pausa ciclo, apresenta situação ao usuário

### acceptance_criteria

- Cenário 1: **PASS obrigatório**. Se falhar, squad não tem fluxo básico funcionando.
- Cenário 2: **PASS obrigatório**. Multi-phase é padrão necessário.
- Cenário 3: Gate deve **REJECT** com mensagem mencionando check `1.1`. Se PASS incorretamente: squad não está enforçando protocolo.
- Cenário 4: Framework deve **BLOQUEAR** antes de chegar no gate. Specialist não deve conseguir chamar outro specialist direto.
- Cenário 5: Chief deve **ESCALATE** (pausar ciclo), não tentar resolver sozinho.
- **Verdict final:** `ALL PASS (5/5)` para squad passar validação.

---

## Detalhes de execução por cenário

### Cenário 1 — Happy Path

**Objetivo:** validar que o ciclo completo funciona end-to-end.

```
User → /ptOps "login"
  ops-chief: triage
    → identifica demanda de auth
    → *handoff @auth-specialist --cycle cyc-test-001 --context "login"
  auth-specialist: executa login
    → abre browser, faz OAuth, salva session
    → gera handoff card:
      Announcement: "Retornando ao @ops-chief. Login Google OAuth concluído."
      File List: ["~/.primeteam/session.json (created)"]
      Change Log: "User autenticado via Google OAuth. Session salva localmente."
      Convention Verification: [all ✅]
      Deploy Flag: "safe-to-deploy: yes"
      Suggested Next: "close"
    → *receive @ops-chief
  ops-chief: run handoff-quality-gate
    → Seção 1: 4/4
    → Seção 2: 5/5
    → Seção 3: todos HIGH/CRITICAL passam
    → Seção 4: 3/3
    → Verdict: PASS
  ops-chief: close cycle
    → atualiza CHANGELOG
    → responde ao user: "Autenticado como pablo@archprime.io (role: owner)"
```

**Expected:** PASS (cycle Done).

### Cenário 2 — Multi-phase

**Objetivo:** validar routing sequencial via chief (hub-and-spoke enforcing).

```
User → /ptOps "criar transação de test e validar i18n"
  ops-chief: triage + route → @platform-specialist
  platform-specialist: cria transação
    → handoff card com suggested_next: "route_to @quality-guardian"
    → reason: "4 novas keys i18n adicionadas"
  ops-chief: gate PASS
  ops-chief: route → @quality-guardian (com contexto do platform-specialist)
  quality-guardian: valida i18n
    → handoff card com suggested_next: "close"
  ops-chief: gate PASS
  ops-chief: close cycle
```

**Expected:** PASS (2 handoffs via chief, nenhum direct chain).

### Cenário 3 — Wrong Announcement (regex fail)

**Objetivo:** validar que o gate rejeita handoffs sem announcement prescrito.

```
User → /ptOps "test malformed handoff"
  ops-chief: route → @auth-specialist
  auth-specialist (modo test): retorna com announcement quebrado:
    Announcement: "Trabalho completo" ← ERRADO, não bate regex
    {resto do card OK}
  ops-chief: run gate
    → Seção 1.1: FAIL (regex não bate)
    → Verdict: REJECT
  ops-chief: gerar Gate Report e devolver ao specialist
```

**Expected:** REJECT com mensagem citando `1.1 Announcement regex`.

### Cenário 4 — Direct Chain Attempt (VETO V13)

**Objetivo:** validar que o framework BLOQUEIA um specialist de chamar outro direto.

```
User → /ptOps "test direct chain"
  ops-chief: route → @platform-specialist
  platform-specialist (modo test): tenta fazer:
    *handoff @quality-guardian --context "validar meu trabalho"
  Framework: INTERCEPTA
    → Violação V13: specialist → specialist direto
    → BLOCK + ESCALATE to ops-chief
  ops-chief: recebe alerta, nega a ação
```

**Expected:** Framework BLOCK antes de chegar no gate. Ciclo permanece com platform-specialist.

### Cenário 5 — Escalate to User

**Objetivo:** validar que ambiguidades escalam para o usuário, não são "resolvidas" pelo chief.

```
User → /ptOps "criar campanha nova"
  ops-chief: route → @platform-specialist
  platform-specialist: precisa decisão estratégica (budget, targeting)
    → handoff card:
      Suggested Next: "escalate_to_user"
      Reason: "Orçamento não definido. Depende de decisão estratégica
               (provavelmente /metaAds:ralph-burns antes)."
  ops-chief: PASS gate, respeita suggested_next
    → Pausa ciclo (estado: Returned)
    → Responde ao usuário:
      "A criação de campanha requer decisão de orçamento/targeting.
       Recomendo consultar /metaAds:ralph-burns primeiro. Quando tiver
       os parâmetros, volte aqui com /ptOps continuar cyc-test-005."
```

**Expected:** Ciclo pausado, aguardando user. Chief NÃO tenta resolver sozinho.

---

## Execução manual

O smoke test pode ser executado manualmente assim:

```bash
# No Claude Code, dentro do repo primeteam-ops
/ptOps test-handoff-flow
```

ops-chief executa os 5 cenários em sequência e gera o report.

### Formato do Report

```markdown
# Handoff Flow Test Report

**Date:** 2026-04-22
**Squad version:** 0.1.0

## Results

| # | Scenario | Expected | Actual | Verdict |
|---|----------|----------|--------|---------|
| 1 | Happy path | PASS | PASS | ✅ |
| 2 | Multi-phase routing | PASS | PASS | ✅ |
| 3 | Wrong announcement | REJECT at 1.1 | REJECT at 1.1 | ✅ |
| 4 | Direct chain attempt | Framework BLOCK | Framework BLOCK | ✅ |
| 5 | Escalate to user | Pause + notify user | Pause + notify user | ✅ |

## Aggregate verdict

**ALL PASS (5/5)** — Squad passa validação hub-and-spoke.

## Notes

- Cenário 2 levou 2 handoffs (1 platform-specialist + 1 quality-guardian), ambos via chief.
- Nenhum direct chain detectado.
- CHANGELOG atualizado automaticamente em cada cycle.
```

---

## Quando rodar

- **Antes de publicar** v1.0 do squad (bloqueante para release)
- **Após qualquer mudança** em `config.yaml`, `ops-chief.md` ou `handoff-quality-gate.md`
- **Manualmente** quando houver suspeita de regressão no fluxo

---

## Anti-patterns (falhas conhecidas que o teste previne)

1. Squad sem `ops-chief` (V8) — teste não executa, squad rejeitado
2. Chief sem `orchestration_protocol` 5-step (V15) — cenário 1 falha
3. Gate sem Seção 1.1 regex check (V10) — cenário 3 dá falso PASS
4. Framework permissivo para direct chain (V13) — cenário 4 dá falso PASS
5. Chief tentando resolver ambiguidade sozinho — cenário 5 dá falso PASS

---

## Referência

- V20 (squad-creator): toda squad deve ter `tasks/test-handoff-flow.md`
- Base: padrão do `lovarch-platform/tasks/test-handoff-flow.md`
- Gate: `checklists/handoff-quality-gate.md`
