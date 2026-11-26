// Inicialização do Firebase compartilhada pelo site público e pelo painel ADM.
// Estas chaves são públicas por natureza (identificam o projeto); a segurança
// real fica nas regras do Firestore (firestore.rules) e no login do ADM.
import { initializeApp } from '/vendor/firebase/13.4.0/firebase-app.js';
import { getFirestore } from '/vendor/firebase/13.4.0/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyC93zKwVzfJCo7Rq7KRtaJGpAUoy91lOOI',
  authDomain: 'rifa-gugaftv.firebaseapp.com',
  projectId: 'rifa-gugaftv',
  storageBucket: 'rifa-gugaftv.firebasestorage.app',
  messagingSenderId: '731133186825',
  appId: '1:731133186825:web:c21ec41b7e5a312b0139d8',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Conecta ao emulador local quando a página é aberta com ?emulador
if (new URLSearchParams(location.search).has('emulador')) {
  const { connectFirestoreEmulator } = await import('/vendor/firebase/13.4.0/firebase-firestore.js');
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
