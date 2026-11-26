// Site público (formato cartaz): cartela de corações e reserva de números em tempo real.
import { db } from './firebase.js';
import {
  collection, doc, onSnapshot, writeBatch, serverTimestamp,
} from '/vendor/firebase/13.4.0/firebase-firestore.js';
import {
  CONFIG_PADRAO, brl, soDigitos, formatarTelefone, linkWhatsApp, escapar, toast,
} from './util.js';

const MAX_SELECAO = 30;
const $ = (id) => document.getElementById(id);

const estado = {
  config: { ...CONFIG_PADRAO },
  rifas: [],
  rifaId: null,
  ocupados: new Set(),       // números indisponíveis da cartela atual
  selecionados: new Set(),   // números escolhidos pelo visitante
  numerosCarregados: false,
  pararNumeros: null,
};

const rifaAtual = () => estado.rifas.find((r) => r.id === estado.rifaId);
const listaNumeros = (nums) => nums.join(', ');

/* ---------- Textos, foto e Pix (config/site) ---------- */
onSnapshot(doc(db, 'config/site'), (snap) => {
  const c = estado.config = { ...CONFIG_PADRAO, ...(snap.exists() ? snap.data() : {}) };
  $('titulo').textContent = c.titulo;
  $('subtitulo').textContent = c.subtitulo || '';
  $('subtitulo').hidden = !c.subtitulo;
  document.title = c.subtitulo ? `${c.titulo} · ${c.subtitulo}` : c.titulo;
  $('mensagem').textContent = c.mensagem || '';
  $('mensagem').hidden = !c.mensagem;
  $('pix').textContent = c.pix || 'Copia e cola';
  $('pix-btn').hidden = !c.pix && !c.pixCopiaECola;
  $('pix-dica').textContent = c.pixCopiaECola ? 'toque para copiar o Pix copia e cola' : 'toque para copiar';
  const foto = c.heroImagem || CONFIG_PADRAO.heroImagem;
  for (const id of ['hero-img', 'fundo-blur']) {
    if ($(id).getAttribute('src') !== foto) $(id).src = foto;
  }
}, (e) => console.error('config', e));

/* ---------- Cartelas (rifas) ---------- */
onSnapshot(collection(db, 'rifas'), (snap) => {
  estado.rifas = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.ativa !== false)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));

  if (!rifaAtual()) {
    const daUrl = location.hash.replace('#', '');
    const inicial = estado.rifas.find((r) => r.id === daUrl) || estado.rifas[0];
    if (inicial) selecionarRifa(inicial.id, false, true);
  }
  desenharCartelas();
  desenharRifa();
}, (e) => {
  console.error('rifas', e);
  $('grade').innerHTML = '<p class="carregando">Não foi possível carregar. Verifique sua conexão.</p>';
});

function desenharCartelas() {
  $('cartelas-nav').hidden = estado.rifas.length < 2;
  $('cartelas').innerHTML = estado.rifas.map((r, i) => {
    const ativa = r.id === estado.rifaId;
    return `<button type="button" data-rifa="${escapar(r.id)}" class="${ativa ? 'ativa' : ''}" aria-pressed="${ativa}"
      aria-label="Cartela ${i + 1}: ${escapar(r.nome)}" title="${escapar(r.nome)}">${i + 1}</button>`;
  }).join('');
}

$('cartelas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rifa]');
  if (!b || b.dataset.rifa === estado.rifaId) return;
  if (selecionarRifa(b.dataset.rifa, true)) $('dica').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function selecionarRifa(id, mexerUrl, semPerguntar = false) {
  if (!semPerguntar && estado.selecionados.size
    && !confirm('Trocar de cartela vai limpar os números escolhidos. Continuar?')) return false;
  estado.rifaId = id;
  estado.selecionados.clear();
  estado.ocupados = new Set();
  estado.numerosCarregados = false;
  if (mexerUrl) history.replaceState(null, '', `#${id}`);
  if (estado.pararNumeros) estado.pararNumeros();
  estado.pararNumeros = onSnapshot(collection(db, 'rifas', id, 'numeros'), (snap) => {
    estado.ocupados = new Set(snap.docs.map((d) => Number(d.id)));
    estado.numerosCarregados = true;
    // Se alguém reservou um número que eu tinha escolhido, ele sai da minha seleção.
    const perdidos = [...estado.selecionados].filter((n) => estado.ocupados.has(n));
    perdidos.forEach((n) => estado.selecionados.delete(n));
    if (perdidos.length) toast(`O número ${listaNumeros(perdidos)} acabou de ser reservado por outra pessoa.`, 'aviso');
    desenharRifa();
  }, (e) => console.error('numeros', e));
  desenharCartelas();
  desenharRifa();
  return true;
}

/* ---------- Cartela atual ---------- */
function desenharRifa() {
  const r = rifaAtual();
  if (!r) {
    if (!estado.rifas.length) $('grade').innerHTML = '<p class="carregando">Nenhuma cartela disponível no momento.</p>';
    return;
  }
  const pos = estado.rifas.indexOf(r) + 1;
  $('cartela-pos').textContent = `Cartela ${pos}/${estado.rifas.length}`;
  $('preco').textContent = brl(r.preco);
  $('data-sorteio').hidden = !r.dataSorteio;
  if (r.dataSorteio) $('data-sorteio').textContent = `Sorteio: ${new Date(`${r.dataSorteio}T12:00:00`).toLocaleDateString('pt-BR')}`;
  $('premios').textContent = r.premio || '';
  $('premios-box').hidden = !r.premio;
  desenharGrade(r);
  desenharCarrinho();
}

// Coração ao lado da dica: passa bem rápido pelos números livres da cartela,
// depois fica só o coração piscando de leve; e repete.
const rodizio = { lista: [], timer: null };
function atualizarRodizio(r) {
  const total = Number(r.totalNumeros) || 0;
  const livres = [];
  for (let n = 1; n <= total; n++) if (!estado.ocupados.has(n)) livres.push(n);
  rodizio.lista = livres;
  $('dica-coracao').hidden = !estado.numerosCarregados || !livres.length;
  if (livres.length && !rodizio.timer) varrerNumeros();
}
function varrerNumeros() {
  const lista = rodizio.lista;
  const el = $('dica-num');
  const coracao = $('dica-coracao');
  if (!lista.length) { rodizio.timer = null; return; }
  coracao.classList.remove('descansando');
  const passo = Math.max(1, Math.ceil(lista.length / 30)); // no máximo ~30 trocas (~2 s)
  let i = 0;
  const tique = () => {
    if (i < lista.length) {
      el.textContent = lista[i];
      i += passo;
      rodizio.timer = setTimeout(tique, 70);
    } else {
      el.textContent = '';
      coracao.classList.add('descansando');
      rodizio.timer = setTimeout(varrerNumeros, 5000);
    }
  };
  tique();
}

function desenharGrade(r) {
  atualizarRodizio(r);
  if (!estado.numerosCarregados) {
    $('grade').innerHTML = '<p class="carregando">Carregando números…</p>';
    return;
  }
  const total = Number(r.totalNumeros) || 0;
  const partes = [];
  for (let n = 1; n <= total; n++) {
    const ocupado = estado.ocupados.has(n);
    const sel = estado.selecionados.has(n);
    const classe = ocupado ? 'num ocupado' : sel ? 'num meu' : 'num livre';
    const situacao = ocupado ? 'vendido' : sel ? 'escolhido' : 'disponível';
    partes.push(`<button type="button" class="${classe}" data-n="${n}" ${ocupado ? 'disabled' : ''} aria-pressed="${sel}" aria-label="Número ${n}, ${situacao}"><span>${n}</span></button>`);
  }
  $('grade').innerHTML = partes.join('');
}

$('grade').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-n]');
  if (!b || b.disabled) return;
  const n = Number(b.dataset.n);
  if (estado.selecionados.has(n)) estado.selecionados.delete(n);
  else {
    if (estado.selecionados.size >= MAX_SELECAO) { toast(`Máximo de ${MAX_SELECAO} números por reserva.`, 'aviso'); return; }
    estado.selecionados.add(n);
  }
  const sel = estado.selecionados.has(n);
  b.className = sel ? 'num meu' : 'num livre';
  b.setAttribute('aria-pressed', sel);
  b.setAttribute('aria-label', `Número ${n}, ${sel ? 'escolhido' : 'disponível'}`);
  desenharCarrinho();
});

/* ---------- Pix ---------- */
async function copiarPix() {
  const { pix, pixCopiaECola } = estado.config;
  try {
    await navigator.clipboard.writeText(pixCopiaECola || pix);
    toast(pixCopiaECola ? 'Pix copia e cola copiado! Cole no app do banco.' : 'Chave Pix copiada!');
  }
  catch { toast('Não foi possível copiar. Selecione a chave manualmente.', 'aviso'); }
}
$('pix-btn').addEventListener('click', copiarPix);

/* ---------- Barra de escolhidos ---------- */
function desenharCarrinho() {
  const r = rifaAtual();
  const nums = [...estado.selecionados].sort((a, b) => a - b);
  $('carrinho').hidden = !nums.length || !r;
  document.body.classList.toggle('com-carrinho', nums.length > 0);
  if (!nums.length || !r) return;
  $('carrinho-qtd').textContent = `${nums.length} ${nums.length === 1 ? 'número' : 'números'}`;
  $('carrinho-total').textContent = ` · ${brl(nums.length * (Number(r.preco) || 0))}`;
  $('carrinho-nums').textContent = listaNumeros(nums);
}

$('btn-limpar').addEventListener('click', () => {
  estado.selecionados.clear();
  desenharRifa();
});

/* ---------- Reserva ---------- */
$('btn-reservar').addEventListener('click', () => {
  const r = rifaAtual();
  const nums = [...estado.selecionados].sort((a, b) => a - b);
  const pos = estado.rifas.indexOf(r) + 1;
  $('dlg-resumo').innerHTML = `<strong>Cartela ${pos}/${estado.rifas.length}</strong><br>Números: <strong>${listaNumeros(nums)}</strong><br>Total: <strong>${brl(nums.length * (Number(r.preco) || 0))}</strong>`;
  $('form-erro').textContent = '';
  try {
    const salvo = JSON.parse(localStorage.getItem('rifa-comprador') || '{}');
    if (salvo.nome && !$('in-nome').value) $('in-nome').value = salvo.nome;
    if (salvo.telefone && !$('in-tel').value) $('in-tel').value = formatarTelefone(salvo.telefone);
  } catch { /* armazenamento indisponível */ }
  $('dlg-reserva').showModal();
});

$('btn-cancelar').addEventListener('click', () => $('dlg-reserva').close());

$('in-tel').addEventListener('input', (e) => {
  const d = soDigitos(e.target.value).slice(0, 11);
  e.target.value = d.length > 2 ? formatarTelefone(d) || d : d;
});

$('form-reserva').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = $('in-nome').value.trim().replace(/\s+/g, ' ');
  const telefone = soDigitos($('in-tel').value);
  if (nome.length < 2) { $('form-erro').textContent = 'Informe seu nome.'; return; }
  if (telefone.length < 10 || telefone.length > 11) { $('form-erro').textContent = 'Informe um WhatsApp válido com DDD.'; return; }

  const r = rifaAtual();
  const nums = [...estado.selecionados].sort((a, b) => a - b);
  const btn = $('btn-confirmar');
  btn.disabled = true;
  btn.textContent = 'Reservando…';
  try { localStorage.setItem('rifa-comprador', JSON.stringify({ nome, telefone })); } catch { /* ok */ }

  // Cada número é gravado em um batch próprio (número público + dados privados).
  // As regras do banco recusam o número se ele já existir: assim ninguém reserva
  // um número que outra pessoa acabou de pegar.
  const resultados = await Promise.all(nums.map(async (n) => {
    const reservaId = `${r.id}_${n}`;
    const batch = writeBatch(db);
    batch.set(doc(db, 'rifas', r.id, 'numeros', String(n)), { status: 'reservado', reservaId, criadoEm: serverTimestamp() });
    batch.set(doc(db, 'reservas', reservaId), { rifaId: r.id, numero: n, nome, telefone, status: 'reservado', criadoEm: serverTimestamp() });
    try { await batch.commit(); return { n, ok: true }; }
    catch (err) { console.warn('falha ao reservar', n, err.code); return { n, ok: false }; }
  }));

  btn.disabled = false;
  btn.textContent = 'Confirmar reserva';
  const ok = resultados.filter((x) => x.ok).map((x) => x.n);
  const falhou = resultados.filter((x) => !x.ok).map((x) => x.n);
  [...ok, ...falhou].forEach((n) => estado.selecionados.delete(n));
  $('dlg-reserva').close();
  desenharRifa();
  mostrarResultado(r, ok, falhou, nome, telefone);
});

// Mensagem organizada que a pessoa envia junto com o comprovante.
function mensagemWhatsApp({ c, r, pos, ok, nome, telefone, total }) {
  const qtd = ok.length;
  return [
    `🏡 *${c.titulo}*`,
    c.subtitulo ? `_${c.subtitulo}_` : null,
    '',
    'Olá! Acabei de reservar meus números 🍀',
    '',
    `👤 *Nome:* ${nome}`,
    `📱 *WhatsApp:* ${formatarTelefone(telefone)}`,
    `🎟️ *${pos}*`,
    `🔢 *${qtd === 1 ? 'Número' : 'Números'}:* ${listaNumeros(ok)}`,
    `💰 *Total:* ${total} (${qtd} × ${brl(r.preco)})`,
    '',
    'Segue o comprovante do Pix 👇',
  ].filter((l) => l !== null).join('\n');
}

function mostrarResultado(r, ok, falhou, nome, telefone) {
  const c = estado.config;
  const pos = `Cartela ${estado.rifas.indexOf(r) + 1}/${estado.rifas.length}`;
  if (!ok.length) {
    $('ok-titulo').textContent = 'Não foi possível reservar';
    $('ok-texto').textContent = `Os números ${listaNumeros(falhou)} já foram reservados por outra pessoa. Escolha outros números.`;
    $('ok-pix').hidden = true;
    $('ok-instrucoes').textContent = '';
    $('ok-whats').hidden = true;
  } else {
    const total = brl(ok.length * (Number(r.preco) || 0));
    $('ok-titulo').textContent = 'Reserva feita! 🎉';
    $('ok-texto').innerHTML = `${escapar(nome)}, seus números na <strong>${pos}</strong>: <strong>${listaNumeros(ok)}</strong>. Total: <strong>${total}</strong>.`
      + (falhou.length ? `<br><span class="erro">Os números ${listaNumeros(falhou)} já tinham sido reservados por outra pessoa e não entraram.</span>` : '');
    $('ok-pix').hidden = !c.pix && !c.pixCopiaECola;
    $('ok-pix-rotulo').textContent = c.pixCopiaECola ? 'Pix copia e cola (cole no app do banco)' : 'Chave Pix';
    $('ok-pix-chave').textContent = c.pixCopiaECola || c.pix || '';
    $('ok-instrucoes').textContent = c.instrucoes || '';
    const link = linkWhatsApp(c.whatsapp, mensagemWhatsApp({ c, r, pos, ok, nome, telefone, total }));
    $('ok-whats').hidden = !link;
    if (link) $('ok-whats').href = link;
  }
  $('dlg-ok').showModal();
}

$('btn-fechar-ok').addEventListener('click', () => $('dlg-ok').close());
$('btn-copiar-pix').addEventListener('click', copiarPix);
