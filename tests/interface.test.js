const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { expect } = require('@jest/globals');

describe('Interface Tests', () => {
    let dom;
    let document;
    let window;
    let container;

    // Função auxiliar para simular resposta da API
    function mockFetch(status) {
        return Promise.resolve({
            json: () => Promise.resolve({ status })
        });
    }

    beforeEach(() => {
        // Carrega o HTML
        const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
        dom = new JSDOM(html, {
            runScripts: 'dangerously',
            resources: 'usable',
            pretendToBeVisual: true
        });

        // Configura o ambiente
        window = dom.window;
        document = window.document;
        container = document.body;

        // Mock das funções globais
        global.window = window;
        global.document = document;
        global.fetch = jest.fn();
        global.QRCode = {
            toCanvas: jest.fn((canvas, code, options, callback) => {
                callback(null);
            })
        };

        // Carrega os scripts necessários
        const servicesScript = fs.readFileSync(path.resolve(__dirname, '../public/js/services.js'), 'utf8');
        const scriptElement = document.createElement('script');
        scriptElement.textContent = servicesScript;
        document.body.appendChild(scriptElement);
    });

    afterEach(() => {
        jest.resetAllMocks();
    });

    test('deve exibir os elementos iniciais corretamente', () => {
        expect(document.querySelector('h2').textContent).toBe('WhatsApp Sender');
        expect(document.querySelector('.status-badge')).toBeTruthy();
        expect(document.querySelector('#qrCodeContainer')).toBeTruthy();
        expect(document.querySelector('#messageForm')).toBeTruthy();
    });

    test('deve mostrar status inicial como "Aguardando QR Code"', () => {
        const statusText = document.querySelector('#statusText');
        expect(statusText.textContent).toBe('Aguardando QR Code...');
        expect(document.querySelector('.status-badge').classList.contains('disconnected')).toBeTruthy();
    });

    test('deve exibir QR code quando recebido', async () => {
        // Mock da resposta da API com QR code
        global.fetch.mockImplementationOnce(() => mockFetch({
            isReady: false,
            isAuthenticated: false,
            qrCode: 'test-qr-code'
        }));

        // Dispara a verificação de status
        await window.checkStatus();

        // Verifica se o QR code foi gerado
        expect(global.QRCode.toCanvas).toHaveBeenCalled();
        expect(document.querySelector('#qrCodeContainer').style.display).toBe('block');
        expect(document.querySelector('#statusText').textContent).toBe('Escaneie o QR Code');
    });

    test('deve mostrar status de autenticação', async () => {
        // Mock da resposta da API com status autenticado
        global.fetch.mockImplementationOnce(() => mockFetch({
            isReady: false,
            isAuthenticated: true,
            qrCode: null
        }));

        // Dispara a verificação de status
        await window.checkStatus();

        // Verifica o estado de autenticação
        expect(document.querySelector('.status-badge').classList.contains('authenticating')).toBeTruthy();
        expect(document.querySelector('#statusText').textContent).toBe('Autenticando...');
        expect(document.querySelector('#qrCodeContainer').style.display).toBe('none');
    });

    test('deve mostrar interface de envio quando conectado', async () => {
        // Mock da resposta da API com status pronto
        global.fetch.mockImplementationOnce(() => mockFetch({
            isReady: true,
            isAuthenticated: true,
            qrCode: null
        }));

        // Dispara a verificação de status
        await window.checkStatus();

        // Verifica se a interface de envio está visível
        expect(document.querySelector('.status-badge').classList.contains('connected')).toBeTruthy();
        expect(document.querySelector('#statusText').textContent).toBe('Conectado');
        expect(document.querySelector('#messageForm').style.display).toBe('block');
        expect(document.querySelector('#qrCodeContainer').style.display).toBe('none');
    });

    test('deve validar campos do formulário', () => {
        const form = document.querySelector('#messageForm');
        const phoneInput = document.querySelector('#phone');
        const messageInput = document.querySelector('#message');

        // Verifica validação do número de telefone
        phoneInput.value = 'abc';
        expect(phoneInput.checkValidity()).toBeFalsy();

        phoneInput.value = '61999999999';
        expect(phoneInput.checkValidity()).toBeTruthy();

        // Verifica campo de mensagem obrigatório
        expect(messageInput.required).toBeTruthy();
    });

    test('deve exibir mensagem de erro quando a API falha', async () => {
        // Mock de erro na API
        global.fetch.mockImplementationOnce(() => Promise.reject(new Error('Erro de conexão')));

        // Dispara a verificação de status
        await window.checkStatus();

        // Verifica se mantém o estado desconectado
        expect(document.querySelector('.status-badge').classList.contains('disconnected')).toBeTruthy();
        expect(document.querySelector('#statusText').textContent).toBe('Aguardando QR Code...');
    });
}); 