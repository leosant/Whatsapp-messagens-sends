const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const qrcode = require('qrcode-terminal');

// Configuração do teste
const TEST_PORT = 3001;
const TEST_PHONE = '5511999999999'; // Número de teste
const TEST_MESSAGE = 'Teste mockado end-to end';

// Configuração do logger para testes
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, ...metadata }) => {
            let msg = `${timestamp} [${level.toUpperCase()}] ${message}`;
            if (Object.keys(metadata).length > 0) {
                msg += ` ${JSON.stringify(metadata)}`;
            }
            return msg;
        })
    ),
    transports: [
        new winston.transports.Console()
    ]
});

// Função para formatar o número de telefone
const formatPhoneNumber = (phone) => {
    // Remove todos os caracteres não numéricos
    let formatted = phone.replace(/\D/g, '');
    
    // Se o número começar com 0, remove o 0
    if (formatted.startsWith('0')) {
        formatted = formatted.substring(1);
    }
    
    // Se o número não começar com código do país, adiciona 55
    if (!formatted.startsWith('55')) {
        formatted = '55' + formatted;
    }
    
    // Adiciona o sufixo @c.us que o WhatsApp Web precisa
    return formatted + '@c.us';
};

describe('WhatsApp Sender E2E Tests', () => {
    let app;
    let client;
    let server;
    let qrCode = null;

    // Configuração inicial
    beforeAll(async () => {
        // Cria uma instância do Express para teste
        app = express();
        app.use(express.json());

        // Configuração do diretório de sessão
        const sessionDir = path.join(__dirname, '../.wwebjs_auth_test');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Inicializa o cliente WhatsApp real
        client = new Client({
            authStrategy: new LocalAuth({
                clientId: "whatsapp-sender-test",
                dataPath: sessionDir
            }),
            puppeteer: {
                headless: false,
                executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-software-rasterizer',
                    '--disable-features=site-per-process',
                    '--disable-features=IsolateOrigins',
                    '--disable-site-isolation-trials',
                    '--window-size=1920,1080',
                    '--start-maximized',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process'
                ],
                defaultViewport: null,
                timeout: 0
            }
        });

        // Configura os eventos do cliente
        client.on('qr', (qr) => {
            qrCode = qr;
            logger.info('QR Code gerado para autenticação');
            qrcode.generate(qr, { small: true });
        });

        client.on('ready', () => {
            logger.info('Cliente WhatsApp pronto para testes');
            logger.info('Client info:', { 
                wid: client.info?.wid,
                pushname: client.info?.pushname,
                platform: client.info?.platform
            });
        });

        client.on('authenticated', () => {
            logger.info('Cliente WhatsApp autenticado');
        });

        client.on('auth_failure', msg => {
            logger.error('Falha na autenticação', { message: msg });
        });

        client.on('disconnected', (reason) => {
            logger.error('Cliente desconectado', { reason });
        });

        client.on('change_state', state => {
            logger.info('Estado do cliente alterado', { state });
        });

        // Inicializa o cliente com tratamento de erro
        try {
            await client.initialize();
            logger.info('Cliente inicializado com sucesso');
        } catch (error) {
            logger.error('Erro ao inicializar o cliente', { 
                error: error.message,
                stack: error.stack,
                type: error.constructor.name
            });
            throw error;
        }

        // Configura as rotas de teste
        app.get('/status', (req, res) => {
            res.json({
                status: client.info ? 'connected' : 'disconnected',
                qrCode: qrCode,
                user: client.info ? {
                    name: client.info.pushname,
                    phone: client.info.wid.user
                } : null
            });
        });

        app.post('/send-message', async (req, res) => {
            try {
                const { phone, message } = req.body;
                
                if (!phone || !message) {
                    return res.status(400).json({ error: 'Phone and message are required' });
                }

                // Formata o número de telefone
                const chatId = formatPhoneNumber(phone);
                
                logger.info('Tentando enviar mensagem...', { 
                    originalPhone: phone,
                    chatId: chatId,
                    message: message,
                    clientState: {
                        isReady: !!client.info,
                        isAuthenticated: client.pupPage && !qrCode,
                        pushname: client.info?.pushname,
                        wid: client.info?.wid
                    }
                });

                try {
                    // Verifica se o número existe
                    const numberExists = await client.isRegisteredUser(chatId);
                    
                    if (!numberExists) {
                        logger.warn('Número não registrado no WhatsApp', { 
                            chatId,
                            clientState: {
                                isReady: !!client.info,
                                isAuthenticated: client.pupPage && !qrCode,
                                pushname: client.info?.pushname
                            }
                        });
                        return res.status(404).json({ error: 'Número não registrado no WhatsApp' });
                    }

                    // Envia a mensagem
                    logger.info('Enviando mensagem para número verificado...', { 
                        chatId,
                        clientState: {
                            isReady: !!client.info,
                            isAuthenticated: client.pupPage && !qrCode,
                            pushname: client.info?.pushname
                        }
                    });

                    const result = await client.sendMessage(chatId, message);
                    
                    logger.info('Mensagem enviada com sucesso', { 
                        messageId: result.id._serialized,
                        to: chatId,
                        result: result
                    });

                    // Aguarda um tempo para garantir que a mensagem foi processada
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // Verifica o status da mensagem
                    const messageStatus = await result.getInfo();
                    logger.info('Status da mensagem:', { 
                        status: messageStatus,
                        messageId: result.id._serialized
                    });

                    res.json({ 
                        success: true,
                        messageId: result.id._serialized,
                        to: chatId,
                        status: messageStatus
                    });
                } catch (error) {
                    logger.error('Erro ao enviar mensagem', {
                        error: error.message,
                        chatId: chatId,
                        stack: error.stack,
                        clientState: {
                            isReady: !!client.info,
                            isAuthenticated: client.pupPage && !qrCode,
                            pushname: client.info?.pushname
                        }
                    });
                    throw error;
                }
            } catch (error) {
                logger.error('Error sending message', { 
                    error: error.message,
                    phone: req.body.phone,
                    stack: error.stack
                });
                
                res.status(500).json({ error: 'Failed to send message' });
            }
        });

        // Inicia o servidor de teste
        server = app.listen(TEST_PORT);
        logger.info(`Servidor de teste iniciado na porta ${TEST_PORT}`);
    });

    // Limpeza após os testes
    afterAll(async () => {
        if (client) {
            try {
                await client.destroy();
                logger.info('Cliente destruído com sucesso');
            } catch (error) {
                logger.error('Erro ao destruir cliente', { 
                    error: error.message,
                    stack: error.stack
                });
            }
        }
        if (server) {
            server.close();
            logger.info('Servidor de teste encerrado');
        }
    });

    // Teste de status
    test('should check connection status', async () => {
        const response = await request(app)
            .get('/status')
            .expect(200);

        expect(response.body).toHaveProperty('status');
        expect(['connected', 'disconnected']).toContain(response.body.status);
    });

    // Teste de envio de mensagem
    test('should send message successfully', async () => {
        // Aumenta o timeout do teste para 10 minutos
        jest.setTimeout(600000);

        // Aguarda até que o cliente esteja pronto
        let attempts = 0;
        const maxAttempts = 30;
        const checkInterval = 10000;
        
        const isClientReady = async () => {
            try {
                // Verifica se a página do Puppeteer ainda está aberta
                const pageOpen = client.pupPage && !client.pupPage.isClosed();
                
                // Se a página foi fechada, reinicializa o cliente
                if (!pageOpen && client.pupPage) {
                    logger.warn('Página do Puppeteer fechada, reinicializando cliente...');
                    await client.destroy();
                    await client.initialize();
                    return false;
                }

                const ready = client.info && 
                       client.pupPage && 
                       !qrCode && 
                       client.info.wid && 
                       client.info.pushname &&
                       pageOpen;

                const state = {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !qrCode,
                    pushname: client.info?.pushname,
                    wid: client.info?.wid,
                    hasPupPage: !!client.pupPage,
                    pageOpen,
                    hasQrCode: !!qrCode,
                    ready,
                    attempt: attempts + 1,
                    maxAttempts,
                    timeElapsed: attempts * checkInterval / 1000
                };

                logger.info('Verificando estado do cliente...', state);
                return ready;
            } catch (error) {
                logger.error('Erro ao verificar estado do cliente', {
                    error: error.message,
                    stack: error.stack,
                    attempt: attempts + 1
                });
                return false;
            }
        };

        while (!(await isClientReady()) && attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        if (attempts >= maxAttempts) {
            const error = new Error('Cliente não ficou pronto após o tempo máximo de espera');
            logger.error('Timeout ao aguardar cliente', {
                attempts,
                maxAttempts,
                timeElapsed: attempts * checkInterval / 1000,
                clientState: {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !qrCode,
                    hasQrCode: !!qrCode
                }
            });
            throw error;
        }

        // Aguarda mais 10 segundos após o cliente estar pronto para garantir estabilidade
        await new Promise(resolve => setTimeout(resolve, 10000));

        logger.info('Cliente pronto, iniciando teste de envio de mensagem...', {
            clientState: {
                isReady: !!client.info,
                isAuthenticated: client.pupPage && !qrCode,
                pushname: client.info?.pushname,
                wid: client.info?.wid,
                hasPupPage: !!client.pupPage,
                hasQrCode: !!qrCode,
                timeElapsed: attempts * checkInterval / 1000
            }
        });

        try {
            // Verifica se a página do Puppeteer ainda está aberta antes de enviar a mensagem
            const pageOpen = client.pupPage && !client.pupPage.isClosed();
            if (!pageOpen) {
                throw new Error('Página do Puppeteer fechada antes do envio da mensagem');
            }

            const response = await request(app)
                .post('/send-message')
                .send({
                    phone: TEST_PHONE,
                    message: TEST_MESSAGE
                })
                .expect(200);

            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('messageId');
            expect(response.body).toHaveProperty('status');
            expect(typeof response.body.messageId).toBe('string');
            expect(response.body.messageId.length).toBeGreaterThan(0);

            // Aguarda 5 segundos após o envio para garantir que a mensagem foi processada
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Erro no teste de envio de mensagem', {
                error: error.message,
                stack: error.stack,
                clientState: {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !qrCode,
                    pushname: client.info?.pushname,
                    wid: client.info?.wid,
                    hasPupPage: !!client.pupPage,
                    pageOpen: client.pupPage && !client.pupPage.isClosed(),
                    response: error.response?.body
                }
            });
            throw error;
        }
    });

    // Teste de número inválido
    test('should handle invalid phone number', async () => {
        const response = await request(app)
            .post('/send-message')
            .send({
                phone: 'invalid',
                message: TEST_MESSAGE
            })
            .expect(500);

        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toMatch(/Failed to send message/i);
    });

    // Teste de mensagem vazia
    test('should handle empty message', async () => {
        const response = await request(app)
            .post('/send-message')
            .send({
                phone: TEST_PHONE,
                message: ''
            })
            .expect(400);

        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toMatch(/Phone and message are required/i);
    });

    // Teste de número de telefone ausente
    test('should handle missing phone number', async () => {
        const response = await request(app)
            .post('/send-message')
            .send({
                message: TEST_MESSAGE
            })
            .expect(400);

        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toMatch(/Phone and message are required/i);
    });
}); 