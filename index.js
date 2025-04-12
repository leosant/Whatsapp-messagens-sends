const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const winston = require('winston');
const RetryHandler = require('./utils/retry');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: () => {
                const now = new Date();
                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const year = now.getFullYear();
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');
                return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
            }
        }),
        winston.format.printf(({ level, message, timestamp, ...metadata }) => {
            let msg = `${timestamp} [${level.toUpperCase()}] ${message}`;
            if (Object.keys(metadata).length > 0) {
                msg += ` ${JSON.stringify(metadata)}`;
            }
            return msg;
        })
    ),
    transports: [
        new winston.transports.File({ 
            filename: 'logs/whatsapp-sender.log',
            maxsize: 10000000, // 10MB
            maxFiles: 5,
            tailable: true
        }),
        new winston.transports.Console()
    ]
});

// Initialize retry handler with longer delays
const retryHandler = new RetryHandler({
    maxRetries: 3,
    initialDelay: 30000, // 30 segundos
    maxDelay: 120000, // 2 minutos
    factor: 2,
    jitter: 0.1
});

// Variável para controlar se já geramos o QR Code
let qrGenerated = false;
let lastQrTime = null;

// Armazena o último QR code gerado
let lastQrCode = null;
let authenticationStatus = {
    isAuthenticated: false,
    isReady: false,
    qrCode: null,
    isLoading: false,
    loadingPercent: null,
    loadingMessage: null
};

// Função para limpar a sessão
const clearSession = async () => {
    try {
        const sessionPath = './.wwebjs_auth';
        if (fs.existsSync(sessionPath)) {
            // Primeiro, tente matar qualquer processo do Chrome que possa estar rodando
            if (process.platform === 'win32') {
                try {
                    require('child_process').execSync('taskkill /F /IM chrome.exe');
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Aguarda processos terminarem
                } catch (error) {
                    logger.warn('Error killing Chrome processes', { error: error.message });
                }
            }
            fs.rmSync(sessionPath, { recursive: true, force: true });
            logger.info('Session cleared successfully');
            await new Promise(resolve => setTimeout(resolve, 1000)); // Aguarda limpeza completar
        }
    } catch (error) {
        logger.error('Error clearing session', { error: error.message });
        throw error;
    }
};

// Configuração do Puppeteer
const puppeteerOptions = {
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
        '--disable-extensions'
    ],
    headless: 'new', // Usando o novo modo headless
    defaultViewport: null
};

// Initialize WhatsApp client with better error handling
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-sender",
        dataPath: "./.wwebjs_auth"
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--disable-extensions'
        ],
        headless: 'new', // Usando o novo modo headless
        defaultViewport: null
    },
    restartOnAuthFail: true,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0
});

// Handle authentication failure
client.on('auth_failure', msg => {
    logger.error('Authentication failed', { message: msg });
    clearSession();
});

// Handle disconnected
client.on('disconnected', (reason) => {
    logger.error('Client was disconnected', { reason });
    clearSession();
});

// Handle QR Code
client.on('qr', (qr) => {
    lastQrCode = qr;
    authenticationStatus.qrCode = qr;
    authenticationStatus.isAuthenticated = false;
    authenticationStatus.isReady = false;
    logger.info('New QR Code generated');
    qrGenerated = true;
    lastQrTime = Date.now();
    // Mostra o QR code no terminal
    qrcode.generate(qr, { small: true });
});

// Handle authenticated
client.on('authenticated', () => {
    logger.info('Client authenticated successfully');
    lastQrCode = null;
    authenticationStatus.qrCode = null;
    authenticationStatus.isAuthenticated = true;
    authenticationStatus.isReady = false;
    qrGenerated = false;
});

// Handle ready
client.on('ready', () => {
    lastQrCode = null;
    authenticationStatus.qrCode = null;
    authenticationStatus.isAuthenticated = true;
    authenticationStatus.isReady = true;
    authenticationStatus.isLoading = false;
    authenticationStatus.loadingPercent = 100;
    qrGenerated = false;
    logger.info('Client is ready!');
    logger.info('Client info:', { 
        wid: client.info?.wid,
        pushname: client.info?.pushname,
        platform: client.info?.platform
    });
});

// Handle errors
client.on('error', async (error) => {
    logger.error('Client error', { 
        error: error.message,
        stack: error.stack,
        clientState: {
            isReady: !!client.info,
            isAuthenticated: client.pupPage && !lastQrCode,
            pushname: client.info?.pushname,
            wid: client.info?.wid,
            hasPupPage: !!client.pupPage,
            pageOpen: client.pupPage && !client.pupPage.isClosed(),
            hasQrCode: !!lastQrCode
        }
    });
    
    if (error.message.includes('logout') || error.message.includes('disconnected') || error.message.includes('session closed')) {
        try {
            await clearSession();
            await client.initialize();
        } catch (error) {
            logger.error('Failed to recover session', { 
                error: error.message,
                stack: error.stack,
                clientState: {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !lastQrCode,
                    pushname: client.info?.pushname,
                    wid: client.info?.wid
                }
            });
        }
    }
});

// Handle loading screen
client.on('loading_screen', (percent, message) => {
    logger.info('Loading screen', { percent, message });
    global.loadingScreenInfo = { percent, message };
    // Atualiza o status de autenticação
    authenticationStatus.isAuthenticated = true;
    authenticationStatus.isLoading = true;
    authenticationStatus.loadingPercent = percent;
    authenticationStatus.loadingMessage = message;
});

// Check client state periodically with smarter logic
setInterval(async () => {
    try {
        // Verifica se a página do Puppeteer ainda está aberta
        const pageOpen = client.pupPage && !client.pupPage.isClosed();
        
        // Se a página foi fechada, reinicializa o cliente
        if (!pageOpen && client.pupPage) {
            logger.warn('Página do Puppeteer fechada, reinicializando cliente...');
            await client.destroy();
            await client.initialize();
            return;
        }

        if (!client.info) {
            // Se geramos o QR Code recentemente (menos de 10 minutos), não reinicializamos
            if (qrGenerated && lastQrTime && (Date.now() - lastQrTime) < 600000) { // 10 minutos
                logger.info('Waiting for WhatsApp scan...');
                return;
            }
            
            // Se não geramos QR code ainda ou já passou muito tempo, reinicializamos
            if (!qrGenerated || (lastQrTime && (Date.now() - lastQrTime) > 600000)) {
                logger.warn('Client not ready, attempting to reinitialize...');
                await clearSession();
                await retryHandler.execute(() => client.initialize(), 'Periodic client check reinitialization');
            }
        } else {
            logger.info('Client status check - OK', {
                wid: client.info?.wid,
                pushname: client.info?.pushname,
                clientState: {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !lastQrCode,
                    pushname: client.info?.pushname,
                    wid: client.info?.wid,
                    hasPupPage: !!client.pupPage,
                    pageOpen,
                    hasQrCode: !!lastQrCode
                }
            });
        }
    } catch (error) {
        logger.error('Error in periodic client check', {
            error: error.message,
            stack: error.stack,
            clientState: {
                isReady: !!client.info,
                isAuthenticated: client.pupPage && !lastQrCode,
                pushname: client.info?.pushname,
                wid: client.info?.wid,
                hasPupPage: !!client.pupPage,
                pageOpen: client.pupPage && !client.pupPage.isClosed()
            }
        });
    }
}, 120000); // Check every 2 minutes

// Initialize client with error handling and QR wait
const initializeClient = async () => {
    try {
        logger.info('Starting client initialization...');
        
        // Verifica se já existe uma sessão
        if (fs.existsSync('./.wwebjs_auth')) {
            logger.info('Using existing session...');
        } else {
            logger.info('No existing session found, waiting for user to authenticate...');
        }
        
        await client.initialize();
        
        // Aguarda a autenticação por um tempo maior
        let authWaitAttempts = 0;
        const maxAuthWaitAttempts = 60; // 5 minutos no total
        const checkInterval = 5000; // 5 segundos
        
        while (!client.info && authWaitAttempts < maxAuthWaitAttempts) {
            const pageOpen = client.pupPage && !client.pupPage.isClosed();
            
            logger.info('Waiting for authentication...', {
                qrGenerated,
                lastQrTime,
                timeSinceLastQr: lastQrTime ? Date.now() - lastQrTime : null,
                clientState: {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !lastQrCode,
                    pushname: client.info?.pushname,
                    wid: client.info?.wid,
                    hasPupPage: !!client.pupPage,
                    pageOpen,
                    hasQrCode: !!lastQrCode,
                    attempt: authWaitAttempts + 1,
                    maxAttempts: maxAuthWaitAttempts,
                    timeElapsed: authWaitAttempts * checkInterval / 1000
                }
            });
            
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            authWaitAttempts++;
        }
        
        if (authWaitAttempts >= maxAuthWaitAttempts) {
            const error = new Error('Client did not authenticate within the maximum wait time');
            logger.error('Authentication timeout', {
                attempts: authWaitAttempts,
                maxAttempts: maxAuthWaitAttempts,
                timeElapsed: authWaitAttempts * checkInterval / 1000,
                clientState: {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !lastQrCode,
                    hasQrCode: !!lastQrCode
                }
            });
            throw error;
        }
        
        // Aguarda mais 10 segundos após a autenticação para garantir estabilidade
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        logger.info('Client initialized successfully', {
            clientState: {
                isReady: !!client.info,
                isAuthenticated: client.pupPage && !lastQrCode,
                pushname: client.info?.pushname,
                wid: client.info?.wid,
                hasPupPage: !!client.pupPage,
                pageOpen: client.pupPage && !client.pupPage.isClosed(),
                hasQrCode: !!lastQrCode
            }
        });
    } catch (error) {
        logger.error('Failed to initialize client', {
            error: error.message,
            stack: error.stack,
            clientState: {
                isReady: !!client.info,
                isAuthenticated: client.pupPage && !lastQrCode,
                pushname: client.info?.pushname,
                wid: client.info?.wid,
                hasPupPage: !!client.pupPage,
                pageOpen: client.pupPage && !client.pupPage.isClosed()
            }
        });
        throw error;
    }
};

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

// Rota para enviar mensagem
app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;

        phone = '+5561984245554';

        // Validação dos campos
        if (!phone || !message) {
            logger.warn('Missing required fields', { 
                phone: !!phone,
                message: !!message,
                clientState: {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !lastQrCode,
                    pushname: client.info?.pushname,
                    wid: client.info?.wid
                }
            });
            return res.status(400).json({ 
                error: 'Phone and message are required',
                success: false
            });
        }

        // Verifica se o cliente está pronto
        if (!client.info || !client.pupPage || lastQrCode) {
            logger.warn('Client not ready for sending messages', {
                phone,
                clientState: {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !lastQrCode,
                    pushname: client.info?.pushname,
                    wid: client.info?.wid,
                    hasPupPage: !!client.pupPage,
                    pageOpen: client.pupPage && !client.pupPage.isClosed(),
                    hasQrCode: !!lastQrCode
                }
            });
            return res.status(503).json({ 
                error: 'WhatsApp client is not ready. Please try again later.',
                success: false
            });
        }

        // Verifica se a página do Puppeteer ainda está aberta
        const pageOpen = client.pupPage && !client.pupPage.isClosed();
        if (!pageOpen) {
            logger.error('Puppeteer page closed while sending message', {
                phone,
                clientState: {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !lastQrCode,
                    pushname: client.info?.pushname,
                    wid: client.info?.wid,
                    hasPupPage: !!client.pupPage,
                    pageOpen
                }
            });
            return res.status(503).json({ 
                error: 'WhatsApp client connection lost. Please try again later.',
                success: false
            });
        }

        // Formata o número de telefone
        const formattedPhone = phone.replace(/\D/g, '') + '@c.us';
        
        logger.info('Attempting to send message', {
            phone: formattedPhone,
            messageLength: message.length,
            clientState: {
                isReady: !!client.info,
                isAuthenticated: client.pupPage && !lastQrCode,
                pushname: client.info?.pushname,
                wid: client.info?.wid,
                hasPupPage: !!client.pupPage,
                pageOpen
            }
        });

        // Verifica se o número existe no WhatsApp
        const numberExists = await client.isRegisteredUser(formattedPhone);
        if (!numberExists) {
            logger.warn('Phone number not registered on WhatsApp', {
                phone: formattedPhone,
                clientState: {
                    isReady: !!client.info,
                    isAuthenticated: client.pupPage && !lastQrCode,
                    pushname: client.info?.pushname,
                    wid: client.info?.wid
                }
            });
            return res.status(404).json({ 
                error: 'Phone number not registered on WhatsApp',
                success: false
            });
        }

        // Envia a mensagem
        const result = await client.sendMessage(formattedPhone, message);
        
        // Aguarda um tempo para garantir que a mensagem foi processada
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verifica o status da mensagem
        const messageStatus = await result.getInfo();
        
        logger.info('Message sent successfully', {
            phone: formattedPhone,
            messageId: result.id._serialized,
            status: messageStatus,
            clientState: {
                isReady: !!client.info,
                isAuthenticated: client.pupPage && !lastQrCode,
                pushname: client.info?.pushname,
                wid: client.info?.wid,
                hasPupPage: !!client.pupPage,
                pageOpen
            }
        });

        res.json({
            success: true,
            messageId: result.id._serialized,
            status: messageStatus,
            to: formattedPhone
        });
    } catch (error) {
        logger.error('Error sending message', {
            error: error.message,
            stack: error.stack,
            phone: req.body.phone,
            clientState: {
                isReady: !!client.info,
                isAuthenticated: client.pupPage && !lastQrCode,
                pushname: client.info?.pushname,
                wid: client.info?.wid,
                hasPupPage: !!client.pupPage,
                pageOpen: client.pupPage && !client.pupPage.isClosed()
            }
        });
        
        res.status(500).json({ 
            error: 'Failed to send message',
            success: false
        });
    }
});

// API endpoint para verificar status da conexão
app.get('/connection-status', (req, res) => {
    try {
        const isConnected = !!client.info;
        const isAuthenticated = client.pupPage && !qrGenerated; // Verifica se está autenticado
        const isReady = isConnected && isAuthenticated && client.info?.pushname;

        res.json({ 
            connected: isReady,
            info: isConnected ? {
                name: client.info.pushname,
                phone: client.info.wid.user,
                status: isReady ? 'ready' : (isAuthenticated ? 'authenticated' : 'pending')
            } : null
        });
    } catch (error) {
        logger.error('Error checking connection status', { error: error.message });
        res.json({ connected: false });
    }
});

// API endpoint para limpar a sessão
app.post('/clear-session', async (req, res) => {
    try {
        await clearSession();
        await client.initialize();
        res.json({ success: true });
    } catch (error) {
        logger.error('Error clearing session', { error: error.message });
        res.status(500).json({ error: 'Failed to clear session' });
    }
});

// Rota para abrir o WhatsApp Web
app.post('/open', async (req, res) => {
    try {
        logger.info('Opening WhatsApp Web...');
        await clearSession(); // Limpa a sessão antes de inicializar
        await initializeClient();
        res.json({ success: true, message: 'WhatsApp Web initialized' });
    } catch (error) {
        logger.error('Error opening WhatsApp Web', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rota para verificar o status
app.get('/status', (req, res) => {
    try {
        if (!client.info) {
            if (qrGenerated) {
                res.json({ status: 'pending', message: 'Aguardando autenticação...' });
            } else {
                res.json({ status: 'disconnected', message: 'Desconectado' });
            }
        } else {
            res.json({
                status: 'connected',
                user: {
                    name: client.info.pushname,
                    phone: client.info.wid.user
                }
            });
        }
    } catch (error) {
        logger.error('Error checking status', { error: error.message });
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Adiciona endpoint para status e QR code
app.get('/api/status', (req, res) => {
    res.json({
        status: {
            isAuthenticated: authenticationStatus.isAuthenticated,
            isReady: authenticationStatus.isReady,
            isLoading: authenticationStatus.isLoading,
            qrCode: lastQrCode,
            loadingPercent: authenticationStatus.loadingPercent || 0,
            loadingMessage: authenticationStatus.loadingMessage || ''
        }
    });
});

// Start server with better error handling
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Access the interface at: http://localhost:${PORT}`);
}).on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use. Trying alternative port...`);
        const newPort = PORT + 1;
        app.listen(newPort, () => {
            logger.info(`Server running on alternative port ${newPort}`);
            logger.info(`Access the interface at: http://localhost:${newPort}`);
        });
    } else {
        logger.error('Server error:', error);
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // Don't exit the process, just log the error
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received. Closing server...');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT signal received. Closing server...');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

// Inicializa o cliente imediatamente
(async () => {
    try {
        // Limpa a sessão antes de iniciar
        await clearSession();
        
        // Inicializa o cliente
        await client.initialize();
        logger.info('Cliente inicializado com sucesso');
        
        // Força a geração do QR code se necessário
        if (!authenticationStatus.isAuthenticated && !authenticationStatus.qrCode) {
            logger.info('Forçando geração do QR code...');
            await client.destroy();
            await client.initialize();
        }
    } catch (error) {
        logger.error('Erro ao inicializar o cliente', { 
            error: error.message,
            stack: error.stack,
            type: error.constructor.name
        });
    }
})(); 