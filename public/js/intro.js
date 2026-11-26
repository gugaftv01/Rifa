// Abertura animada: aparece uma vez por sessão; toque para pular.
(function () {
  var params = new URLSearchParams(location.search);
  var pular = params.has('emulador') && !params.has('intro'); // testes automáticos
  try {
    if (sessionStorage.getItem('intro-vista')) pular = true;
    sessionStorage.setItem('intro-vista', '1');
  } catch (e) { /* sem armazenamento: mostra a abertura */ }
  if (pular) document.documentElement.classList.add('sem-intro');

  document.addEventListener('DOMContentLoaded', function () {
    var intro = document.getElementById('intro');
    if (!intro) return;
    if (pular) { intro.remove(); return; }

    // Separa cada texto em letras que começam espalhadas pela tela.
    var atraso = { 'intro-cha': 0.75, 'intro-nomes': 0.82 };
    document.querySelectorAll('#intro [data-letras]').forEach(function (el) {
      var base = el.classList.contains('intro-cha') ? atraso['intro-cha'] : atraso['intro-nomes'];
      var passo = el.classList.contains('intro-cha') ? 0.025 : 0.018;
      var texto = el.textContent;
      el.setAttribute('aria-label', texto);
      el.textContent = '';
      Array.from(texto).forEach(function (ch, i) {
        var s = document.createElement('span');
        s.className = 'letra';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = ch;
        s.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 180) + 'px');
        s.style.setProperty('--dy', Math.round((Math.random() - 0.5) * 220) + 'px');
        s.style.setProperty('--rot', Math.round((Math.random() - 0.5) * 140) + 'deg');
        s.style.setProperty('--d', (base + i * passo).toFixed(2) + 's');
        el.appendChild(s);
      });
    });

    function terminar() { if (intro.isConnected) intro.remove(); }
    intro.addEventListener('animationend', function (e) { if (e.target === intro) terminar(); });
    intro.addEventListener('click', function () {
      intro.classList.add('saindo');
      setTimeout(terminar, 350);
    });
  });
})();
