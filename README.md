# primeteam-ops

> Sua caixa de ferramentas para operar a plataforma PrimeTeam via terminal — **sem precisar saber programar**.

---

## O que é?

Um companheiro para o time da ArchPrime que substitui o trabalho repetitivo na plataforma web. Em vez de abrir o navegador e clicar em forms, você **conversa em português** com um especialista dentro do terminal.

- "lança um pagamento de 250€ pra Jessica — bônus"
- "cria uma landing page para o evento de Roma"
- "move o lead da Maria pra 'Proposta Enviada'"

O resultado aparece imediatamente na plataforma. O navegador vira só a janela onde você **vê** — o trabalho acontece aqui.

---

## Para quem é

Todas as 10 pessoas do time da ArchPrime. Cada um só enxerga o que seu papel permite.

| Papel | Quem | O que pode fazer |
|-------|------|------------------|
| 👑 **Dona/dono** | Pablo | Tudo — inclusive gerenciar usuários e ver o log completo |
| 💰 **Financeiro** | Joyce, Larissa, Adriana | Lançar pagamentos, conciliar, ver saldos, tarefas, perfil |
| 🎨 **Marketing** | Sandra | Landing pages, automações de email, campanhas Meta |
| 📞 **Comercial** | Miriam, Daniel, Yuri | Leads, oportunidades, agenda, chamadas |
| 🌱 **CS** | Jessica, Andrea | Estudantes, tickets, onboarding, check-ins |

---

## Como usar — em 3 comandos

### Todo dia

```bash
pto            # verifica atualizações + seu acesso + resume onde você parou
claude         # abre o Claude Code
```

Dentro do Claude Code:

```
/PrimeteamOps:agents:ops-chief
```

Depois disso, só descreva o que precisa. O chief te conecta com o especialista certo.

### Primeira vez? Use o wizard

```bash
pto setup
```

Ele faz tudo passo-a-passo: checa seu ambiente, te loga com Google, confirma seu papel e mostra o que você pode fazer.

---

## Receitas por papel

Veja [`HOW-TO.md`](./HOW-TO.md) com exemplos reais de conversa por papel:
- 🎨 Marketing — criar LP, listar campanhas, ver performance
- 💰 Financeiro — lançar pagamento, ver saldos, conciliar, recorrências
- 📞 Comercial — criar lead, mover oportunidade, agenda, chamadas AI
- 🌱 CS — listar estudantes, aprovar onboarding, marcar check-in
- 👑 Owner — activity log, gerenciar usuários, importar CSV

---

## Algo não funciona?

Rode:

```bash
pto doctor
```

Copia o resultado, cola no Slack no `#tech` e avisa Pablo. Você não precisa entender o output — só passar pra quem sabe.

---

## Comandos disponíveis

| Comando | Quando usar |
|---------|-------------|
| `pto` | Todo dia, ao abrir o terminal (rotina diária) |
| `pto setup` | Primeira vez — passo-a-passo guiado |
| `pto login` | Entrar com sua conta Google @archprime.io |
| `pto whoami` | Ver quem está logada/o + seus papéis |
| `pto refresh` | Renovar acesso sem precisar relogar |
| `pto logout` | Sair deste computador |
| `pto update` | Puxar atualizações novas do squad |
| `pto doctor` | Diagnóstico do ambiente (para pedir ajuda) |

Ainda sem o comando global `pto`? Use `npm start`, `npm run login` etc. O wizard `pto setup` instala o global quando rodar pela primeira vez.

---

## Coisas que o squad **NÃO** faz (de propósito)

- ❌ **Transferir dinheiro** via Revolut — sempre pela app com 2FA.
- ❌ **Decidir estratégia** (pausar campanha, reter cliente) — o squad executa, os squads de expertise decidem.
- ❌ **Criar campanhas Meta do zero** — use o Gerenciador de Anúncios Meta.
- ❌ **Escrever copy de emails/LPs** — use `/videoCreative` ou `/metaAds:ezra-firestone`.
- ❌ **Apagar coisas sem confirmação dupla** — sempre pergunta antes.

---

## Quando chamar outro squad

| Situação | Squad |
|----------|-------|
| **Executar** algo na plataforma | `/PrimeteamOps` (este) |
| **Pensar estratégia** Meta Ads | `/metaAds` |
| **Pensar estratégia** de negócio | `/stratMgmt` |
| **Melhorar** a plataforma | `/ptImprove` |
| **Criar** vídeos/storytelling | `/videoCreative` |

---

## Suporte

- Dúvida rápida: `pto doctor` + cola no `#tech` do Slack.
- Problema sério: email direto pro Pablo — **pablo@archprime.io**.
- Sugestão de melhoria: abra uma issue em [github.com/ArchPrime-official/PrimeSquads-primeteam-ops/issues](https://github.com/ArchPrime-official/PrimeSquads-primeteam-ops/issues).

---

---

# Para quem programa — detalhes técnicos

> Se você não é desenvolvedor, pode ignorar daqui pra baixo. A parte técnica está abaixo para transparência e para quem for manter o squad.

## Arquitetura

```
primeteam-ops/
├── cli/                 # TypeScript — commander + @clack/prompts + PKCE OAuth
│   ├── index.ts         # entrypoint (commander)
│   ├── setup.ts         # wizard idempotente
│   ├── start.ts         # rotina diária
│   ├── login.ts         # OAuth Google via Supabase (loopback 54321)
│   ├── session.ts       # read/save + refresh automático
│   ├── doctor.ts        # healthcheck
│   ├── update.ts        # git fetch/pull + npm install condicional
│   └── ...
├── agents/              # 10 agents Claude Code (ops-chief + 9 specialists)
├── tasks/               # 12 tasks HO-TP-001
├── workflows/           # 7 workflows multi-fase
├── checklists/          # handoff quality gate
├── data/                # rules centrais, schemas, activity-logging spec
└── config.yaml          # handoff_protocol + tier_validation
```

**Topologia:** hub-and-spoke — todos os specialists retornam ao `ops-chief` com handoff card padronizado. Nenhum specialist encadeia diretamente para outro.

## Autenticação

- **PKCE OAuth** via Supabase: CLI inicia um servidor local em `127.0.0.1:54321`, abre o navegador para autorização Google, captura o code no callback, troca por session via `exchangeCodeForSession()`.
- Session (JSON com access_token + refresh_token + expires_at + user_id + email) salva em `~/.primeteam/session.json` com `chmod 600`.
- **Auto-refresh**: `cli/session.ts::maybeRefresh()` checa janela de expiração e usa o refresh_token para renovar silenciosamente (Sprint 22).
- **Sem service role** — o squad NUNCA tem credencial privilegiada. Usa o JWT do usuário, respeitando RLS do Supabase.

## Segurança

**O que este repo CONTÉM (safe no GitHub público):**
- Código do CLI (TypeScript)
- Agents (markdown — instruções para o Claude)
- `SUPABASE_URL` e `SUPABASE_ANON_KEY` — públicas por design (já aparecem no browser de `primeteam.archprime.io`).

**O que este repo NÃO CONTÉM:**
- ❌ `SUPABASE_SERVICE_ROLE_KEY` (NUNCA)
- ❌ Credenciais de usuário (ficam em `~/.primeteam/session.json` local).

**Como a segurança funciona:** a anon key sozinha não dá acesso a nada. Toda query passa pelas policies RLS do Supabase. O JWT pessoal de cada usuário é o que autoriza acesso aos dados dele — sem JWT válido, o Supabase retorna 401. Este é o mesmo modelo usado pelo `primeteam.archprime.io` no browser — o squad é só outro cliente da mesma API.

## Setup admin (uma vez, Pablo)

Antes do primeiro login funcionar em qualquer máquina, adicionar `http://localhost:54321/callback` na allowlist de **Redirect URLs** no dashboard do Supabase. Ver [`SETUP-ADMIN.md`](./SETUP-ADMIN.md).

## Build + dev

```bash
npm install          # instala deps + roda postinstall banner + compila dist/
npm run dev -- whoami   # rodar em dev via tsx
npm run build        # tsc → dist/
npm link             # habilita comando `pto` global
```

`tsc --noEmit` como typecheck. Strict mode ativado.

## Activity logging (Sprint 20)

Todo cycle gravado em `activity_logs` (tabela Supabase existente) com 4 tipos de entry:
- `cycle_opened` / `cycle_closed` — pelo ops-chief
- `handoff` — entre agents
- `mutation` (`{specialist_id}.{playbook}`) — pelo specialist que mutou

Correlation via `cycle_id`. Privacy strict: nunca tokens/recordings/emails de terceiros em `details`. Ver [`data/activity-logging.md`](./data/activity-logging.md) e [`data/handoff-card-template.md`](./data/handoff-card-template.md).

## Contribuindo

```bash
cd ~/archprime/primeteam-ops  # ou onde clonou
git checkout -b feat/minha-melhoria
# editar
git commit -m "feat: descrição da mudança"
git push -u origin feat/minha-melhoria
gh pr create --fill
```

Estrutura `.claude/commands/PrimeteamOps/` contém symlinks para `agents/`, `tasks/`, `checklists/` do próprio repo. Edit direto nos arquivos originais — symlinks atualizam na hora.

## Roadmap

### ✅ Fase 0 — Remediação de segurança
Concluída — RLS em 5 tabelas + `verify_jwt` em 2 edge functions (PR #951/#952 no primeteam).

### ✅ Fase 1 — Foundation (v0.1.0)
Scaffold, config, central rules, handoff infra, ops-chief + auth-specialist.

### ✅ Fase 2 — Operational MVP (v1.1.0)
17 sprints mergeados. 10 agents, 7 workflows, 12 tasks HO-TP-001, CLI PKCE, 4 boundaries externas (Calendar, Revolut, Meta, Phone), activity logging integrado.

### 🚧 Fase 3 — CLI para humanos (v1.2.0, em progresso)
- Sprint 22 ✅ — CLI DX base (`pto setup`/`start`/`doctor`/`update`/`refresh`)
- Sprint 23 🚧 — Humanizar copy + HOW-TO.md (este PR)
- Sprint 24 ⏳ — i18n PT-BR + IT + EN + runtime switching
- Sprint 25 ⏳ — Session hygiene (hook Claude Code com avisos de sessão longa)
- Sprint 26 ⏳ — Onboarding guiado no ops-chief (opcional)

### ⏳ Fase 4 — Strategic
- AI chat agent
- `wf-platform-audit.yaml`

## Licença & contato

Uso interno ArchPrime. Dúvidas técnicas: **pablo@archprime.io**.

**Documentação adicional:**
- [`HOW-TO.md`](./HOW-TO.md) — guia prático por papel
- [`SETUP-ADMIN.md`](./SETUP-ADMIN.md) — config inicial do Supabase (só Pablo)
- [`CHANGELOG.md`](./CHANGELOG.md) — histórico de sprints
- [`FINAL-STATE.md`](./FINAL-STATE.md) — status consolidado pós Sprint 17
- [`data/activity-logging.md`](./data/activity-logging.md) — padrão de observabilidade
