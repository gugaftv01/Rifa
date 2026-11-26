# Rifa

Chá Rifa em formato de cartaz: foto do casal ao fundo, cartela de corações (8 cartelas
independentes de 100 números), reservas em tempo real e painel administrativo.
Hospedado no Firebase (projeto `rifa-gugaftv`). Veja também o [SEGURANCA.md](SEGURANCA.md).

- **Site:** https://rifa-gugaftv.web.app
- **Painel ADM:** https://rifa-gugaftv.web.app/admin (não há link no site público)

## Como funciona

| Parte | Tecnologia |
|---|---|
| Páginas | HTML/CSS/JS puros em `public/` (sem etapa de build) |
| Banco de dados | Cloud Firestore (`southamerica-east1`), atualização em tempo real |
| Login do ADM | Firebase Authentication (e-mail e senha) |
| Segurança | Regras do Firestore em `firestore.rules`, verificadas no servidor do Google |

### Dados no Firestore

| Caminho | Conteúdo | Quem lê | Quem grava |
|---|---|---|---|
| `config/site` | título, nomes, aviso do sorteio, foto de fundo, Pix, WhatsApp | todos | ADM |
| `rifas/{rifaId}` | nome, prêmio, valor, quantidade de números | todos | ADM |
| `rifas/{rifaId}/numeros/{n}` | status público do número (sem dados pessoais) | todos | visitante cria (nunca sobrescreve); ADM altera |
| `reservas/{rifaId}_{n}` | nome e WhatsApp do comprador | só ADM | visitante cria junto com o número; ADM altera |
| `admins/{uid}` | quem é administrador | o próprio usuário | só pelo console do Firebase |

Número sem documento em `numeros` = **disponível** (coração preto). Com documento =
**vendido/reservado** (coração com X vermelho). Os números escolhidos pelo visitante ficam em vermelho.

### Por que não dá para reservar o mesmo número duas vezes

O visitante só tem permissão para **criar** o documento do número. Se o número já existe,
a gravação vira uma "atualização", que as regras negam. O Firestore processa uma gravação
de cada vez por documento, então, quando duas pessoas clicam juntas, só uma consegue.

## Administração

- **Resumo:** vendidos, reservados, disponíveis e valores por rifa.
- **Números:** toque num número para vender, reservar, confirmar pagamento ou liberar.
- **Reservas:** lista com nome e WhatsApp, filtros e exportação CSV.
- **Rifas:** criar, editar (prêmios, valor, quantidade de números, data, imagem), ocultar ou excluir.
- **Página inicial:** título, nomes, aviso do sorteio, foto de fundo, Pix e WhatsApp.
- **Conta:** trocar a senha.

### Criar um administrador

1. Firebase Console → Authentication → Usuários → **Adicionar usuário** (e-mail e senha).
2. Copie o **UID** do usuário criado.
3. Firestore → coleção `admins` → **Adicionar documento** com o ID igual ao UID
   (campo `email` com o e-mail, só para referência).

Para remover o acesso, apague o documento em `admins`.

## Testes

Precisa de Node 20+ e Java (para os emuladores do Firebase).

```bash
cd tests
npm install
npm test        # regras de segurança (11 testes)
npm run e2e     # site completo no navegador contra os emuladores (20 verificações)
npm run smoke   # verificação SOMENTE LEITURA do banco de produção
```

`npm test` e `npm run e2e` usam emuladores locais e **não tocam no banco de produção**.
`npm run smoke` lê o banco real, mas não grava nada.

## Publicar

```bash
cd tests && npx firebase deploy --only firestore,hosting,auth --project rifa-gugaftv
```

## Limitações conhecidas (plano gratuito Spark)

- Reservas não expiram sozinhas: libere pelo painel os números não pagos.
- As imagens enviadas pelo painel ficam guardadas no próprio Firestore (otimizadas no
  navegador para caber no limite de 1 MB por documento), porque o Cloud Storage exige o plano pago.
