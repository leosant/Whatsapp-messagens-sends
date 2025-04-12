// Configuração
const API_URL = '/api';
let checkStatusInterval;

// Elementos da interface
const statusBadge = document.querySelector('.status-badge');
const statusText = document.getElementById('statusText');
const qrCodeContainer = document.getElementById('qrCodeContainer');
const qrCodeCanvas = document.getElementById('qrCodeCanvas');
const messageForm = document.getElementById('messageForm');
const authLoadingContainer = document.getElementById('authLoadingContainer');
const loadingText = document.getElementById('loadingText');
const loadingPercent = document.getElementById('loadingPercent');

// Função para atualizar o status da conexão
function updateConnectionStatus(status) {
    console.log('Atualizando status:', status);
    
    // Remove classes anteriores
    statusBadge.classList.remove('connected', 'disconnected', 'authenticating');
    
    // Adiciona a classe apropriada e atualiza o texto
    if (status.isReady) {
        statusBadge.classList.add('connected');
        statusText.textContent = 'Conectado';
        qrCodeContainer.style.display = 'none';
        authLoadingContainer.style.display = 'none';
        messageForm.style.display = 'block';
    } else if (status.isAuthenticated) {
        statusBadge.classList.add('authenticating');
        statusText.textContent = status.isLoading ? 'Iniciando WhatsApp...' : 'Autenticando...';
        messageForm.style.display = 'none';
        qrCodeContainer.style.display = 'block';
        
        // Se estiver carregando, mostra o loading
        if (status.isLoading) {
            authLoadingContainer.style.display = 'block';
            if (status.loadingPercent !== undefined) {
                loadingPercent.textContent = `${status.loadingPercent}%`;
                if (status.loadingMessage) {
                    loadingText.textContent = status.loadingMessage;
                }
            }
        } else {
            authLoadingContainer.style.display = 'none';
        }
    } else {
        statusBadge.classList.add('disconnected');
        statusText.textContent = status.qrCode ? 'Escaneie o QR Code' : 'Aguardando QR Code...';
        messageForm.style.display = 'none';
        authLoadingContainer.style.display = 'none';
        
        // Se temos um QR code, mostra o container
        if (status.qrCode) {
            qrCodeContainer.style.display = 'block';
        }
    }
}

// Função para gerar o QR Code
function generateQRCode(qrCode) {
    console.log('Gerando QR code:', qrCode);
    const qrCodeContainer = document.getElementById('qrCodeContainer');
    const qrCodeWrapper = document.querySelector('.qr-code-wrapper');
    
    // Limpa o container antes de gerar um novo QR code
    while (qrCodeWrapper.firstChild) {
        qrCodeWrapper.removeChild(qrCodeWrapper.firstChild);
    }

    // Cria um novo elemento div para o QR code
    const qrElement = document.createElement('div');
    qrCodeWrapper.appendChild(qrElement);

    // Gera o QR code
    new QRCode(qrElement, {
        text: qrCode,
        width: 300,
        height: 300,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    // Mostra o container do QR code
    qrCodeContainer.style.display = 'block';
    console.log('QR code gerado com sucesso!');
}

// Função para verificar o status
async function checkStatus() {
    try {
        console.log('Verificando status...');
        const response = await fetch(`${API_URL}/status`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        console.log('Status recebido:', data);
        
        // Atualiza o status na interface
        if (data && data.status) {
            updateConnectionStatus(data.status);
            
            // Se temos um QR code e não estamos carregando, tenta gerá-lo
            if (data.status.qrCode && !data.status.isLoading) {
                console.log('QR code recebido, gerando...');
                generateQRCode(data.status.qrCode);
            } else if (!data.status.qrCode && !data.status.isLoading && !data.status.isReady) {
                console.log('Nenhum QR code recebido');
                qrCodeContainer.style.display = 'none';
            }
            
            // Se estiver pronto, para de verificar o status
            if (data.status.isReady) {
                console.log('Cliente pronto, parando verificação de status');
                clearInterval(checkStatusInterval);
            }
        }
    } catch (error) {
        console.error('Erro ao verificar status:', error);
        statusBadge.classList.remove('connected', 'authenticating');
        statusBadge.classList.add('disconnected');
        statusText.textContent = 'Erro ao conectar';
        authLoadingContainer.style.display = 'none';
    }
}

// Inicia a verificação do status
function startStatusCheck() {
    console.log('Iniciando verificação de status...');
    
    // Verifica o status imediatamente
    checkStatus();
    
    // Configura o intervalo para verificar a cada 2 segundos
    checkStatusInterval = setInterval(checkStatus, 2000);
}

// Evento de envio do formulário
messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const phone = document.getElementById('phone').value;
    const message = document.getElementById('message').value;
    
    try {
        const response = await fetch(`${API_URL}/send-message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ phone, message })
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('response').innerHTML = `
                <div class="alert alert-success">
                    Mensagem enviada com sucesso!
                </div>
            `;
        } else {
            document.getElementById('response').innerHTML = `
                <div class="alert alert-danger">
                    Erro ao enviar mensagem: ${data.error}
                </div>
            `;
        }
    } catch (error) {
        document.getElementById('response').innerHTML = `
            <div class="alert alert-danger">
                Erro ao enviar mensagem: ${error.message}
            </div>
        `;
    }
});

// Inicia a verificação do status quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
    console.log('Página carregada, iniciando serviço...');
    startStatusCheck();
}); 