// Cria os dados iniciais (página inicial e 8 rifas) sem sobrescrever o que já existe.
// Uso: node seed.mjs <email-adm> <senha-adm> [--emulador]
// O usuário precisa já estar cadastrado em /admins (as regras exigem isso).
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const [email, senha] = process.argv.slice(2);
const emulador = process.argv.includes('--emulador');
const app = initializeApp({
  apiKey: 'AIzaSyC93zKwVzfJCo7Rq7KRtaJGpAUoy91lOOI',
  authDomain: 'rifa-gugaftv.firebaseapp.com',
  projectId: 'rifa-gugaftv',
  appId: '1:731133186825:web:c21ec41b7e5a312b0139d8',
});
const auth = getAuth(app);
const db = getFirestore(app);
if (emulador) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

await signInWithEmailAndPassword(auth, email, senha);

if (!(await getDoc(doc(db, 'config/site'))).exists()) {
  await setDoc(doc(db, 'config/site'), {
    titulo: 'Chá Rifa de Casa Nova',
    subtitulo: '',
    mensagem: 'O sorteio será realizado assim que acabarem todos os números',
    heroImagem: '/img/foto-2.jpg',
    pix: '', whatsapp: '',
    instrucoes: 'Após reservar, faça o pagamento via Pix e envie o comprovante pelo WhatsApp. Seu número será confirmado assim que recebermos.',
  });
  console.log('config/site criado');
}

for (let i = 1; i <= 8; i++) {
  const ref = doc(db, 'rifas', `rifa-${i}`);
  if ((await getDoc(ref)).exists()) continue;
  await setDoc(ref, {
    nome: `Rifa ${i}`, premio: '', descricao: '', preco: 10, totalNumeros: 100,
    dataSorteio: '', ordem: i, ativa: true, imagem: '', criadaEm: serverTimestamp(),
  });
  console.log(`rifa-${i} criada`);
}

console.log('ok');
process.exit(0);
