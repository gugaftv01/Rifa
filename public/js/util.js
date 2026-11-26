// Funções utilitárias compartilhadas.

export const CONFIG_PADRAO = {
  titulo: 'Chá Rifa de Casa Nova',
  subtitulo: '',
  mensagem: 'O sorteio será realizado assim que acabarem todos os números',
  heroImagem: '/img/foto-3.jpg',
  pix: '',
  whatsapp: '',
  instrucoes: 'Após reservar, faça o pagamento via Pix e envie o comprovante pelo WhatsApp. Seu número será confirmado assim que recebermos.',
};

// Faixa de números de uma cartela (ex.: cartela 2 = 101 a 200).
export function faixa(r) {
  const ini = Number(r?.inicio) || 1;
  const total = Number(r?.totalNumeros) || 0;
  return { ini, fim: ini + total - 1, total };
}

export const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const soDigitos = (s) => String(s || '').replace(/\D/g, '');

export function formatarTelefone(t) {
  const d = soDigitos(t);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

export function linkWhatsApp(numero, texto) {
  let d = soDigitos(numero);
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

export function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, tipo = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast toast-${tipo} visivel`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visivel'), 4000);
}

// Redimensiona uma imagem no navegador e devolve um data URL JPEG que cabe
// num documento do Firestore (limite de 1 MB), mantendo a proporção original.
export async function prepararImagem(arquivo, ladoMax = 1600, limiteBytes = 850_000) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height));
  let w = Math.round(bitmap.width * escala);
  let h = Math.round(bitmap.height * escala);
  const canvas = document.createElement('canvas');
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    for (const q of [0.9, 0.82, 0.74, 0.66]) {
      const url = canvas.toDataURL('image/jpeg', q);
      if (url.length <= limiteBytes) return url;
    }
    w = Math.round(w * 0.85);
    h = Math.round(h * 0.85);
  }
  throw new Error('Imagem grande demais, tente outra.');
}
