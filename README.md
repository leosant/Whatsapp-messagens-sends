# WhatsApp Sender

Aplicação para envio de mensagens via WhatsApp Web usando Node.js e a biblioteca whatsapp-web.js.

## Requisitos

- Node.js (versão 14 ou superior)
- NPM ou Yarn
- Google Chrome instalado

## Instalação

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/whatsapp-sender.git
cd whatsapp-sender
```

2. Instale as dependências:
```bash
npm install
```

3. Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:
```
PORT=3000
```

## Uso

1. Inicie o servidor:
```bash
node index.js
```

2. Acesse a interface web em `http://localhost:3000`

3. Escaneie o QR Code que aparecerá no terminal com seu WhatsApp

4. Use a interface web para enviar mensagens

## Funcionalidades

- Envio de mensagens para números de telefone
- Interface web amigável
- Sistema de retry automático
- Logs detalhados

## Estrutura do Projeto

```
whatsapp-sender/
├── public/          # Arquivos estáticos
├── utils/           # Utilitários
├── index.js         # Arquivo principal
├── package.json     # Dependências
└── README.md        # Documentação
```

## Contribuição

Sinta-se à vontade para abrir issues ou enviar pull requests.

## Licença

MIT 