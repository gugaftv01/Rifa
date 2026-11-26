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
  CONFIG_PADRAO, brl, soDigitos, formatarTelefone, linkWhatsApp, escapar, toast, prepararImagem,
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
  const res = reservasDa(r.id).filter((x) => x.numero >= 1 && x.numero <= r.totalNumeros);
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
  $('res-rifa').innerHTML = '<option value="">Todas as rifas</option>' + opcoes;
  $('res-rifa').value = rifaPorId(atual) ? atual : '';
}

/* ================= Números ================= */
$('num-rifa').addEventListener('change', (e) => { estado.numRifa = e.target.value; desenharNumeros(); });
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
  for (let n = 1; n <= r.totalNumeros; n++) {
    const res = mapa.get(n);
    const st = res ? (res.status === 'vendido' ? 'vendido' : 'reservado') : 'livres';
    if (estado.numFiltro !== 'todos' && estado.numFiltro !== st) continue;
    const classe = st === 'vendido' ? 'ocupado' : st === 'reservado' ? 'reservado' : 'livre';
    const titulo = res ? `${res.nome} · ${formatarTelefone(res.telefone)}` : 'Disponível';
    partes.push(`<button type="button" class="num ${classe}" data-n="${n}" title="${escapar(titulo)}">${n}</button>`);
  }
  $('num-grade').innerHTML = partes.join('') || '<p class="vazio">Nenhum número neste filtro.</p>';
}

$('num-grade').addEventListener('click', (e) => {
  const b = e.target.closest('[data-n]');
  if (b) abrirNumero(estado.numRifa, Number(b.dataset.n));
});

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

/* ================= Reservas ================= */
['res-rifa', 'res-status', 'res-busca'].forEach((id) => $(id).addEventListener('input', desenharReservas));

function reservasFiltradas() {
  const rifa = $('res-rifa').value;
  const st = $('res-status').value;
  const busca = $('res-busca').value.trim().toLowerCase();
  const buscaDig = soDigitos(busca);
  return estado.reservas
    .filter((x) => (!rifa || x.rifaId === rifa) && (!st || x.status === st))
    .filter((x) => !busca || x.nome?.toLowerCase().includes(busca) || (buscaDig && (x.telefone?.includes(buscaDig) || String(x.numero) === buscaDig)))
    .sort((a, b) => (b.criadoEm?.toMillis?.() ?? 0) - (a.criadoEm?.toMillis?.() ?? 0));
}

function desenharReservas() {
  const lista = reservasFiltradas();
  $('res-vazio').hidden = lista.length > 0;
  $('res-tabela').innerHTML = lista.map((x) => {
    const r = rifaPorId(x.rifaId);
    const data = x.criadoEm?.toDate ? x.criadoEm.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const whats = linkWhatsApp(x.telefone, `Olá ${x.nome}! Sobre o número ${x.numero} da ${r?.nome || 'rifa'}:`);
    return `<tr>
      <td>${escapar(r?.nome || x.rifaId)}</td>
      <td><strong>${x.numero}</strong></td>
      <td>${escapar(x.nome)}</td>
      <td>${whats ? `<a href="${whats}" target="_blank" rel="noopener">${escapar(formatarTelefone(x.telefone))}</a>` : ''}</td>
      <td><span class="etiqueta ${x.status === 'vendido' ? 'vendido' : 'reservado'}">${x.status === 'vendido' ? 'Vendido' : 'Reservado'}</span></td>
      <td>${data}</td>
      <td class="acoes">
        ${x.status === 'vendido' ? '' : `<button class="btn btn-verde btn-peq" data-res="vender" data-rifa="${escapar(x.rifaId)}" data-n="${x.numero}">Confirmar pago</button>`}
        <button class="btn btn-sec btn-peq" data-res="abrir" data-rifa="${escapar(x.rifaId)}" data-n="${x.numero}">Detalhes</button>
      </td></tr>`;
  }).join('');
}

$('res-tabela').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-res]');
  if (!b) return;
  const rifaId = b.dataset.rifa;
  const n = Number(b.dataset.n);
  if (b.dataset.res === 'abrir') { abrirNumero(rifaId, n); return; }
  b.disabled = true;
  try { await executarAcao('vender', rifaId, n, { existe: true }); toast('Pagamento confirmado!'); }
  catch (err) { toast('Erro: ' + err.message, 'erro'); b.disabled = false; }
});

$('btn-csv').addEventListener('click', () => {
  const linhas = [['Rifa', 'Numero', 'Nome', 'Telefone', 'Status', 'Data']];
  reservasFiltradas().forEach((x) => linhas.push([
    rifaPorId(x.rifaId)?.nome || x.rifaId, x.numero, x.nome, x.telefone, x.status,
    x.criadoEm?.toDate ? x.criadoEm.toDate().toLocaleString('pt-BR') : '',
  ]));
  const csv = linhas.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `reservas-${new Date().toISOString().slice(0, 10)}.csv`;
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
      <p>${r.totalNumeros} números · ${brl(r.preco)} cada</p>
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
    nome: `Rifa ${estado.rifas.length + 1}`, premio: '', descricao: '', preco: 10, totalNumeros: 100,
    dataSorteio: '', ordem: (Math.max(0, ...estado.rifas.map((x) => x.ordem || 0)) + 1), ativa: true, imagem: '',
  };
  const f = $('form-rifa');
  ['nome', 'premio', 'preco', 'totalNumeros', 'dataSorteio', 'ordem'].forEach((k) => { f.elements[k].value = r[k] ?? ''; });
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
    dataSorteio: f.elements.dataSorteio.value,
    ordem: Number(f.elements.ordem.value) || 0,
    ativa: f.elements.ativa.checked,
    imagem: rifaImagem,
    atualizadoEm: serverTimestamp(),
  };
  if (!dados.nome) { $('dr-erro').textContent = 'Informe o nome da rifa.'; return; }
  if (!(dados.preco >= 0)) { $('dr-erro').textContent = 'Valor inválido.'; return; }
  if (!(dados.totalNumeros >= 1 && dados.totalNumeros <= 10000)) { $('dr-erro').textContent = 'A quantidade de números deve ser entre 1 e 10.000.'; return; }
  if (rifaEditando) {
    const maior = Math.max(0, ...reservasDa(rifaEditando).map((x) => x.numero));
    if (dados.totalNumeros < maior) {
      $('dr-erro').textContent = `O número ${maior} já está reservado/vendido. A quantidade não pode ser menor que ${maior}.`;
      return;
    }
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
