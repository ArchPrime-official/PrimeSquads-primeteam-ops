// node --test hooks/  — a máscara de segredos do registrador de atividade do Claude Code.
// 04/10/2026: um segredo de webhook do Stripe colado num prompt ficou gravado em activity_logs.
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeString, sanitizeDeep } = require('./log-claude-activity.cjs');

const SEGREDOS = [
  ['webhook Stripe', 'whsec_' + 'A'.repeat(32)],
  ['chave restrita Stripe', 'rk_live_' + 'B'.repeat(24)],
  ['chave Stripe', 'sk_live_' + 'C'.repeat(24)],
  ['secret Supabase', 'sb_secret_' + 'D'.repeat(24)],
  ['gateway de IA', 'ptk_' + 'E'.repeat(24)],
  ['Resend', 're_' + 'F'.repeat(8) + '_' + 'G'.repeat(20)],
  ['GitHub', 'gho_' + 'H'.repeat(36)],
  ['Meta', 'EAA' + 'I'.repeat(80)],
  ['Google', 'AIza' + 'J'.repeat(35)],
  ['JWT', 'eyJ' + 'k'.repeat(30) + '.' + 'l'.repeat(30) + '.' + 'm'.repeat(30)],
];

for (const [nome, valor] of SEGREDOS) {
  test(`mascara ${nome}`, () => {
    const out = sanitizeString(`ecco la chiave ${valor} per il webhook`);
    assert.ok(!out.includes(valor), out);
    assert.ok(out.includes('ecco la chiave') && out.includes('per il webhook'), out);
  });
}

test('mascara password=/senha: mas mantém o rótulo', () => {
  assert.strictEqual(sanitizeString('password=Abc12345!'), 'password=[REDACTED]');
  assert.strictEqual(sanitizeString('senha: minhaSenha99'), 'senha: [REDACTED]');
});

test('texto comum passa igual (sem falso positivo)', () => {
  const t = 'ajusta o re_render da página e o EAAP do lead, o ghost_ e o sk_tabela';
  assert.strictEqual(sanitizeString(t), t);
});

test('sanitizeDeep entra em objetos e listas', () => {
  const out = sanitizeDeep({ cmd: 'curl -H "Authorization: Bearer ' + 'eyJ' + 'a'.repeat(30) + '.' + 'b'.repeat(30) + '.' + 'c'.repeat(30) + '"', lista: ['whsec_' + 'Z'.repeat(30)] });
  assert.ok(!JSON.stringify(out).includes('whsec_ZZZ'));
  assert.ok(JSON.stringify(out).includes('[REDACTED_JWT]'));
});
