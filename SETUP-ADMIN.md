# SETUP-ADMIN — config necessária no Supabase

> **Quem precisa fazer:** apenas o admin do Supabase (Pablo). **Uma vez.**
> **Quando:** antes do primeiro `npm run login` funcionar.

---

## Contexto

A CLI (`npm run login`) inicia um fluxo PKCE OAuth com provider Google, via Supabase Auth. Para o callback voltar para `http://localhost:54321/callback` na máquina do colaborador, o Supabase precisa ter esse URL na allowlist de **Redirect URLs**.

Sem essa config, o login falha com `redirect_uri_mismatch` — o Google OAuth rejeita o destino.

---

## Passos

### 1. Abrir o dashboard

https://supabase.com/dashboard/project/xmqmuxwlecjbpubjdkoj/auth/url-configuration

### 2. Seção "Redirect URLs"

Adicionar exatamente:

```
http://localhost:54321/callback
```

> Wildcard não é recomendado aqui — manter explícito.

### 3. Provider Google OAuth

Verificar em https://supabase.com/dashboard/project/xmqmuxwlecjbpubjdkoj/auth/providers

- **Google** deve estar habilitado (já está, é o mesmo que `primeteam.archprime.io` usa).
- Client ID e Client Secret do Google já estão configurados (não precisa mexer).
- Em "Authorized redirect URIs" do Google Cloud Console, verificar que o URI do Supabase (`https://xmqmuxwlecjbpubjdkoj.supabase.co/auth/v1/callback`) está presente. Esse é o endpoint interno do Supabase — o Google redireciona pra lá, e o Supabase redireciona pro `localhost:54321/callback` do colaborador.

### 4. Validar com um teste

Na máquina do admin (ou qualquer colaborador):

```bash
cd ~/archprime/primeteam-ops   # ou onde o repo está clonado
npm install
npm run login
```

Deve:
1. Abrir navegador em URL do Google
2. Pedir para escolher conta Google `@archprime.io`
3. Redirecionar para `http://localhost:54321/callback`
4. CLI captura o `code`, troca por session, salva em `~/.primeteam/session.json`
5. CLI imprime `✓ Logado como <email>`

Depois:

```bash
npm run whoami
```

Deve mostrar email + roles + expiração.

---

## Troubleshooting

### `redirect_uri_mismatch`

**Causa:** `http://localhost:54321/callback` ainda não está na allowlist.
**Fix:** passo 2 acima.

### `EADDRINUSE: address already in use 127.0.0.1:54321`

**Causa:** outro processo escutando na porta 54321. Pode ser um login anterior que travou.
**Fix rápido:** `lsof -i :54321` → `kill <pid>`. Ou aguardar ~60s para o SO liberar.

### Browser abre mas Google retorna "acesso bloqueado"

**Causa:** conta Google usada não é `@archprime.io`, e o OAuth app está restrito ao workspace.
**Fix:** faça login com sua conta ArchPrime.

### Callback volta mas `exchangeCodeForSession` falha

**Causa:** geralmente PKCE verifier foi perdido (aconteceu restart do processo CLI entre abrir URL e receber callback).
**Fix:** rodar `npm run login` novamente sem interromper.

---

## Notas de segurança

- O callback só escuta em `127.0.0.1` (loopback), não em `0.0.0.0` — nenhum outro host na rede local consegue interceptar.
- A `access_token` fica em `~/.primeteam/session.json` com permissão `0600` (só o owner lê).
- O diretório `~/.primeteam/` tem permissão `0700`.
- O token expira (padrão 1h no Supabase) — whoami avisa se expirado.
- Fase 2+ implementará refresh automático usando o `refresh_token`.
