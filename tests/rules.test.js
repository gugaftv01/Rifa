// Testes das regras de segurança do Firestore (rodam no emulador local).
// Uso: cd tests && npm install && npm test
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, collection, writeBatch, deleteDoc, updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rifa',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});

after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'admins/adm1'), { email: 'adm@x.com' });
    await setDoc(doc(db, 'rifas/rifa-1'), { nome: 'Rifa 1', totalNumeros: 100, preco: 10, ativa: true, ordem: 1 });
    await setDoc(doc(db, 'rifas/rifa-2'), { nome: 'Rifa 2', totalNumeros: 50, preco: 5, ativa: true, ordem: 2 });
    await setDoc(doc(db, 'rifas/rifa-off'), { nome: 'Inativa', totalNumeros: 10, preco: 5, ativa: false, ordem: 9 });
    await setDoc(doc(db, 'config/site'), { titulo: 'Rifa' });
  });
});

const visitante = () => env.unauthenticatedContext().firestore();
const admin = () => env.authenticatedContext('adm1').firestore();
const intruso = () => env.authenticatedContext('qualquer').firestore();

// Mesmo fluxo que o site usa para reservar um número.
function reservar(db, rifaId, numero, extra = {}) {
  const id = `${rifaId}_${numero}`;
  const b = writeBatch(db);
  b.set(doc(db, `rifas/${rifaId}/numeros/${numero}`), { status: 'reservado', reservaId: id, criadoEm: serverTimestamp() });
  b.set(doc(db, `reservas/${id}`), {
    rifaId, numero, nome: 'Maria Silva', telefone: '61999998888', status: 'reservado', criadoEm: serverTimestamp(), ...extra,
  });
  return b.commit();
}

test('visitante consegue ler rifas, números e configuração', async () => {
  const db = visitante();
  await assertSucceeds(getDoc(doc(db, 'rifas/rifa-1')));
  await assertSucceeds(getDocs(collection(db, 'rifas/rifa-1/numeros')));
  await assertSucceeds(getDoc(doc(db, 'config/site')));
});

test('visitante reserva um número disponível', async () => {
  await assertSucceeds(reservar(visitante(), 'rifa-1', 7));
});

test('NÃO é possível reservar o mesmo número duas vezes', async () => {
  await assertSucceeds(reservar(visitante(), 'rifa-1', 7));
  await assertFails(reservar(visitante(), 'rifa-1', 7));
  await assertFails(reservar(intruso(), 'rifa-1', 7, { nome: 'Outra Pessoa' }));
});

test('rifas são independentes: o mesmo número em outra rifa continua livre', async () => {
  await assertSucceeds(reservar(visitante(), 'rifa-1', 7));
  await assertSucceeds(reservar(visitante(), 'rifa-2', 7));
});

test('não aceita número fora do limite, zero à esquerda ou rifa inativa', async () => {
  await assertFails(reservar(visitante(), 'rifa-2', 51));
  await assertFails(reservar(visitante(), 'rifa-1', 0));
  await assertFails(reservar(visitante(), 'rifa-off', 1));
  const db = visitante();
  const b = writeBatch(db);
  b.set(doc(db, 'rifas/rifa-1/numeros/07'), { status: 'reservado', reservaId: 'rifa-1_07', criadoEm: serverTimestamp() });
  await assertFails(b.commit());
});

test('visitante não consegue gravar número sem a reserva (nem reserva sem número)', async () => {
  const db = visitante();
  await assertFails(setDoc(doc(db, 'rifas/rifa-1/numeros/9'), { status: 'reservado', reservaId: 'rifa-1_9', criadoEm: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'reservas/rifa-1_9'), {
    rifaId: 'rifa-1', numero: 9, nome: 'Maria', telefone: '61999998888', status: 'reservado', criadoEm: serverTimestamp(),
  }));
});

test('não é possível criar dados privados para um número que já está ocupado', async () => {
  await reservar(visitante(), 'rifa-1', 8);
  await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), 'reservas/rifa-1_8')); });
  await assertFails(setDoc(doc(visitante(), 'reservas/rifa-1_8'), {
    rifaId: 'rifa-1', numero: 8, nome: 'Invasor', telefone: '61999998888', status: 'reservado', criadoEm: serverTimestamp(),
  }));
});

test('visitante não consegue se marcar como "vendido" nem enviar campos extras', async () => {
  const db = visitante();
  const b = writeBatch(db);
  b.set(doc(db, 'rifas/rifa-1/numeros/3'), { status: 'vendido', reservaId: 'rifa-1_3', criadoEm: serverTimestamp() });
  b.set(doc(db, 'reservas/rifa-1_3'), { rifaId: 'rifa-1', numero: 3, nome: 'Maria', telefone: '61999998888', status: 'reservado', criadoEm: serverTimestamp() });
  await assertFails(b.commit());
  await assertFails(reservar(visitante(), 'rifa-1', 4, { pago: true }));
  await assertFails(reservar(visitante(), 'rifa-1', 5, { telefone: 'abc' }));
});

test('dados pessoais dos compradores não ficam públicos', async () => {
  await reservar(visitante(), 'rifa-1', 7);
  await assertFails(getDoc(doc(visitante(), 'reservas/rifa-1_7')));
  await assertFails(getDocs(collection(intruso(), 'reservas')));
  await assertSucceeds(getDoc(doc(admin(), 'reservas/rifa-1_7')));
});

test('visitante e usuário logado sem permissão NÃO executam ações de ADM', async () => {
  await reservar(visitante(), 'rifa-1', 7);
  for (const db of [visitante(), intruso()]) {
    await assertFails(deleteDoc(doc(db, 'rifas/rifa-1/numeros/7')));
    await assertFails(updateDoc(doc(db, 'rifas/rifa-1/numeros/7'), { status: 'vendido' }));
    await assertFails(updateDoc(doc(db, 'rifas/rifa-1'), { totalNumeros: 1000 }));
    await assertFails(setDoc(doc(db, 'rifas/nova'), { nome: 'x' }));
    await assertFails(setDoc(doc(db, 'config/site'), { titulo: 'hack' }));
    await assertFails(setDoc(doc(db, 'admins/qualquer'), { email: 'x' }));
  }
});

test('ADM gerencia rifas, números, reservas e página inicial', async () => {
  await reservar(visitante(), 'rifa-1', 7);
  const db = admin();
  await assertSucceeds(updateDoc(doc(db, 'rifas/rifa-1/numeros/7'), { status: 'vendido' }));
  await assertSucceeds(updateDoc(doc(db, 'reservas/rifa-1_7'), { status: 'vendido' }));
  await assertSucceeds(deleteDoc(doc(db, 'rifas/rifa-1/numeros/7')));
  await assertSucceeds(deleteDoc(doc(db, 'reservas/rifa-1_7')));
  await assertSucceeds(setDoc(doc(db, 'rifas/rifa-9'), { nome: 'Nova', totalNumeros: 200, preco: 20, ativa: true, ordem: 9 }));
  await assertSucceeds(setDoc(doc(db, 'config/site'), { titulo: 'Novo título' }));
  // Depois de liberado, o número volta a ficar disponível para visitantes.
  await assertSucceeds(reservar(visitante(), 'rifa-1', 7));
});
