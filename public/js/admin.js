// Painel ADM. Todas as operações aqui são validadas também pelas regras do
// Firestore: só funcionam para usuários logados que estão na coleção /admins.
import { app, db } from './firebase.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword, connectAuthEmulator,
} from '/vendor/firebase/13.4.0/firebase-auth.js';
import {
  collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc,
  writeBatch, serverTimestamp, query, where, deleteField, orderBy, limit,
} from '/vendor/firebase/13.4.0/firebase-firestore.js';
import {
  CONFIG_PADRAO, brl, faixa, soDigitos, formatarTelefone, linkWhatsApp, escapar, toast, prepararImagem,
} from './util.js';

const auth = getAuth(app);
if (new URLSearchParams(location.search).has('emulador')) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

const $ = (id) => document.getElementById(id);
const estado = {
  rifas: [],
  reservas: [],     // todas as reservas (dados privados)
  config: { ...CONFIG_PADRAO },
  numRifa: null,
  numFiltro: 'todos',
  acessos: [],
  tentativas: [],
  parar: [],
};

/* ================= Autenticação ================= */
auth.languageCode = 'pt-BR';
const LIMITE_INATIVO = 12 * 60 * 60 * 1000; // 12 horas sem usar o painel = sai sozinho
let entrouAgora = false;

function mostrar(tela) {
  $('tela-carregando').hidden = tela !== 'carregando';
  $('tela-login').hidden = tela !== 'login';
  $('tela-painel').hidden = tela !== 'painel';
}

// Descrição curta do aparelho (ex.: "Android · Chrome"), para o registro de segurança.
function aparelho() {
  const ua = navigator.userAgent;
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Outro';
  const nav = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Navegador';
  return `${so} · ${nav}`.slice(0, 100);
}

const lerUltimoUso = () => { try { return Number(localStorage.getItem('adm-ultimo-uso')) || 0; } catch { return 0; } };
function marcarUso() { try { localStorage.setItem('adm-ultimo-uso', String(Date.now())); } catch { /* ok */ } }
let ultimaMarca = 0;
['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => {
  if (auth.currentUser && Date.now() - ultimaMarca > 60_000) { ultimaMarca = Date.now(); marcarUso(); }
}, { passive: true }));
setInterval(() => {
  if (auth.currentUser && Date.now() - lerUltimoUso() > LIMITE_INATIVO) sairPorInatividade();
}, 60_000);
async function sairPorInatividade() {
  await signOut(auth);
  $('login-erro').textContent = 'Por segurança, você saiu depois de 12 horas sem usar o painel. Entre de novo.';
}

onAuthStateChanged(auth, async (user) => {
  pararOuvintes();
  if (!user) { mostrar('login'); return; }
  if (!entrouAgora && lerUltimoUso() && Date.now() - lerUltimoUso() > LIMITE_INATIVO) { await sairPorInatividade(); return; }
  mostrar('carregando');
  let ehAdmin = false;
  try { ehAdmin = (await getDoc(doc(db, 'admins', user.uid))).exists(); } catch { ehAdmin = false; }
  if (!ehAdmin) {
    await signOut(auth);
    mostrar('login');
    $('login-erro').textContent = 'Esta conta não tem permissão de administrador.';
    return;
  }
  marcarUso();
  if (entrouAgora) {
    entrouAgora = false;
    addDoc(collection(db, 'acessos'), { uid: user.uid, aparelho: aparelho(), quando: serverTimestamp() }).catch(() => {});
  }
  $('conta-email').textContent = user.email;
  mostrar('painel');
  iniciarOuvintes();
});

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-erro').textContent = '';
  $('login-info').textContent = '';
  const btn = $('btn-entrar');
  const email = $('login-email').value.trim();
  btn.disabled = true;
  try {
    entrouAgora = true;
    await signInWithEmailAndPassword(auth, email, $('login-senha').value);
    $('login-senha').value = '';
  } catch (err) {
    entrouAgora = false;
    // Registra a tentativa errada (só o ADM consegue ler esse registro).
    addDoc(collection(db, 'tentativas'), { email: email.slice(0, 100), aparelho: aparelho(), quando: serverTimestamp() }).catch(() => {});
    $('login-erro').textContent = err.code === 'auth/too-many-requests'
      ? 'Muitas tentativas. Aguarde alguns minutos.'
      : 'E-mail ou senha incorretos.';
  } finally { btn.disabled = false; }
});

// Esqueci a senha: a mensagem é sempre a mesma, para não revelar se o e-mail tem conta.
$('btn-esqueci').addEventListener('click', async () => {
  $('login-erro').textContent = '';
  const email = $('login-email').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('login-erro').textContent = 'Digite seu e-mail no campo acima e toque de novo.'; return; }
  try { await sendPasswordResetEmail(auth, email); } catch (err) {
    if (err.code === 'auth/too-many-requests') { $('login-erro').textContent = 'Muitas tentativas. Aguarde alguns minutos.'; return; }
  }
  $('login-info').textContent = 'Se esse e-mail tiver acesso, você vai receber um link para criar uma nova senha. Veja também o spam.';
});

$('btn-sair').addEventListener('click', () => signOut(auth));

// Senha forte: pelo menos 8 caracteres, com letra minúscula e número.
function senhaFraca(s) {
  if (s.length < 8) return 'A nova senha precisa ter pelo menos 8 caracteres.';
  if (!/[a-z]/.test(s)) return 'A nova senha precisa ter pelo menos uma letra minúscula.';
  if (!/[0-9]/.test(s)) return 'A nova senha precisa ter pelo menos um número.';
  return '';
}

$('form-senha').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('senha-erro').textContent = '';
  const nova = $('senha-nova').value;
  const problema = senhaFraca(nova);
  if (problema) { $('senha-erro').textContent = problema; return; }
  try {
    const cred = EmailAuthProvider.credential(auth.currentUser.email, $('senha-atual').value);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, nova);
    e.target.reset();
    toast('Senha alterada com sucesso!');
  } catch (err) {
    $('senha-erro').textContent = err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'
      ? 'Senha atual incorreta.'
      : err.code === 'auth/password-does-not-meet-requirements' ? 'A senha não atende às regras de segurança.'
        : `Não foi possível alterar: ${err.code || err.message}`;
  }
});

/* ================= Dados em tempo real ================= */
function iniciarOuvintes() {
  const erro = (e) => { console.error(e); toast('Erro ao carregar dados: ' + (e.code || e.message), 'erro'); };
  estado.parar.push(onSnapshot(collection(db, 'rifas'), (s) => {
    estado.rifas = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    if (!estado.rifas.some((r) => r.id === estado.numRifa)) estado.numRifa = estado.rifas[0]?.id || null;
    redesenhar();
  }, erro));
  estado.parar.push(onSnapshot(collection(db, 'reservas'), (s) => {
    estado.reservas = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    redesenhar();
  }, erro));
  estado.parar.push(onSnapshot(query(collection(db, 'acessos'), orderBy('quando', 'desc'), limit(20)), (s) => {
    estado.acessos = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    desenharSeguranca();
  }, erro));
  estado.parar.push(onSnapshot(query(collection(db, 'tentativas'), orderBy('quando', 'desc'), limit(50)), (s) => {
    estado.tentativas = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    desenharSeguranca();
  }, erro));
  estado.parar.push(onSnapshot(doc(db, 'config/site'), (s) => {
    estado.config = { ...CONFIG_PADRAO, ...(s.exists() ? s.data() : {}) };
    desenharPagina();
  }, erro));
}

function pararOuvintes() {
  estado.parar.forEach((f) => f());
  estado.parar = [];
}

function redesenhar() {
  desenharResumo();
  desenharSelects();
  desenharNumeros();
  desenharReservas();
  desenharRifas();
}

const rifaPorId = (id) => estado.rifas.find((r) => r.id === id);
const reservasDa = (rifaId) => estado.reservas.filter((r) => r.rifaId === rifaId);

/* ================= Navegação ================= */
$('adm-abas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-secao]');
  if (!b) return;
  document.querySelectorAll('#adm-abas button').forEach((x) => x.classList.toggle('ativa', x === b));
  document.querySelectorAll('[data-painel]').forEach((s) => { s.hidden = s.dataset.painel !== b.dataset.secao; });
});

function irPara(secao) {
  document.querySelector(`#adm-abas [data-secao="${secao}"]`).click();
}

/* ================= Resumo ================= */
function estatisticas(r) {
  const { ini, fim } = faixa(r);
  const res = reservasDa(r.id).filter((x) => x.numero >= ini && x.numero <= fim);
  const vendidos = res.filter((x) => x.status === 'vendido').length;
  const reservados = res.filter((x) => x.status !== 'vendido').length;
  const preco = Number(r.preco) || 0;
  return {
    vendidos, reservados, livres: r.totalNumeros - vendidos - reservados,
    arrecadado: vendidos * preco, aReceber: reservados * preco,
  };
}

function desenharResumo() {
  let tv = 0, tr = 0, ta = 0, tar = 0;
  $('resumo-tabela').innerHTML = estado.rifas.map((r) => {
    const s = estatisticas(r);
    tv += s.vendidos; tr += s.reservados; ta += s.arrecadado; tar += s.aReceber;
    return `<tr>
      <td><strong>${escapar(r.nome)}</strong>${r.ativa === false ? ' <span class="etiqueta vendido">oculta</span>' : ''}</td>
      <td>${s.vendidos}</td><td>${s.reservados}</td><td>${s.livres} / ${r.totalNumeros}</td>
      <td>${brl(s.arrecadado)}</td><td>${brl(s.aReceber)}</td></tr>`;
  }).join('') || '<tr><td colspan="6">Nenhuma rifa cadastrada.</td></tr>';
  $('resumo-geral').innerHTML = `
    <div><span>Rifas</span><strong>${estado.rifas.length}</strong></div>
    <div><span>Números vendidos</span><strong>${tv}</strong></div>
    <div><span>Reservados</span><strong>${tr}</strong></div>
    <div><span>Arrecadado</span><strong>${brl(ta)}</strong></div>
    <div><span>A receber</span><strong>${brl(tar)}</strong></div>`;
}

function desenharSelects() {
  const opcoes = estado.rifas.map((r) => `<option value="${escapar(r.id)}">${escapar(r.nome)}</option>`).join('');
  $('num-rifa').innerHTML = opcoes;
  if (estado.numRifa) $('num-rifa').value = estado.numRifa;
  const atual = $('res-rifa').value;
  $('res-rifa').innerHTML = '<option value="">Todas as cartelas</option>' + opcoes;
  $('res-rifa').value = rifaPorId(atual) ? atual : '';
}

/* ================= Números ================= */
$('num-rifa').addEventListener('change', (e) => { estado.numRifa = e.target.value; lote.nums.clear(); desenharLote(); desenharNumeros(); });
document.querySelector('[data-painel="numeros"] .segmentado').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nfiltro]');
  if (!b) return;
  estado.numFiltro = b.dataset.nfiltro;
  document.querySelectorAll('[data-nfiltro]').forEach((x) => x.classList.toggle('ativo', x === b));
  desenharNumeros();
});

function desenharNumeros() {
  const r = rifaPorId(estado.numRifa);
  if (!r) { $('num-grade').innerHTML = '<p class="vazio">Crie uma rifa primeiro.</p>'; return; }
  const mapa = new Map(reservasDa(r.id).map((x) => [x.numero, x]));
  const partes = [];
  const { ini, fim } = faixa(r);
  for (let n = ini; n <= fim; n++) {
    const res = mapa.get(n);
    const st = res ? (res.status === 'vendido' ? 'vendido' : 'reservado') : 'livres';
    if (estado.numFiltro !== 'todos' && estado.numFiltro !== st) continue;
    const classe = st === 'vendido' ? 'ocupado' : st === 'reservado' ? 'reservado' : lote.nums.has(n) ? 'sel' : 'livre';
    const titulo = res ? `${res.nome} · ${formatarTelefone(res.telefone)}` : 'Disponível';
    partes.push(`<button type="button" class="num ${classe}" data-n="${n}" title="${escapar(titulo)}">${n}</button>`);
  }
  $('num-grade').innerHTML = partes.join('') || '<p class="vazio">Nenhum número neste filtro.</p>';
}

$('num-grade').addEventListener('click', (e) => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  const n = Number(b.dataset.n);
  if (lote.ativo) {
    const ocupado = estado.reservas.some((x) => x.rifaId === estado.numRifa && x.numero === n);
    if (ocupado) { toast('Esse número já está reservado ou vendido.', 'aviso'); return; }
    if (lote.nums.has(n)) lote.nums.delete(n); else lote.nums.add(n);
    b.className = `num ${lote.nums.has(n) ? 'sel' : 'livre'}`;
    desenharLote();
    return;
  }
  abrirNumero(estado.numRifa, n);
});

/* ---------- Venda rápida: vários números para a mesma pessoa ---------- */
const lote = { ativo: false, nums: new Set() };
function desenharLote() {
  const nums = [...lote.nums].sort((a, b) => a - b);
  const r = rifaPorId(estado.numRifa);
  $('lote').hidden = !lote.ativo;
  $('btn-lote').hidden = lote.ativo;
  $('num-dica').textContent = lote.ativo ? 'Venda rápida: toque nos números livres que a pessoa comprou.' : 'Toque em um número para vender, reservar, confirmar pagamento ou liberar.';
  $('lote-qtd').textContent = nums.length ? `${nums.length} ${nums.length === 1 ? 'número' : 'números'} · ${brl(nums.length * (Number(r?.preco) || 0))}` : 'Toque nos números livres para selecionar';
  $('lote-nums').textContent = nums.length ? `(${nums.join(', ')})` : '';
}
function fecharLote() {
  lote.ativo = false; lote.nums.clear();
  $('lote').reset(); $('lote-erro').textContent = '';
  desenharLote(); desenharNumeros();
}
$('btn-lote').addEventListener('click', () => {
  lote.ativo = true;
  if (estado.numFiltro !== 'todos') document.querySelector('[data-nfiltro="todos"]').click();
  desenharLote();
  $('lote-nome').focus();
});
$('lote-cancelar').addEventListener('click', fecharLote);
$('lote-tel').addEventListener('input', (e) => { const d = soDigitos(e.target.value).slice(0, 11); e.target.value = d.length > 2 ? formatarTelefone(d) || d : d; });
$('lote').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-lote]');
  if (!b) return;
  const nums = [...lote.nums];
  const nome = $('lote-nome').value.trim();
  const telefone = soDigitos($('lote-tel').value);
  if (!nums.length) { $('lote-erro').textContent = 'Selecione pelo menos um número.'; return; }
  if (nome.length < 2) { $('lote-erro').textContent = 'Informe o nome do comprador.'; return; }
  b.disabled = true;
  try {
    await registrarNumeros(estado.numRifa, nums, b.dataset.lote, nome, telefone);
    toast(`${nums.length} ${nums.length === 1 ? 'número salvo' : 'números salvos'} para ${nome}!`);
    fecharLote();
  } catch (err) {
    $('lote-erro').textContent = err.code === 'permission-denied' ? 'Algum número já foi pego por outra pessoa. Confira e tente de novo.' : `Erro: ${err.message}`;
  } finally { b.disabled = false; }
});

// Grava vários números de uma vez (tudo ou nada).
async function registrarNumeros(rifaId, nums, status, nome, telefone) {
  const batch = writeBatch(db);
  for (const n of nums) {
    const reservaId = `${rifaId}_${n}`;
    const dados = { rifaId, numero: n, nome, telefone, status, criadoEm: serverTimestamp(), origem: 'adm' };
    if (status === 'vendido') dados.pagoEm = serverTimestamp();
    batch.set(doc(db, 'rifas', rifaId, 'numeros', String(n)), { status, reservaId, criadoEm: serverTimestamp() });
    batch.set(doc(db, 'reservas', reservaId), dados);
  }
  await batch.commit();
}

let numAtual = null;
function abrirNumero(rifaId, n) {
  const r = rifaPorId(rifaId);
  const res = estado.reservas.find((x) => x.rifaId === rifaId && x.numero === n);
  numAtual = { rifaId, n };
  $('dn-titulo').textContent = `${r.nome} · Número ${n}`;
  $('dn-erro').textContent = '';
  $('dn-nome').value = res?.nome || '';
  $('dn-tel').value = res ? formatarTelefone(res.telefone) : '';
  const acoes = [];
  if (!res) {
    $('dn-info').textContent = 'Número disponível. Preencha os dados do comprador para registrar.';
    acoes.push('<button type="button" class="btn btn-sec" data-acao="fechar">Cancelar</button>');
    acoes.push('<button type="button" class="btn btn-laranja" data-acao="reservar">Reservar</button>');
    acoes.push('<button type="button" class="btn btn-verde" data-acao="vender">Marcar como vendido</button>');
  } else {
    const st = res.status === 'vendido' ? 'Vendido (pago)' : 'Reservado (aguardando pagamento)';
    const data = res.criadoEm?.toDate ? res.criadoEm.toDate().toLocaleString('pt-BR') : '';
    $('dn-info').innerHTML = `<strong>${st}</strong><br>${escapar(res.nome)} · ${escapar(formatarTelefone(res.telefone))}${data ? `<br><small>${data}</small>` : ''}`;
    acoes.push('<button type="button" class="btn btn-perigo" data-acao="liberar">Liberar número</button>');
    acoes.push('<button type="button" class="btn btn-sec" data-acao="salvar">Salvar dados</button>');
    if (res.status === 'vendido') acoes.push('<button type="button" class="btn btn-laranja" data-acao="desfazer">Voltar p/ reservado</button>');
    else acoes.push('<button type="button" class="btn btn-verde" data-acao="vender">Confirmar pagamento</button>');
  }
  $('dn-acoes').innerHTML = acoes.join('');
  $('dlg-num').showModal();
}

$('dn-acoes').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acao]');
  if (!b) return;
  const acao = b.dataset.acao;
  if (acao === 'fechar') { $('dlg-num').close(); return; }
  const { rifaId, n } = numAtual;
  const nome = $('dn-nome').value.trim();
  const telefone = soDigitos($('dn-tel').value);
  const existe = estado.reservas.some((x) => x.rifaId === rifaId && x.numero === n);
  if ((!existe || acao === 'salvar') && nome.length < 2) { $('dn-erro').textContent = 'Informe o nome do comprador.'; return; }
  if (acao === 'liberar' && !confirm('Liberar este número? Ele volta a ficar disponível no site e os dados do comprador serão apagados.')) return;
  b.disabled = true;
  try {
    await executarAcao(acao, rifaId, n, { nome, telefone, existe });
    $('dlg-num').close();
    toast('Pronto!');
  } catch (err) {
    console.error(err);
    $('dn-erro').textContent = err.code === 'permission-denied' ? 'Sem permissão.' : `Erro: ${err.message}`;
  } finally { b.disabled = false; }
});

async function executarAcao(acao, rifaId, n, { nome, telefone, existe } = {}) {
  const reservaId = `${rifaId}_${n}`;
  const refNum = doc(db, 'rifas', rifaId, 'numeros', String(n));
  const refRes = doc(db, 'reservas', reservaId);
  const batch = writeBatch(db);
  if (acao === 'liberar') {
    batch.delete(refNum);
    batch.delete(refRes);
  } else if (acao === 'salvar') {
    batch.update(refRes, { nome, telefone });
  } else {
    const status = acao === 'vender' ? 'vendido' : 'reservado';
    if (!existe) {
      batch.set(refNum, { status, reservaId, criadoEm: serverTimestamp() });
      batch.set(refRes, { rifaId, numero: n, nome, telefone, status, criadoEm: serverTimestamp(), origem: 'adm' });
    } else {
      batch.update(refNum, { status });
      const dados = { status };
      if (nome) dados.nome = nome;
      if (telefone) dados.telefone = telefone;
      dados.pagoEm = status === 'vendido' ? serverTimestamp() : deleteField();
      batch.update(refRes, dados);
    }
  }
  await batch.commit();
}

/* ================= Reservas (agrupadas por comprador) ================= */
['res-rifa', 'res-status', 'res-busca'].forEach((id) => $(id).addEventListener('input', desenharReservas));

// Junta as reservas da mesma pessoa (mesmo telefone e nome) na mesma cartela.
function pedidos() {
  const grupos = new Map();
  for (const x of estado.reservas) {
    const chave = `${x.rifaId}|${x.telefone || ''}|${(x.nome || '').trim().toLowerCase()}`;
    if (!grupos.has(chave)) grupos.set(chave, { chave, rifaId: x.rifaId, nome: x.nome, telefone: x.telefone, itens: [] });
    grupos.get(chave).itens.push(x);
  }
  return [...grupos.values()].map((g) => {
    g.itens.sort((a, b) => a.numero - b.numero);
    g.pendentes = g.itens.filter((x) => x.status !== 'vendido');
    g.situacao = !g.pendentes.length ? 'pago' : g.pendentes.length === g.itens.length ? 'pendente' : 'parcial';
    g.data = Math.max(...g.itens.map((x) => x.criadoEm?.toMillis?.() ?? 0));
    return g;
  });
}

function pedidosFiltrados() {
  const rifa = $('res-rifa').value;
  const st = $('res-status').value;
  const busca = $('res-busca').value.trim().toLowerCase();
  const buscaDig = soDigitos(busca);
  return pedidos()
    .filter((g) => !rifa || g.rifaId === rifa)
    .filter((g) => !st || (st === 'pago' ? g.situacao === 'pago' : g.situacao !== 'pago'))
    .filter((g) => !busca || g.nome?.toLowerCase().includes(busca)
      || (buscaDig && (g.telefone?.includes(buscaDig) || g.itens.some((x) => String(x.numero) === buscaDig))))
    .sort((a, b) => (a.situacao === 'pago') - (b.situacao === 'pago') || b.data - a.data);
}

function desenharReservas() {
  const todos = pedidos();
  const aguardando = todos.filter((g) => g.situacao !== 'pago');
  const valorPend = aguardando.reduce((t, g) => t + g.pendentes.length * (Number(rifaPorId(g.rifaId)?.preco) || 0), 0);
  $('res-totais').innerHTML = `
    <div><span>Aguardando pagamento</span><strong>${aguardando.length}</strong></div>
    <div><span>Valor a receber</span><strong>${brl(valorPend)}</strong></div>
    <div><span>Compradores pagos</span><strong>${todos.length - aguardando.length}</strong></div>`;
  const lista = pedidosFiltrados();
  $('res-vazio').hidden = lista.length > 0;
  $('res-lista').innerHTML = lista.map((g) => {
    const r = rifaPorId(g.rifaId);
    const pos = estado.rifas.indexOf(r) + 1;
    const preco = Number(r?.preco) || 0;
    const nums = g.itens.map((x) => x.numero).join(', ');
    const etiqueta = { pago: 'Pago', pendente: 'Aguardando pagamento', parcial: 'Pago em parte' }[g.situacao];
    const quando = g.data ? new Date(g.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const valorPendente = g.pendentes.length * preco;
    const cobrar = linkWhatsApp(g.telefone, `Olá ${g.nome}! Tudo bem? 😊\nSua reserva na *Cartela ${pos}* da Chá Rifa: números *${g.pendentes.map((x) => x.numero).join(', ')}*.\nTotal: *${brl(valorPendente)}*.\nAssim que fizer o Pix, me manda o comprovante, por favor. Obrigado! 🏡`);
    const agradecer = linkWhatsApp(g.telefone, `Olá ${g.nome}! Recebemos seu pagamento 🎉\nSeus números na *Cartela ${pos}*: *${nums}*.\nMuito obrigado e boa sorte! 🍀🏡`);
    return `<article class="pedido ${g.situacao}">
      <div class="pedido-topo">
        <div>
          <h3>${escapar(g.nome)}</h3>
          <p class="sub">${g.telefone ? `<a href="${linkWhatsApp(g.telefone, '')}" target="_blank" rel="noopener">${escapar(formatarTelefone(g.telefone))}</a> · ` : ''}Cartela ${pos || '?'} · ${quando}</p>
        </div>
        <span class="etiqueta ${g.situacao === 'pendente' ? 'reservado' : g.situacao}">${etiqueta}</span>
      </div>
      <div class="chips">${g.itens.map((x) => `<button type="button" class="chip ${x.status === 'vendido' ? 'pago' : ''}" data-abrir="${escapar(x.rifaId)}" data-n="${x.numero}" title="Detalhes do número ${x.numero}">${x.numero}</button>`).join('')}</div>
      <div class="pedido-total">${g.itens.length} ${g.itens.length === 1 ? 'número' : 'números'} · ${brl(g.itens.length * preco)}${g.situacao === 'parcial' ? ` <small>(falta ${brl(valorPendente)})</small>` : ''}</div>
      <div class="pedido-acoes">
        ${g.situacao !== 'pago' ? `<button type="button" class="btn btn-verde btn-peq" data-pagar="${escapar(g.chave)}">✅ Confirmar pagamento (${brl(valorPendente)})</button>` : ''}
        ${g.telefone && g.situacao !== 'pago' && cobrar ? `<a class="btn btn-whats btn-peq" href="${cobrar}" target="_blank" rel="noopener">Cobrar no WhatsApp</a>` : ''}
        ${g.telefone && g.situacao === 'pago' && agradecer ? `<a class="btn btn-whats btn-peq" href="${agradecer}" target="_blank" rel="noopener">Enviar confirmação</a>` : ''}
        <button type="button" class="btn btn-sec btn-peq" data-liberar="${escapar(g.chave)}">Liberar tudo</button>
      </div>
    </article>`;
  }).join('');
}

$('res-lista').addEventListener('click', async (e) => {
  const abrir = e.target.closest('[data-abrir]');
  if (abrir) { abrirNumero(abrir.dataset.abrir, Number(abrir.dataset.n)); return; }
  const pagar = e.target.closest('[data-pagar]');
  const liberar = e.target.closest('[data-liberar]');
  const b = pagar || liberar;
  if (!b) return;
  const g = pedidos().find((x) => x.chave === b.dataset.pagar || x.chave === b.dataset.liberar);
  if (!g) return;
  if (liberar && !confirm(`Liberar os números ${g.itens.map((x) => x.numero).join(', ')} de ${g.nome}? Eles voltam a ficar disponíveis no site.`)) return;
  b.disabled = true;
  try {
    const batch = writeBatch(db);
    const itens = pagar ? g.pendentes : g.itens;
    for (const x of itens) {
      const refNum = doc(db, 'rifas', x.rifaId, 'numeros', String(x.numero));
      const refRes = doc(db, 'reservas', x.id);
      if (pagar) {
        batch.update(refNum, { status: 'vendido' });
        batch.update(refRes, { status: 'vendido', pagoEm: serverTimestamp() });
      } else {
        batch.delete(refNum);
        batch.delete(refRes);
      }
    }
    await batch.commit();
    toast(pagar ? `Pagamento de ${g.nome} confirmado! ${itens.length} ${itens.length === 1 ? 'número pago' : 'números pagos'}.` : 'Números liberados.');
  } catch (err) { toast('Erro: ' + err.message, 'erro'); b.disabled = false; }
});

$('btn-csv').addEventListener('click', () => {
  const linhas = [['Cartela', 'Número', 'Nome', 'WhatsApp', 'Situação', 'Valor', 'Reservado em', 'Pago em']];
  const quando = (t) => (t?.toDate ? t.toDate().toLocaleString('pt-BR') : '');
  const filtros = new Set(pedidosFiltrados().map((g) => g.chave));
  pedidos().filter((g) => filtros.has(g.chave)).forEach((g) => g.itens.forEach((x) => {
    const r = rifaPorId(x.rifaId);
    linhas.push([`Cartela ${estado.rifas.indexOf(r) + 1}`, x.numero, x.nome, formatarTelefone(x.telefone),
      x.status === 'vendido' ? 'Pago' : 'Aguardando pagamento', brl(r?.preco), quando(x.criadoEm), quando(x.pagoEm)]);
  }));
  const csv = linhas.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `reservas-e-pagamentos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ================= Rifas ================= */
function desenharRifas() {
  $('lista-rifas').innerHTML = estado.rifas.map((r) => {
    const s = estatisticas(r);
    return `<article class="rifa-adm">
      <h3>${escapar(r.nome)}</h3>
      ${r.ativa === false ? '<p class="inativa">Oculta no site</p>' : ''}
      <p class="premio">${escapar(r.premio || 'Prêmios não definidos')}</p>
      <p>${r.totalNumeros} números (${faixa(r).ini} a ${faixa(r).fim}) · ${brl(r.preco)} cada</p>
      <p>${s.vendidos} vendidos · ${s.reservados} reservados · ${s.livres} livres</p>
      <div class="rifa-adm-acoes">
        <button class="btn btn-peq" data-editar="${escapar(r.id)}">Editar</button>
        <button class="btn btn-sec btn-peq" data-ver="${escapar(r.id)}">Ver números</button>
      </div></article>`;
  }).join('') || '<p class="vazio">Nenhuma rifa ainda. Clique em “+ Nova rifa”.</p>';
}

$('lista-rifas').addEventListener('click', (e) => {
  const ed = e.target.closest('[data-editar]');
  const ver = e.target.closest('[data-ver]');
  if (ed) abrirRifa(ed.dataset.editar);
  if (ver) { estado.numRifa = ver.dataset.ver; desenharSelects(); desenharNumeros(); irPara('numeros'); }
});

$('btn-nova-rifa').addEventListener('click', () => abrirRifa(null));
$('dr-cancelar').addEventListener('click', () => $('dlg-rifa').close());

let rifaEditando = null;
let rifaImagem = '';
function abrirRifa(id) {
  rifaEditando = id;
  const r = id ? rifaPorId(id) : {
    nome: `Rifa ${estado.rifas.length + 1}`, premio: '', preco: 25, totalNumeros: 100,
    inicio: Math.max(0, ...estado.rifas.map((x) => faixa(x).fim)) + 1,
    dataSorteio: '', ordem: (Math.max(0, ...estado.rifas.map((x) => x.ordem || 0)) + 1), ativa: true, imagem: '',
  };
  const f = $('form-rifa');
  ['nome', 'premio', 'preco', 'totalNumeros', 'dataSorteio', 'ordem'].forEach((k) => { f.elements[k].value = r[k] ?? ''; });
  f.elements.inicio.value = faixa(r).ini;
  f.elements.ativa.checked = r.ativa !== false;
  rifaImagem = r.imagem || '';
  mostrarImagemRifa();
  $('dr-titulo').textContent = id ? 'Editar rifa' : 'Nova rifa';
  $('dr-excluir').hidden = !id;
  $('dr-erro').textContent = '';
  $('dlg-rifa').showModal();
}

function mostrarImagemRifa() {
  $('dr-img-prev').hidden = !rifaImagem;
  if (rifaImagem) $('dr-img-prev').src = rifaImagem;
  $('dr-img-remover').hidden = !rifaImagem;
}

$('dr-img-arq').addEventListener('change', async (e) => {
  const arq = e.target.files[0];
  e.target.value = '';
  if (!arq) return;
  try { rifaImagem = await prepararImagem(arq, 1000, 350_000); mostrarImagemRifa(); }
  catch (err) { $('dr-erro').textContent = err.message; }
});
$('dr-img-remover').addEventListener('click', () => { rifaImagem = ''; mostrarImagemRifa(); });

$('form-rifa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const dados = {
    nome: f.elements.nome.value.trim(),
    premio: f.elements.premio.value.trim(),
    preco: Math.round(Number(f.elements.preco.value) * 100) / 100,
    totalNumeros: Math.floor(Number(f.elements.totalNumeros.value)),
    inicio: Math.floor(Number(f.elements.inicio.value)),
    dataSorteio: f.elements.dataSorteio.value,
    ordem: Number(f.elements.ordem.value) || 0,
    ativa: f.elements.ativa.checked,
    imagem: rifaImagem,
    atualizadoEm: serverTimestamp(),
  };
  if (!dados.nome) { $('dr-erro').textContent = 'Informe o nome da rifa.'; return; }
  if (!(dados.preco >= 0)) { $('dr-erro').textContent = 'Valor inválido.'; return; }
  if (!(dados.totalNumeros >= 1 && dados.totalNumeros <= 10000)) { $('dr-erro').textContent = 'A quantidade de números deve ser entre 1 e 10.000.'; return; }
  if (!(dados.inicio >= 1 && dados.inicio + dados.totalNumeros - 1 <= 99999)) { $('dr-erro').textContent = 'Primeiro número inválido.'; return; }
  const nova = faixa(dados);
  if (rifaEditando) {
    const fora = reservasDa(rifaEditando).map((x) => x.numero).filter((n) => n < nova.ini || n > nova.fim);
    if (fora.length) {
      $('dr-erro').textContent = `Os números ${fora.sort((a, b) => a - b).join(', ')} já estão reservados/vendidos e ficariam fora da cartela (${nova.ini} a ${nova.fim}). A quantidade não pode ser menor.`;
      return;
    }
  }
  const choque = estado.rifas.find((x) => x.id !== rifaEditando && faixa(x).ini <= nova.fim && nova.ini <= faixa(x).fim);
  if (choque) {
    $('dr-erro').textContent = `Os números ${nova.ini} a ${nova.fim} se misturam com a ${choque.nome} (${faixa(choque).ini} a ${faixa(choque).fim}). Ajuste o primeiro número ou a quantidade.`;
    return;
  }
  $('dr-salvar').disabled = true;
  try {
    if (rifaEditando) await updateDoc(doc(db, 'rifas', rifaEditando), dados);
    else await addDoc(collection(db, 'rifas'), { ...dados, criadaEm: serverTimestamp() });
    $('dlg-rifa').close();
    toast('Rifa salva!');
  } catch (err) {
    $('dr-erro').textContent = `Erro ao salvar: ${err.message}`;
  } finally { $('dr-salvar').disabled = false; }
});

$('dr-excluir').addEventListener('click', async () => {
  const r = rifaPorId(rifaEditando);
  const qtd = reservasDa(r.id).length;
  const conf = prompt(`Excluir a rifa "${r.nome}" e ${qtd} reserva(s)/venda(s)? Esta ação não pode ser desfeita.\n\nDigite EXCLUIR para confirmar:`);
  if (conf !== 'EXCLUIR') return;
  try {
    const nums = await getDocs(collection(db, 'rifas', r.id, 'numeros'));
    const res = await getDocs(query(collection(db, 'reservas'), where('rifaId', '==', r.id)));
    const refs = [...nums.docs.map((d) => d.ref), ...res.docs.map((d) => d.ref)];
    for (let i = 0; i < refs.length; i += 400) {
      const b = writeBatch(db);
      refs.slice(i, i + 400).forEach((ref) => b.delete(ref));
      await b.commit();
    }
    await deleteDoc(doc(db, 'rifas', r.id));
    $('dlg-rifa').close();
    toast('Rifa excluída.');
  } catch (err) { $('dr-erro').textContent = `Erro ao excluir: ${err.message}`; }
});

/* ================= Página inicial ================= */
let heroNova = null;
function desenharPagina() {
  const f = $('form-pagina');
  ['titulo', 'subtitulo', 'mensagem', 'pix', 'pixCopiaECola', 'whatsapp', 'instrucoes'].forEach((k) => {
    if (document.activeElement !== f.elements[k]) f.elements[k].value = estado.config[k] || '';
  });
  if (heroNova === null) $('pg-hero-prev').src = estado.config.heroImagem || CONFIG_PADRAO.heroImagem;
}

$('pg-hero-arq').addEventListener('change', async (e) => {
  const arq = e.target.files[0];
  e.target.value = '';
  if (!arq) return;
  try {
    heroNova = await prepararImagem(arq, 1600, 850_000);
    $('pg-hero-prev').src = heroNova;
    toast('Foto carregada. Clique em “Salvar página inicial”.', 'aviso');
  } catch (err) { toast(err.message, 'erro'); }
});

$('pg-hero-padrao').addEventListener('click', () => {
  heroNova = CONFIG_PADRAO.heroImagem;
  $('pg-hero-prev').src = heroNova;
  toast('Clique em “Salvar página inicial” para aplicar.', 'aviso');
});

$('form-pagina').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const dados = {};
  ['titulo', 'subtitulo', 'mensagem', 'pix', 'pixCopiaECola', 'whatsapp', 'instrucoes'].forEach((k) => { dados[k] = f.elements[k].value.trim(); });
  if (!dados.titulo) { toast('Informe um título.', 'aviso'); return; }
  if (heroNova !== null) dados.heroImagem = heroNova;
  dados.atualizadoEm = serverTimestamp();
  try {
    await setDoc(doc(db, 'config', 'site'), dados, { merge: true });
    heroNova = null;
    toast('Página inicial atualizada!');
  } catch (err) { toast('Erro ao salvar: ' + err.message, 'erro'); }
});

/* ================= Segurança ================= */
const dataHora = (t) => (t?.toDate ? t.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '…');

function desenharSeguranca() {
  $('seg-acessos').innerHTML = estado.acessos.map((a) => `<tr><td>${dataHora(a.quando)}</td><td>${escapar(a.aparelho)}</td></tr>`).join('')
    || '<tr><td colspan="2">Nenhuma entrada registrada ainda.</td></tr>';
  $('seg-tentativas').innerHTML = estado.tentativas.map((t) => `<tr><td>${dataHora(t.quando)}</td><td>${escapar(t.email)}</td><td>${escapar(t.aparelho)}</td></tr>`).join('')
    || '<tr><td colspan="3">Nenhuma senha errada registrada. 👍</td></tr>';
  $('seg-alerta').hidden = !estado.tentativas.length;
  $('seg-alerta').textContent = `${estado.tentativas.length}${estado.tentativas.length === 50 ? '+' : ''} tentativa(s) com senha errada. Se não foi você, troque a senha em Conta.`;
}

$('btn-limpar-tentativas').addEventListener('click', async () => {
  if (!estado.tentativas.length || !confirm('Apagar o registro de senhas erradas?')) return;
  const b = writeBatch(db);
  estado.tentativas.forEach((t) => b.delete(doc(db, 'tentativas', t.id)));
  try { await b.commit(); toast('Registro limpo.'); } catch (err) { toast('Erro: ' + err.message, 'erro'); }
});

// Backup: baixa tudo (página, rifas, números e reservas) num arquivo JSON.
$('btn-backup').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const paraObj = (snap) => snap.docs.map((d) => ({ id: d.id, ...JSON.parse(JSON.stringify(d.data())) }));
    const config = await getDoc(doc(db, 'config/site'));
    const rifas = await getDocs(collection(db, 'rifas'));
    const numeros = {};
    for (const r of rifas.docs) numeros[r.id] = paraObj(await getDocs(collection(db, 'rifas', r.id, 'numeros')));
    const dados = {
      geradoEm: new Date().toISOString(),
      config: config.exists() ? config.data() : null,
      rifas: paraObj(rifas),
      numeros,
      reservas: paraObj(await getDocs(collection(db, 'reservas'))),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
    a.download = `backup-rifa-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup baixado!');
  } catch (err) { toast('Erro no backup: ' + err.message, 'erro'); } finally { btn.disabled = false; }
});
