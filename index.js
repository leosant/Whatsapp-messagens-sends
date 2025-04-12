const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');
const RetryHandler = require('./utils/retry');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize retry handler with longer delays
const retryHandler = new RetryHandler({
    maxRetries: 5,
    initialDelay: 10000, // 10 segundos
    maxDelay: 60000, // 1 minuto
    factor: 2,
    jitter: 0.1
});

// Variável para controlar se já geramos o QR Code
let qrGenerated = false;
let lastQrTime = null;

// Função para limpar a sessão
const clearSession = () => {
    try {
        const sessionPath = './.wwebjs_auth';
        if (fs.existsSync(sessionPath)) {
            // Primeiro, tente matar qualquer processo do Chrome que possa estar rodando
            if (process.platform === 'win32') {
                require('child_process').execSync('taskkill /F /IM chrome.exe');
            }
            fs.rmSync(sessionPath, { recursive: true, force: true });
            logger.info('Session cleared successfully');
        }
    } catch (error) {
        logger.error('Error clearing session', { error: error.message });
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
        '--no-zygote',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-software-rasterizer',
        '--disable-features=site-per-process',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
        '--window-size=1920,1080'
    ],
    headless: false, // Modo visual
    ignoreDefaultArgs: ['--disable-extensions'],
    executablePath: process.platform === 'win32' 
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : undefined
};

// Initialize WhatsApp client with better error handling
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-sender",
        dataPath: "./.wwebjs_auth"
    }),
    puppeteer: puppeteerOptions,
    restartOnAuthFail: true,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0
});

// Handle authentication failure
client.on('auth_failure', msg => {
    logger.error('Authentication failed', { message: msg });
    clearSession();
    retryHandler.execute(() => client.initialize(), 'Client initialization after auth failure');
});

// Handle disconnected
client.on('disconnected', (reason) => {
    logger.warn('Client was disconnected', { reason });
    clearSession();
    retryHandler.execute(() => client.initialize(), 'Client initialization after disconnect');
});

// Handle QR Code
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    logger.info('QR Code generated. Please scan with your WhatsApp.');
    qrGenerated = true;
    lastQrTime = Date.now();
});

// When client is ready
client.on('ready', () => {
    logger.info('Client is ready!');
    logger.info('Client info:', { 
        wid: client.info?.wid,
        pushname: client.info?.pushname,
        platform: client.info?.platform
    });
    qrGenerated = false; // Reset QR flag
});

// Handle errors
client.on('error', (error) => {
    logger.error('Client error', { error: error.message });
    if (error.message.includes('logout') || error.message.includes('disconnected')) {
        clearSession();
        retryHandler.execute(() => client.initialize(), 'Client initialization after error');
    }
});

// Handle loading screen
client.on('loading_screen', (percent, message) => {
    logger.info('Loading screen', { percent, message });
});

// Handle authenticated
client.on('authenticated', () => {
    logger.info('Client authenticated successfully');
});

// Handle auth_failure
client.on('auth_failure', (msg) => {
    logger.error('Authentication failed', { message: msg });
});

// Check client state periodically with smarter logic
setInterval(() => {
    if (!client.info) {
        // Se geramos o QR Code recentemente (menos de 2 minutos), não reinicializamos
        if (qrGenerated && lastQrTime && (Date.now() - lastQrTime) < 120000) {
            logger.info('Waiting for WhatsApp scan...');
            return;
        }
        
        logger.warn('Client not ready, attempting to reinitialize...');
        clearSession();
        retryHandler.execute(() => client.initialize(), 'Periodic client check reinitialization');
    } else {
        logger.info('Client status check - OK', {
            wid: client.info?.wid,
            pushname: client.info?.pushname
        });
    }
}, 30000); // Check every 30 seconds

// Initialize client with error handling and QR wait
const initializeClient = async () => {
    try {
        // Clear any existing session first
        clearSession();
        
        // Wait a bit before initializing
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        logger.info('Starting client initialization...');
        await retryHandler.execute(() => client.initialize(), 'Initial client initialization');
        
        // Wait for QR code to be generated
        let qrWaitAttempts = 0;
        const maxQrWaitAttempts = 6; // 30 segundos no total
        
        while (!qrGenerated && qrWaitAttempts < maxQrWaitAttempts) {
            logger.info('Waiting for QR code generation...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            qrWaitAttempts++;
        }
        
        if (!qrGenerated) {
            throw new Error('QR code not generated within expected time');
        }
        
    } catch (error) {
        logger.error('Failed to initialize client', { error: error.message });
        clearSession();
        retryHandler.execute(() => client.initialize(), 'Client initialization after failure');
    }
};

initializeClient();

// API endpoint to send messages
app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!phone || !message) {
            logger.warn('Invalid request parameters', { phone, message });
            return res.status(400).json({ error: 'Phone and message are required' });
        }

        // Check if client is ready
        if (!client.info) {
            logger.warn('Client not ready for message sending');
            return res.status(503).json({ 
                error: 'WhatsApp client is not ready. Please wait and try again.',
                status: 'not_ready'
            });
        }

        // Format phone number to WhatsApp format
        const formattedPhone = phone.replace(/\D/g, '');
        const chatId = `${formattedPhone}@c.us`;

        logger.info('Attempting to send message', { 
            phone: formattedPhone,
            chatId: chatId,
            clientInfo: client.info
        });

        // Send message with retry
        await retryHandler.execute(
            () => client.sendMessage(chatId, message),
            `Sending message to ${formattedPhone}`
        );
        
        logger.info('Message sent successfully', { phone: formattedPhone });
        res.json({ success: true, message: 'Message sent successfully' });
    } catch (error) {
        logger.error('Error sending message', { 
            error: error.message,
            phone: req.body.phone,
            stack: error.stack
        });
        
        if (error.message.includes('not connected') || error.message.includes('logout')) {
            clearSession();
            retryHandler.execute(() => client.initialize(), 'Client initialization after message send failure');
            return res.status(503).json({ 
                error: 'WhatsApp client disconnected. Reinitializing...',
                status: 'reconnecting'
            });
        }
        
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Access the interface at: http://localhost:${PORT}`);
}); 