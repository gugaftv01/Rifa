// Cria os dados iniciais (página inicial, 8 rifas e galeria) sem sobrescrever o que já existe.
// Uso: node seed.mjs <email-adm> <senha-adm> [--emulador]
// O usuário precisa já estar cadastrado em /admins (as regras exigem isso).
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, collection, serverTimestamp } from 'firebase/firestore';

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
    titulo: 'Nossa Rifa',
    subtitulo: 'Escolha seus números da sorte e ajude a realizar o nosso sonho!',
    mensagem: 'Cada número comprado é um pedacinho do nosso futuro juntos. Obrigado pelo carinho!',
    heroImagem: '/img/foto-principal.jpg',
    pix: '', whatsapp: '',
    instrucoes: 'Após reservar, faça o pagamento via PIX e envie o comprovante pelo WhatsApp. Seu número será confirmado assim que recebermos.',
    rodape: 'Obrigado por participar! ❤',
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

if ((await getDocs(collection(db, 'galeria'))).empty) {
  const fotos = ['/img/foto-2.jpg', '/img/foto-3.jpg', '/img/foto-4.jpg', '/img/foto-5.jpg'];
  for (const [ordem, src] of fotos.entries()) await setDoc(doc(db, 'galeria', `foto-${ordem + 1}`), { src, ordem });
  console.log('galeria criada');
}
console.log('ok');
process.exit(0);
