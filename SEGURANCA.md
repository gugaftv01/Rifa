# Segurança do site da Chá Rifa

## Área do organizador (painel ADM)
- Endereço: **https://rifa-gugaftv.web.app/admin**. Não existe link para ele no site público e ele não aparece no Google.
- Entrada com **e-mail e senha** do Firebase. Não existe nenhuma senha escrita no código.
- Só entra quem está cadastrado na coleção `admins` do banco (pelo código da conta, o UID). Uma conta comum, mesmo com senha certa, é recusada.
- **Esqueci a senha / primeiro acesso:** digite o e-mail e toque no link. O Firebase manda um e-mail para criar a senha.
- **Privacidade do login:** as mensagens não revelam se um e-mail tem conta ou não.
- **Aba Segurança:** mostra as últimas entradas no painel e cada senha errada digitada (data, e-mail e aparelho).
- **Saída automática:** depois de 12 horas sem usar o painel, ele pede o login de novo.
- **Senha forte:** ao trocar a senha, o painel exige no mínimo 8 caracteres, com letra minúscula e número.

## Banco de dados (Cloud Firestore, projeto `rifa-gugaftv`)
Regras no arquivo `firestore.rules`, testadas automaticamente (`cd tests && npm test`):
- `config`, `rifas` e o status dos números: **todo mundo vê**; **só o ADM altera**.
- Números: o visitante só consegue **criar** a reserva de um número livre. Se o número já existe, a gravação é recusada, então ninguém compra o mesmo número duas vezes.
- `reservas` (nome e WhatsApp de quem comprou): **só o ADM lê**.
- `acessos`: registro de cada entrada do ADM; só ele grava e lê.
- `tentativas`: a tela de login só acrescenta registros (com a hora do servidor); só o ADM lê e apaga.
- `admins`: ninguém consegue se cadastrar como ADM pelo site; só pelo console do Firebase.
- Qualquer outro caminho: fechado.

**Atenção:** tudo que está nas rifas e na página inicial (textos, prêmios, Pix, WhatsApp, fotos) é público. Nunca coloque dados pessoais de compradores nesses campos.

## Proteções do site
- **Regra de conteúdo (CSP):** o site só carrega código dele mesmo e só se conecta aos endereços do Firebase.
- **Bibliotecas do Firebase dentro do site** (`public/vendor/firebase/13.4.0/`): são cópias idênticas às oficiais do Google, conferidas byte a byte. Assim o site não depende de código vindo de fora.
- O painel não pode ser aberto dentro de outro site (proteção contra clique falso).
- Todo texto digitado por visitantes é tratado como texto, nunca como código.

## Para adicionar outro administrador
1. Firebase Console → Authentication → Usuários → **Adicionar usuário**.
2. Copie o **UID** do usuário criado.
3. Firestore → coleção `admins` → **Adicionar documento** com o ID igual ao UID.

Para tirar o acesso, apague o documento dessa pessoa em `admins`.

## Backup
No painel: **Segurança → Baixar backup completo**. O arquivo tem nome e WhatsApp dos compradores: guarde em lugar seguro.

## O que só pode ser feito no console (pelo dono do projeto)
- **Limitar a chave do Firebase ao site:** Google Cloud Console → APIs e serviços → Credenciais → chave "Browser key".
  Em "Restrições de aplicativo", escolha **Referenciadores HTTP** e adicione `https://rifa-gugaftv.web.app/*` e
  `https://rifa-gugaftv.firebaseapp.com/*`. Se o site for para outro endereço, adicione esse endereço também.
- **Exigir senha forte no próprio Firebase:** Firebase Console → Authentication → Configurações → Política de senha.
