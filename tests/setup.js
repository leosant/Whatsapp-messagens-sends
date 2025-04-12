const { jest } = require('@jest/globals');

// Configuração global para os testes
jest.setTimeout(120000); // 2 minutos

const fs = require('fs');
const path = require('path');

// Limpa a sessão de teste antes de iniciar
beforeAll(async () => {
    const testSessionPath = './.wwebjs_auth_test';
    if (fs.existsSync(testSessionPath)) {
        try {
            // Tenta matar qualquer processo do Chrome que possa estar rodando
            if (process.platform === 'win32') {
                try {
                    require('child_process').execSync('taskkill /F /IM chrome.exe');
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Aguarda processos terminarem
                } catch (error) {
                    console.warn('Error killing Chrome processes:', error.message);
                }
            }
            
            // Tenta remover o diretório várias vezes com delay
            let attempts = 0;
            const maxAttempts = 5;
            const delay = 1000;
            
            while (attempts < maxAttempts) {
                try {
                    fs.rmSync(testSessionPath, { recursive: true, force: true });
                    break;
                } catch (error) {
                    attempts++;
                    if (attempts === maxAttempts) {
                        console.error('Failed to remove test session directory after multiple attempts:', error);
                        throw error;
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        } catch (error) {
            console.error('Error cleaning up test session:', error);
            throw error;
        }
    }
});

// Limpa a sessão após os testes
afterAll(async () => {
    const testSessionPath = './.wwebjs_auth_test';
    if (fs.existsSync(testSessionPath)) {
        try {
            // Tenta matar qualquer processo do Chrome que possa estar rodando
            if (process.platform === 'win32') {
                try {
                    require('child_process').execSync('taskkill /F /IM chrome.exe');
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Aguarda processos terminarem
                } catch (error) {
                    console.warn('Error killing Chrome processes:', error.message);
                }
            }
            
            // Tenta remover o diretório várias vezes com delay
            let attempts = 0;
            const maxAttempts = 5;
            const delay = 1000;
            
            while (attempts < maxAttempts) {
                try {
                    fs.rmSync(testSessionPath, { recursive: true, force: true });
                    break;
                } catch (error) {
                    attempts++;
                    if (attempts === maxAttempts) {
                        console.error('Failed to remove test session directory after multiple attempts:', error);
                        throw error;
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        } catch (error) {
            console.error('Error cleaning up test session:', error);
            throw error;
        }
    }
});

// Mock do localStorage
const localStorageMock = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
};

// Mock do sessionStorage
const sessionStorageMock = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
};

// Mock do ResizeObserver
const resizeObserverMock = jest.fn(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
}));

// Configuração do ambiente de teste
Object.defineProperty(global, 'localStorage', { value: localStorageMock });
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock });
Object.defineProperty(global, 'ResizeObserver', { value: resizeObserverMock });

// Mock do console para testes mais limpos
global.console = {
    ...console,
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
}; 