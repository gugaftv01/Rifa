// Site público: página inicial, rifas e reserva de números em tempo real.
import { db } from './firebase.js';
import {
  collection, doc, onSnapshot, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import {
  CONFIG_PADRAO, brl, pad, soDigitos, formatarTelefone, linkWhatsApp, escapar, toast,
} from './util.js';

const MAX_SELECAO = 30;
const $ = (id) => document.getElementById(id);

const estado = {
  config: { ...CONFIG_PADRAO },
  rifas: [],
  rifaId: null,
  ocupados: new Set(),       // números indisponíveis da rifa atual
  selecionados: new Set(),   // números escolhidos pelo visitante
  filtro: 'todos',
  busca: '',
  pararNumeros: null,
};

const rifaAtual = () => estado.rifas.find((r) => r.id === estado.rifaId);

/* ---------- Configuração da página inicial ---------- */
onSnapshot(doc(db, 'config/site'), (snap) => {
  estado.config = { ...CONFIG_PADRAO, ...(snap.exists() ? snap.data() : {}) };
  const c = estado.config;
  $('titulo').textContent = c.titulo;
  document.title = c.titulo;
  $('subtitulo').textContent = c.subtitulo;
  $('mensagem').textContent = c.mensagem || '';
  $('mensagem').hidden = !c.mensagem;
  if (c.heroImagem && $('hero-img').getAttribute('src') !== c.heroImagem) $('hero-img').src = c.heroImagem;
  if (c.rodape) $('rodape-texto').textContent = c.rodape;
}, (e) => console.error('config', e));

/* ---------- Galeria ---------- */
onSnapshot(collection(db, 'galeria'), (snap) => {
  const fotos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  $('galeria-secao').hidden = fotos.length === 0;
  $('galeria').innerHTML = fotos
    .map((f) => `<figure><img src="${escapar(f.src)}" alt="${escapar(f.legenda || 'Foto')}" loading="lazy" decoding="async"></figure>`)
    .join('');
}, (e) => console.error('galeria', e));

/* ---------- Lista de rifas ---------- */
onSnapshot(collection(db, 'rifas'), (snap) => {
  estado.rifas = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.ativa !== false)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));

  $('carregando').hidden = estado.rifas.length > 0;
  if (!estado.rifas.length) $('carregando').textContent = 'Nenhuma rifa disponível no momento.';

  const daUrl = location.hash.replace('#', '');
  if (!rifaAtual()) {
    const inicial = estado.rifas.find((r) => r.id === daUrl) || estado.rifas[0];
    if (inicial) selecionarRifa(inicial.id, false);
  }
  desenharAbas();
  desenharRifa();
  desenharResumoHero();
}, (e) => {
  console.error('rifas', e);
  $('carregando').textContent = 'Não foi possível carregar as rifas. Verifique sua conexão.';
});

function desenharResumoHero() {
  const total = estado.rifas.length;
  if (!total) { $('hero-resumo').innerHTML = ''; return; }
  const menor = Math.min(...estado.rifas.map((r) => Number(r.preco) || 0));
  $('hero-resumo').innerHTML = `
    <div><strong>${total}</strong><span>${total === 1 ? 'rifa' : 'rifas'}</span></div>
    <div><strong>${brl(menor)}</strong><span>a partir de</span></div>`;
}

function desenharAbas() {
  $('abas').innerHTML = estado.rifas.map((r) => `
    <button type="button" class="aba ${r.id === estado.rifaId ? 'ativa' : ''}" data-rifa="${escapar(r.id)}" aria-pressed="${r.id === estado.rifaId}">
      <span>${escapar(r.nome)}</span>
      <small>${brl(r.preco)}</small>
    </button>`).join('');
}

$('abas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rifa]');
  if (b && b.dataset.rifa !== estado.rifaId) selecionarRifa(b.dataset.rifa, true);
});

function selecionarRifa(id, mexerUrl) {
  if (estado.selecionados.size && !confirm('Trocar de rifa vai limpar os números selecionados. Continuar?')) return;
  estado.rifaId = id;
  estado.selecionados.clear();
  estado.ocupados = new Set();
  if (mexerUrl) history.replaceState(null, '', `#${id}`);
  if (estado.pararNumeros) estado.pararNumeros();
  $('grade').innerHTML = '<p class="carregando">Carregando números…</p>';
  estado.pararNumeros = onSnapshot(collection(db, 'rifas', id, 'numeros'), (snap) => {
    estado.ocupados = new Set(snap.docs.map((d) => Number(d.id)));
    // Se alguém reservou um número que eu tinha selecionado, ele sai da minha seleção.
    const perdidos = [...estado.selecionados].filter((n) => estado.ocupados.has(n));
    perdidos.forEach((n) => estado.selecionados.delete(n));
    if (perdidos.length) toast(`O número ${perdidos.join(', ')} acabou de ser reservado por outra pessoa.`, 'aviso');
    desenharRifa();
  }, (e) => console.error('numeros', e));
  desenharAbas();
  desenharRifa();
}

/* ---------- Rifa selecionada e grade de números ---------- */
function desenharRifa() {
  const r = rifaAtual();
  $('rifa-card').hidden = !r;
  if (!r) return;
  const total = Number(r.totalNumeros) || 0;
  const ocupados = [...estado.ocupados].filter((n) => n >= 1 && n <= total).length;
  const livres = total - ocupados;

  $('rifa-nome').textContent = r.nome;
  $('rifa-premio').textContent = r.premio ? `Prêmio: ${r.premio}` : '';
  $('rifa-desc').textContent = r.descricao || '';
  $('rifa-preco').textContent = brl(r.preco);
  $('rifa-data').textContent = r.dataSorteio ? new Date(`${r.dataSorteio}T12:00:00`).toLocaleDateString('pt-BR') : 'A definir';
  $('rifa-disp').textContent = `${livres} de ${total}`;
  $('rifa-barra').style.width = `${total ? (ocupados / total) * 100 : 0}%`;
  $('rifa-progresso').textContent = `${ocupados} vendidos/reservados · ${total ? Math.round((ocupados / total) * 100) : 0}%`;
  if (r.imagem) { $('rifa-img').src = r.imagem; $('rifa-img').alt = r.premio || r.nome; $('rifa-img').hidden = false; }
  else $('rifa-img').hidden = true;

  desenharGrade(r);
  desenharCarrinho();
}

function desenharGrade(r) {
  const total = Number(r.totalNumeros) || 0;
  const busca = estado.busca;
  const partes = [];
  for (let n = 1; n <= total; n++) {
    const ocupado = estado.ocupados.has(n);
    if (estado.filtro === 'livres' && ocupado) continue;
    if (estado.filtro === 'ocupados' && !ocupado) continue;
    const rotulo = pad(n, total);
    if (busca && !rotulo.includes(busca) && String(n) !== busca) continue;
    const sel = estado.selecionados.has(n);
    const classe = ocupado ? 'num ocupado' : sel ? 'num meu' : 'num livre';
    const aria = ocupado ? 'indisponível' : sel ? 'selecionado' : 'disponível';
    partes.push(`<button type="button" class="${classe}" data-n="${n}" ${ocupado ? 'disabled' : ''} aria-pressed="${sel}" aria-label="Número ${rotulo}, ${aria}">${rotulo}</button>`);
  }
  $('grade').innerHTML = partes.join('');
  $('grade-vazia').hidden = partes.length > 0;
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
  desenharCarrinho();
});

document.querySelector('.segmentado').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filtro]');
  if (!b) return;
  estado.filtro = b.dataset.filtro;
  document.querySelectorAll('[data-filtro]').forEach((x) => x.classList.toggle('ativo', x === b));
  const r = rifaAtual();
  if (r) desenharGrade(r);
});

$('busca').addEventListener('input', (e) => {
  estado.busca = soDigitos(e.target.value);
  const r = rifaAtual();
  if (r) desenharGrade(r);
});

/* ---------- Carrinho ---------- */
function desenharCarrinho() {
  const r = rifaAtual();
  const nums = [...estado.selecionados].sort((a, b) => a - b);
  $('carrinho').hidden = !nums.length || !r;
  document.body.classList.toggle('com-carrinho', nums.length > 0);
  if (!nums.length || !r) return;
  $('carrinho-qtd').textContent = `${nums.length} ${nums.length === 1 ? 'número' : 'números'}`;
  $('carrinho-total').textContent = ` · ${brl(nums.length * (Number(r.preco) || 0))}`;
  $('carrinho-nums').textContent = nums.map((n) => pad(n, r.totalNumeros)).join(', ');
}

$('btn-limpar').addEventListener('click', () => {
  estado.selecionados.clear();
  desenharRifa();
});

/* ---------- Reserva ---------- */
$('btn-reservar').addEventListener('click', () => {
  const r = rifaAtual();
  const nums = [...estado.selecionados].sort((a, b) => a - b);
  $('dlg-resumo').innerHTML = `<strong>${escapar(r.nome)}</strong><br>Números: ${nums.map((n) => pad(n, r.totalNumeros)).join(', ')}<br>Total: <strong>${brl(nums.length * (Number(r.preco) || 0))}</strong>`;
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
  ok.forEach((n) => estado.selecionados.delete(n));
  falhou.forEach((n) => estado.selecionados.delete(n));
  $('dlg-reserva').close();
  desenharRifa();
  mostrarResultado(r, ok, falhou, nome);
});

function mostrarResultado(r, ok, falhou, nome) {
  const c = estado.config;
  const fmt = (l) => l.map((n) => pad(n, r.totalNumeros)).join(', ');
  if (!ok.length) {
    $('ok-titulo').textContent = 'Não foi possível reservar';
    $('ok-texto').textContent = `Os números ${fmt(falhou)} já foram reservados por outra pessoa. Escolha outros números.`;
    $('ok-pix').hidden = true;
    $('ok-instrucoes').textContent = '';
    $('ok-whats').hidden = true;
  } else {
    const total = brl(ok.length * (Number(r.preco) || 0));
    $('ok-titulo').textContent = 'Reserva feita! 🎉';
    $('ok-texto').innerHTML = `${escapar(nome)}, seus números na <strong>${escapar(r.nome)}</strong>: <strong>${fmt(ok)}</strong>. Total: <strong>${total}</strong>.`
      + (falhou.length ? `<br><span class="erro">Os números ${fmt(falhou)} já tinham sido reservados por outra pessoa e não entraram.</span>` : '');
    $('ok-pix').hidden = !c.pix;
    $('ok-pix-chave').textContent = c.pix || '';
    $('ok-instrucoes').textContent = c.instrucoes || '';
    const link = linkWhatsApp(c.whatsapp, `Olá! Sou ${nome} e reservei os números ${fmt(ok)} da ${r.nome} (total ${total}). Segue o comprovante:`);
    $('ok-whats').hidden = !link;
    if (link) $('ok-whats').href = link;
  }
  $('dlg-ok').showModal();
}

$('btn-fechar-ok').addEventListener('click', () => $('dlg-ok').close());
$('btn-copiar-pix').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(estado.config.pix); toast('Chave PIX copiada!'); }
  catch { toast('Não foi possível copiar. Selecione a chave manualmente.', 'aviso'); }
});
