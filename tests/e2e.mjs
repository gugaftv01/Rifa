// Teste ponta a ponta do site real contra os emuladores locais (Auth + Firestore + Hosting).
// Uso: cd tests && npm run e2e
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const BASE = 'http://127.0.0.1:5000';
const PROJ = 'rifa-gugaftv';
const ADM = { email: 'adm@teste.com', senha: 'SenhaForte123' };
const COMUM = { email: 'comum@teste.com', senha: 'SenhaForte123' };
const SHOTS = process.env.SHOTS || new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

async function criarUsuario({ email, senha }) {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=teste', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
  });
  return (await r.json()).localId;
}

// --- Preparação: usuário ADM, usuário comum (sem permissão) e dados iniciais ---
const uidAdm = await criarUsuario(ADM);
await criarUsuario(COMUM);
await fetch(`http://127.0.0.1:8080/v1/projects/${PROJ}/databases/(default)/documents/admins/${uidAdm}`, {
  method: 'PATCH', headers: { Authorization: 'Bearer owner', 'content-type': 'application/json' },
  body: JSON.stringify({ fields: { email: { stringValue: ADM.email } } }),
});
execFileSync('node', ['seed.mjs', ADM.email, ADM.senha, '--emulador'], { stdio: 'inherit' });

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy });
const violacoesCsp = [];
async function novoContexto(opts = {}) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...opts });
  ctx.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violacoesCsp.push(m.text());
  });
  return ctx;
}
const resultados = [];
const ok = (msg) => { resultados.push(msg); console.log('✔', msg); };

try {
  // 1) Página inicial: foto em boa qualidade, 8 rifas independentes
  const ctxA = await novoContexto({ viewport: { width: 1280, height: 900 } });
  const a = await ctxA.newPage();
  const erros = [];
  a.on('pageerror', (e) => erros.push(e.message));
  await a.goto(`${BASE}/?emulador`);
  await a.waitForSelector('#cartelas button');
  await a.waitForFunction(() => document.querySelector('#hero-img').naturalWidth > 0);
  const foto = await a.$eval('#hero-img', (img) => ({ w: img.naturalWidth, h: img.naturalHeight, ajuste: getComputedStyle(img).objectFit }));
  assert.equal(foto.w, 960);
  assert.ok(['cover', 'contain'].includes(foto.ajuste), 'foto pode ser distorcida: object-fit ' + foto.ajuste);
  ok(`foto de fundo carregada em ${foto.w}x${foto.h} com proporção preservada (object-fit: ${foto.ajuste})`);
  assert.equal(await a.locator('#cartelas button').count(), 8);
  assert.match(await a.textContent('#cartela-pos'), /Cartela 1\/8/);
  ok('8 cartelas independentes, escolha discreta no final da página');
  await a.waitForFunction(() => document.querySelectorAll('#grade .num.livre').length === 100);
  await a.screenshot({ path: `${SHOTS}/desktop-inicio.png`, fullPage: false });

  // Abertura animada: aparece e some sozinha, liberando o site.
  const intro = await (await novoContexto(devices['iPhone 13'])).newPage();
  intro.on('pageerror', (e) => erros.push(e.message));
  await intro.goto(`${BASE}/?emulador&intro`);
  await intro.waitForSelector('#intro .letra');
  assert.equal(await intro.locator('#intro .intro-cha .letra').count(), 'Chá Rifa'.length);
  await intro.waitForSelector('#intro', { state: 'detached', timeout: 10000 });
  await intro.click('#grade .num[data-n="1"]');
  assert.equal(await intro.locator('#grade .num.meu').count(), 1);
  ok('abertura animada aparece, some sozinha e libera o site');

  // 2) Visitante seleciona números verdes e reserva
  await a.click('#grade .num[data-n="5"]');
  await a.click('#grade .num[data-n="7"]');
  assert.equal(await a.locator('#grade .num.meu').count(), 2);
  ok('números disponíveis podem ser selecionados');
  await a.click('#btn-reservar');
  await a.fill('#in-nome', 'Maria Silva');
  await a.fill('#in-tel', '61999998888');
  await a.click('#btn-confirmar');
  await a.waitForSelector('#dlg-ok[open]');
  assert.match(await a.textContent('#ok-titulo'), /Reserva feita/);
  await a.click('#btn-fechar-ok');
  await a.waitForSelector('#grade .num.ocupado[data-n="5"]');
  ok('reserva concluída e os números 5 e 7 ficaram marcados com X');

  // 3) Outro visitante vê os números indisponíveis em tempo real
  const ctxB = await novoContexto(devices['iPhone 13']);
  const b = await ctxB.newPage();
  await b.goto(`${BASE}/?emulador`);
  await b.waitForSelector('#grade .num.ocupado[data-n="7"]');
  assert.equal(await b.locator('#grade .num[data-n="5"]').isDisabled(), true);
  ok('outro visitante vê 5 e 7 como vendidos (não clicáveis)');

  // 4) Rifas independentes: o número 5 da rifa 2 continua livre
  await b.click('#cartelas [data-rifa="rifa-2"]');
  await b.waitForSelector('#grade .num.livre[data-n="5"]');
  ok('o número 5 da cartela 2 continua livre (cartelas independentes)');
  await b.click('#cartelas [data-rifa="rifa-1"]');
  await b.waitForSelector('#grade .num.ocupado[data-n="5"]');

  // 5) Duas pessoas tentam o mesmo número ao mesmo tempo: só uma consegue
  await a.click('#grade .num[data-n="10"]');
  await b.click('#grade .num[data-n="10"]');
  await a.click('#btn-reservar');
  await b.click('#btn-reservar');
  await a.fill('#in-nome', 'Pessoa A'); await a.fill('#in-tel', '61911112222');
  await b.fill('#in-nome', 'Pessoa B'); await b.fill('#in-tel', '61933334444');
  await Promise.all([a.click('#btn-confirmar'), b.click('#btn-confirmar')]);
  await Promise.all([a.waitForSelector('#dlg-ok[open]'), b.waitForSelector('#dlg-ok[open]')]);
  const tA = await a.textContent('#ok-titulo');
  const tB = await b.textContent('#ok-titulo');
  const sucessos = [tA, tB].filter((t) => /Reserva feita/.test(t)).length;
  assert.equal(sucessos, 1, `esperado 1 sucesso, veio: ${tA} | ${tB}`);
  ok('duas pessoas clicaram no número 10 ao mesmo tempo: só uma conseguiu reservar');
  await b.screenshot({ path: `${SHOTS}/celular-resultado.png` });
  await b.click('#btn-fechar-ok');
  await a.click('#btn-fechar-ok');
  await b.screenshot({ path: `${SHOTS}/celular-grade.png`, fullPage: true });

  // 6) Visitante não acessa o ADM
  const v = await (await novoContexto()).newPage();
  await v.goto(`${BASE}/admin?emulador`);
  await v.waitForSelector('#tela-login:not([hidden])');
  assert.equal(await v.isVisible('#tela-painel'), false);
  ok('visitante em /admin vê apenas a tela de login');
  await v.fill('#login-email', COMUM.email);
  await v.fill('#login-senha', COMUM.senha);
  await v.click('#btn-entrar');
  await v.waitForFunction(() => /permissão/.test(document.querySelector('#login-erro').textContent));
  ok('conta sem permissão de ADM é recusada');
  await v.fill('#login-email', ADM.email);
  await v.fill('#login-senha', 'senhaErrada');
  await v.click('#btn-entrar');
  await v.waitForFunction(() => /incorretos/.test(document.querySelector('#login-erro').textContent));
  ok('senha errada é recusada');

  // 7) ADM entra, vê as vendas e confirma pagamento
  const adm = await (await novoContexto({ viewport: { width: 1280, height: 900 } })).newPage();
  await adm.goto(`${BASE}/admin?emulador`);
  await adm.fill('#login-email', ADM.email);
  await adm.fill('#login-senha', ADM.senha);
  await adm.click('#btn-entrar');
  await adm.waitForSelector('#tela-painel:not([hidden])');
  await adm.waitForFunction(() => document.querySelectorAll('#resumo-tabela tr').length === 8);
  ok('login do ADM funciona e mostra as 8 rifas');
  await adm.screenshot({ path: `${SHOTS}/adm-resumo.png` });

  await adm.click('[data-secao="numeros"]');
  await adm.waitForSelector('#num-grade .num.reservado[data-n="5"]');
  await adm.click('#num-grade .num[data-n="5"]');
  await adm.click('[data-acao="vender"]');
  await adm.waitForSelector('#num-grade .num.ocupado[data-n="5"]');
  ok('ADM confirmou pagamento do número 5 (vendido)');

  // ADM vende um número livre direto
  await adm.click('#num-grade .num[data-n="50"]');
  await adm.fill('#dn-nome', 'Venda Balcão');
  await adm.fill('#dn-tel', '61955556666');
  await adm.click('[data-acao="vender"]');
  await adm.waitForSelector('#num-grade .num.ocupado[data-n="50"]');
  await a.waitForSelector('#grade .num.ocupado[data-n="50"]');
  ok('ADM marcou o número 50 como vendido e o site atualizou na hora');

  // ADM libera o número 7 e ele volta a ficar verde para os visitantes
  adm.once('dialog', (d) => d.accept());
  await adm.click('#num-grade .num[data-n="7"]');
  await adm.click('[data-acao="liberar"]');
  await a.waitForSelector('#grade .num.livre[data-n="7"]');
  ok('ADM liberou o número 7 e ele voltou a ficar disponível no site');
  await adm.screenshot({ path: `${SHOTS}/adm-numeros.png` });

  // Reservas: lista com dados do comprador
  await adm.click('[data-secao="reservas"]');
  await adm.waitForFunction(() => document.querySelectorAll('#res-tabela tr').length >= 3);
  ok('ADM vê a lista de reservas com nome e WhatsApp');

  // ADM edita rifa (quantidade de números e prêmio)
  await adm.click('[data-secao="rifas"]');
  await adm.click('[data-editar="rifa-3"]');
  await adm.fill('#form-rifa [name=premio]', 'Air Fryer');
  await adm.fill('#form-rifa [name=totalNumeros]', '200');
  await adm.fill('#form-rifa [name=preco]', '5');
  await adm.click('#dr-salvar');
  await a.click('#cartelas [data-rifa="rifa-3"]');
  await a.waitForFunction(() => document.querySelectorAll('#grade .num').length === 200);
  assert.match(await a.textContent('#premios'), /Air Fryer/);
  ok('ADM alterou a Rifa 3 para 200 números e prêmio "Air Fryer"; o site atualizou');

  // Não deixa reduzir abaixo de um número já vendido
  await adm.click('[data-editar="rifa-1"]');
  await adm.fill('#form-rifa [name=totalNumeros]', '20');
  await adm.click('#dr-salvar');
  await adm.waitForFunction(() => /não pode ser menor/.test(document.querySelector('#dr-erro').textContent));
  await adm.click('#dr-cancelar');
  ok('ADM não consegue reduzir a quantidade abaixo de um número já vendido');

  // ADM altera texto da página inicial
  await adm.click('[data-secao="pagina"]');
  await adm.fill('#form-pagina [name=titulo]', 'Rifa do Casal');
  await adm.fill('#form-pagina [name=pix]', 'chave-pix-teste');
  await adm.click('#form-pagina button[type=submit]');
  await a.waitForFunction(() => document.querySelector('#titulo').textContent === 'Rifa do Casal');
  ok('ADM alterou o título da página inicial');

  await a.screenshot({ path: `${SHOTS}/desktop-final.png`, fullPage: true });
  assert.deepEqual(erros, [], 'erros de JavaScript na página: ' + erros.join(' | '));
  ok('nenhum erro de JavaScript no site');
  assert.deepEqual(violacoesCsp, [], 'violações de CSP: ' + violacoesCsp.join(' | '));
  ok('nenhuma violação da política de segurança de conteúdo (CSP)');
} finally {
  await browser.close();
}
console.log(`\n${resultados.length} verificações passaram.`);
