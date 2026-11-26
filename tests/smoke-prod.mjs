// Verificação SOMENTE LEITURA do banco de produção: abre as páginas servidas localmente
// (com os mesmos cabeçalhos de segurança do Hosting) conectadas ao Firestore real.
// Não grava nada. Uso: cd tests && npm run smoke
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const BASE = 'http://127.0.0.1:5000';

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy });
const problemas = [];
const ok = (m) => console.log('✔', m);

try {
  for (const [nome, opts] of [['computador', { viewport: { width: 1280, height: 900 } }], ['celular', devices['iPhone 13']]]) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...opts });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => problemas.push(`${nome}: ${e.message}`));
    p.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problemas.push(`${nome} CSP: ${m.text()}`); });
    await p.goto(`${BASE}/`);
    await p.waitForSelector('#cartelas button', { timeout: 30000 });
    assert.equal(await p.locator('#cartelas button').count(), 8);
    await p.waitForFunction(() => document.querySelectorAll('#grade .num').length === 100, null, { timeout: 30000 });
    ok(`${nome}: 8 cartelas e 100 números na cartela 1 carregados do banco real`);

    // Dados privados dos compradores não podem ser lidos por visitantes.
    const leitura = await p.evaluate(async () => {
      const { getFirestore, collection, getDocs } = await import('/vendor/firebase/13.4.0/firebase-firestore.js');
      const { getApp } = await import('/vendor/firebase/13.4.0/firebase-app.js');
      try { await getDocs(collection(getFirestore(getApp()), 'reservas')); return 'LIDO'; } catch (e) { return e.code; }
    });
    assert.equal(leitura, 'permission-denied');
    ok(`${nome}: visitante NÃO consegue ler a coleção de reservas (dados pessoais protegidos)`);
    await p.screenshot({ path: `screenshots/producao-${nome}.png` });

    const adm = await ctx.newPage();
    await adm.goto(`${BASE}/admin`);
    await adm.waitForSelector('#tela-login:not([hidden])', { timeout: 30000 });
    ok(`${nome}: /admin mostra apenas a tela de login`);
    await ctx.close();
  }
  assert.deepEqual(problemas, [], problemas.join('\n'));
  ok('nenhum erro de JavaScript nem violação de CSP');
} finally {
  await browser.close();
}
