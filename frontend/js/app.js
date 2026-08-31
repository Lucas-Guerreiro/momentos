// Constantes da API (usa caminho relativo para funcionar em qualquer host/porta)
const API_BASE = window.location.origin;

// Variáveis de Estado
let cameras = [];
let clips = [];
let controlBindings = []; // { camera_id, binding_type, key, gamepad_index, button_index }
let listeningCameraId = null; // Câmera que está aguardando mapeamento de tecla/botão
let editingCameraId = null; // Câmera que está sendo editada

// Estado anterior do Gamepad para detecção de clique único (edge trigger)
let lastGamepadState = [];

// Elementos do DOM
const navItems = document.querySelectorAll('.nav-item');
const pageSections = document.querySelectorAll('.page-section');
const feedsGrid = document.getElementById('feeds-grid');
const addCameraForm = document.getElementById('add-camera-form');
const cameraListContainer = document.getElementById('camera-list-container');
const mappingTableBody = document.getElementById('mapping-table-body');
const btnSaveControls = document.getElementById('btn-save-controls');
const clipsGridContainer = document.getElementById('clips-grid-container');
const btnRefreshGallery = document.getElementById('btn-refresh-gallery');

// Inputs de tempos
const configBefore = document.getElementById('config-before');
const configAfter = document.getElementById('config-after');

// Elementos do Modal do Player
const playerModal = document.getElementById('player-modal');
const previewVideo = document.getElementById('preview-video');
const playerPlayBtn = document.getElementById('player-play');
const playerPrevFrameBtn = document.getElementById('player-prev-frame');
const playerNextFrameBtn = document.getElementById('player-next-frame');
const playerLoopBtn = document.getElementById('player-loop');
const playerProgress = document.getElementById('player-progress');
const playerTime = document.getElementById('player-time');
const playerVolume = document.getElementById('player-volume');
const speedButtons = document.querySelectorAll('.speed-btn');
const playerVideoTitle = document.getElementById('player-video-title');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnDownloadClip = document.getElementById('btn-download-clip');
const btnDeleteClip = document.getElementById('btn-delete-clip');
const toastElement = document.getElementById('toast');

let activeClipFilename = null;

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    loadCameras();
    loadBindings();
    loadClips();
    setupGamepadLoop();
    setupKeyboardListeners();
    setupPlayerEventListeners();
    detectDeviceCameras();

    // Configura o seletor de som de confirmação
    const soundSelect = document.getElementById('config-sound-select');
    if (soundSelect) {
        const savedSound = localStorage.getItem('selectedSound') || 'arcade';
        soundSelect.value = savedSound;
        
        soundSelect.addEventListener('change', () => {
            localStorage.setItem('selectedSound', soundSelect.value);
            playBeepSound(); // Toca uma demonstração do som escolhido
        });
    }

    // Inicializa os tempos com os valores salvos no localStorage
    if (configBefore && configAfter) {
        configBefore.value = localStorage.getItem('configBefore') || '5';
        configAfter.value = localStorage.getItem('configAfter') || '3';
    }

    // Configura o botão de salvar tempos de recorte
    const btnSaveTimes = document.getElementById('btn-save-times');
    if (btnSaveTimes) {
        btnSaveTimes.addEventListener('click', () => {
            const beforeVal = configBefore.value || '5';
            const afterVal = configAfter.value || '3';
            localStorage.setItem('configBefore', beforeVal);
            localStorage.setItem('configAfter', afterVal);
            showToast(`Tempos de recorte salvos com sucesso!`);
        });
    }

    // Gerencia a visibilidade do campo manual de câmera
    const selectCamSource = document.getElementById('cam-source-select');
    const groupCamSourceManual = document.getElementById('cam-source-manual-group');
    const inputCamSourceManual = document.getElementById('cam-source-manual');
    
    selectCamSource.addEventListener('change', () => {
        if (selectCamSource.value === 'custom') {
            groupCamSourceManual.style.display = 'block';
            inputCamSourceManual.required = true;
        } else {
            groupCamSourceManual.style.display = 'none';
            inputCamSourceManual.required = false;
        }
    });

    // Eventos de formulário e botões
    addCameraForm.addEventListener('submit', handleAddCamera);
    btnSaveControls.addEventListener('click', saveBindings);
    btnRefreshGallery.addEventListener('click', loadClips);

    // Eventos do Modal de QR Code para Atletas
    setupQrModalListeners();
});

// --- Modal de QR Code para Atletas ---
function setupQrModalListeners() {
    const btnShowQr = document.getElementById('btn-show-qr');
    const qrModal = document.getElementById('qr-modal');
    const btnCloseQrModal = document.getElementById('btn-close-qr-modal');
    const btnCopyAthleteUrl = document.getElementById('btn-copy-athlete-url');
    const inputAthleteUrl = document.getElementById('input-athlete-url');
    const qrCanvasContainer = document.getElementById('qr-code-canvas-container');

    if (!btnShowQr || !qrModal) return;

    btnShowQr.addEventListener('click', async () => {
        // Fallback imediato baseado no endereço que o navegador já está acessando
        let athleteUrl = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '8000'}/atleta`;
        
        try {
            const response = await fetch(`${API_BASE}/api/system/network`);
            if (response.ok) {
                const netData = await response.json();
                if (netData.athlete_url) {
                    athleteUrl = netData.athlete_url;
                }
            }
        } catch (error) {
            console.warn("Aviso: usando hostname atual como fallback para o QR Code:", error);
        }

        // Atualiza a URL no input e link
        inputAthleteUrl.value = athleteUrl;
        const btnOpenAthlete = document.getElementById('btn-open-athlete-portal');
        if (btnOpenAthlete) btnOpenAthlete.href = athleteUrl;
        
        // Renderiza o QR Code usando a biblioteca offline
        if (window.QRCodeGenerator) {
            try {
                QRCodeGenerator.renderCanvas(qrCanvasContainer, athleteUrl, 200);
            } catch(e) {
                console.error("Erro ao desenhar QR Code:", e);
            }
        }

        qrModal.classList.add('active');
    });

    btnCloseQrModal.addEventListener('click', () => {
        qrModal.classList.remove('active');
    });

    qrModal.addEventListener('click', (e) => {
        if (e.target === qrModal) {
            qrModal.classList.remove('active');
        }
    });

    btnCopyAthleteUrl.addEventListener('click', () => {
        if (inputAthleteUrl.value) {
            navigator.clipboard.writeText(inputAthleteUrl.value).then(() => {
                showToast("Link copiado para a área de transferência!");
            }).catch(() => {
                showToast("Link selecionado: " + inputAthleteUrl.value);
            });
        }
    });
}

// --- Navegação entre Abas ---
function initNavigation() {
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetId = item.getAttribute('data-target');
            if (!targetId) return; // Permite links externos como o Portal do Atleta
            
            e.preventDefault();
            
            navItems.forEach(nav => nav.classList.remove('active'));
            pageSections.forEach(sec => sec.classList.remove('active'));
            
            item.classList.add('active');
            const targetElem = document.getElementById(targetId);
            if (targetElem) {
                targetElem.classList.add('active');
            }

            if (targetId === 'galeria-view') {
                loadClips();
            } else if (targetId === 'dashboard-view' || targetId === 'cameras-view') {
                loadCameras();
            } else if (targetId === 'controles-view') {
                loadBindings();
            }
        });
    });
}

// --- Exibição de Notificações (Toast) ---
function showToast(message, isError = false) {
    toastElement.textContent = message;
    if (isError) {
        toastElement.style.background = 'rgba(244, 63, 94, 0.9)';
    } else {
        toastElement.style.background = 'rgba(16, 185, 129, 0.9)';
    }
    toastElement.classList.add('show');
    setTimeout(() => {
        toastElement.classList.remove('show');
    }, 4000);
}

// --- Câmeras ---
async function loadCameras() {
    try {
        const response = await fetch(`${API_BASE}/api/cameras`);
        cameras = await response.json();
        renderFeeds();
        renderCameraList();
        renderMappingTable();
    } catch (error) {
        console.error("Erro ao carregar câmeras:", error);
    }
}

async function detectDeviceCameras() {
    const selectCamSource = document.getElementById('cam-source-select');
    if (!selectCamSource) return;

    try {
        const response = await fetch(`${API_BASE}/api/devices/cameras`);
        if (response.ok) {
            const detectedCams = await response.json();
            
            selectCamSource.innerHTML = `
                <option value="" disabled selected>Selecione uma câmera USB...</option>
                <option value="custom">-- Câmera IP / RTSP / Arquivo Customizado --</option>
            `;
            
            if (detectedCams.length > 0) {
                detectedCams.forEach(dev => {
                    const opt = document.createElement('option');
                    opt.value = dev.id;
                    opt.textContent = dev.name;
                    selectCamSource.appendChild(opt);
                });
            }
        }
    } catch (error) {
        console.error("Erro ao detectar dispositivos de câmera:", error);
    }
}

async function handleAddCamera(e) {
    e.preventDefault();
    const name = document.getElementById('cam-name').value;
    const selectCamSource = document.getElementById('cam-source-select');
    const inputCamSourceManual = document.getElementById('cam-source-manual');
    
    const source = selectCamSource.value === 'custom' ? inputCamSourceManual.value : selectCamSource.value;
    
    if (!source) {
        showToast("Selecione ou insira uma fonte de vídeo válida.", true);
        return;
    }
    
    const fps = parseInt(document.getElementById('cam-fps').value);
    const buffer_seconds = parseInt(document.getElementById('cam-buffer').value);

    try {
        let response;
        if (editingCameraId) {
            // Modo Edição (PUT)
            response = await fetch(`${API_BASE}/api/cameras/${editingCameraId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, source, fps, buffer_seconds })
            });
        } else {
            // Modo Criação (POST)
            response = await fetch(`${API_BASE}/api/cameras`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, source, fps, buffer_seconds })
            });
        }
        
        if (response.ok) {
            if (editingCameraId) {
                showToast(`Câmera "${name}" atualizada com sucesso!`);
                cancelEdit();
            } else {
                showToast(`Câmera "${name}" adicionada com sucesso!`);
                addCameraForm.reset();
                document.getElementById('cam-source-manual-group').style.display = 'none';
            }
            loadCameras();
            detectDeviceCameras();
        } else {
            const err = await response.json();
            showToast(`Erro: ${err.detail}`, true);
        }
    } catch (error) {
        showToast("Erro ao conectar com o servidor.", true);
    }
}

async function deleteCamera(camId) {
    if (!confirm("Tem certeza que deseja excluir esta câmera?")) return;
    try {
        const response = await fetch(`${API_BASE}/api/cameras/${camId}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            showToast("Câmera removida com sucesso!");
            
            // Remove possíveis mapeamentos órfãos
            controlBindings = controlBindings.filter(b => b.camera_id !== camId);
            saveBindings();
            
            loadCameras();
        } else {
            showToast("Erro ao remover câmera.", true);
        }
    } catch (error) {
        showToast("Erro ao conectar com o servidor.", true);
    }
}

function renderFeeds() {
    if (cameras.length === 0) {
        feedsGrid.innerHTML = `
            <div class="glass-card" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                <p class="text-muted">Nenhuma câmera configurada. Vá até a aba "Câmeras" para cadastrar.</p>
            </div>
        `;
        return;
    }

    feedsGrid.innerHTML = cameras.map(cam => {
        const feedUrl = cam.active ? `${API_BASE}/api/cameras/${cam.id}/stream` : '';
        const statusText = cam.active ? 'Ao Vivo' : 'Inativa';
        const dotClass = cam.active ? 'status-dot active' : 'status-dot';
        
        return `
            <div class="glass-card camera-card" id="card-${cam.id}">
                <div class="card-header">
                    <h3 class="card-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--primary);">
                            <path d="M23 7l-7 5 7 5V7z"></path>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                        ${cam.name}
                    </h3>
                    <div class="status-badge">
                        <div class="${dotClass}" id="dot-${cam.id}"></div>
                        <span id="text-status-${cam.id}">${statusText} (${cam.resolution} @ ${Math.round(cam.fps_real)} FPS)</span>
                    </div>
                </div>
                
                <div class="camera-feed-container">
                    ${cam.active ? 
                        `<img src="${feedUrl}" class="camera-feed" alt="Feed da câmera" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : 
                        ''
                    }
                    <div class="feed-placeholder" style="${cam.active ? 'display:none;' : 'display:flex;'}">
                        <svg viewBox="0 0 24 24">
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                            <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34"></path>
                            <path d="M8.17 8.17a3 3 0 0 0 4.15 4.15"></path>
                        </svg>
                        <span>Sem Sinal</span>
                    </div>
                </div>

                <div class="camera-controls">
                    <button class="btn btn-arcade" onclick="triggerClip('${cam.id}')">
                        DISPARAR RECORTE (ARCADE)
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderCameraList() {
    if (cameras.length === 0) {
        cameraListContainer.innerHTML = '<p class="text-muted">Nenhuma câmera cadastrada.</p>';
        return;
    }

    cameraListContainer.innerHTML = cameras.map(cam => `
        <div class="camera-item">
            <div class="camera-info">
                <h4>${cam.name}</h4>
                <p>Fonte: ${cam.source} | Buffer: ${cam.buffer_seconds}s | Res: ${cam.resolution}</p>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" style="padding: 0.5rem 0.85rem;" onclick="editCamera('${cam.id}')">
                    Editar
                </button>
                <button class="btn btn-danger" style="padding: 0.5rem 0.85rem;" onclick="deleteCamera('${cam.id}')">
                    Excluir
                </button>
            </div>
        </div>
    `).join('');
}

function editCamera(camId) {
    const cam = cameras.find(c => c.id === camId);
    if (!cam) return;

    editingCameraId = camId;
    
    // Atualiza o título e botão do formulário
    const formTitle = document.querySelector('#add-camera-form').previousElementSibling.querySelector('.card-title');
    if (formTitle) formTitle.textContent = "Editar Câmera";
    
    const saveButton = document.querySelector('#add-camera-form button[type="submit"]');
    if (saveButton) saveButton.textContent = "Atualizar Câmera";

    // Adiciona ou ativa botão de cancelar se não existir
    let cancelBtn = document.getElementById('btn-cancel-edit');
    if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.id = 'btn-cancel-edit';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.style.marginTop = '0.5rem';
        cancelBtn.style.width = '100%';
        cancelBtn.textContent = 'Cancelar Edição';
        cancelBtn.addEventListener('click', cancelEdit);
        saveButton.parentNode.appendChild(cancelBtn);
    }

    // Preenche o formulário
    document.getElementById('cam-name').value = cam.name;
    document.getElementById('cam-fps').value = cam.fps;
    document.getElementById('cam-buffer').value = cam.buffer_seconds;

    const selectCamSource = document.getElementById('cam-source-select');
    const groupCamSourceManual = document.getElementById('cam-source-manual-group');
    const inputCamSourceManual = document.getElementById('cam-source-manual');

    // Verifica se a fonte atual é um dispositivo conhecido no select
    let optionExists = false;
    for (let i = 0; i < selectCamSource.options.length; i++) {
        if (selectCamSource.options[i].value === cam.source.toString()) {
            optionExists = true;
            break;
        }
    }

    if (optionExists) {
        selectCamSource.value = cam.source;
        groupCamSourceManual.style.display = 'none';
        inputCamSourceManual.required = false;
        inputCamSourceManual.value = '';
    } else {
        selectCamSource.value = 'custom';
        groupCamSourceManual.style.display = 'block';
        inputCamSourceManual.required = true;
        inputCamSourceManual.value = cam.source;
    }
}

function cancelEdit() {
    editingCameraId = null;
    document.getElementById('add-camera-form').reset();
    
    const formTitle = document.querySelector('#add-camera-form').previousElementSibling.querySelector('.card-title');
    if (formTitle) formTitle.textContent = "Adicionar Nova Câmera";
    
    const saveButton = document.querySelector('#add-camera-form button[type="submit"]');
    if (saveButton) saveButton.textContent = "Salvar Câmera";

    const cancelBtn = document.getElementById('btn-cancel-edit');
    if (cancelBtn) cancelBtn.remove();
    
    document.getElementById('cam-source-manual-group').style.display = 'none';
    document.getElementById('cam-source-manual').required = false;
}

// --- Mapeamento de Controles ---
async function loadBindings() {
    try {
        const response = await fetch(`${API_BASE}/api/config/controls`);
        controlBindings = await response.json();
        if (!Array.isArray(controlBindings)) controlBindings = [];
        renderMappingTable();
    } catch (error) {
        console.error("Erro ao carregar controles:", error);
    }
}

async function saveBindings() {
    try {
        const response = await fetch(`${API_BASE}/api/config/controls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(controlBindings)
        });
        if (response.ok) {
            showToast("Mapeamentos salvos com sucesso no servidor!");
            renderMappingTable();
        } else {
            showToast("Erro ao salvar mapeamentos.", true);
        }
    } catch (error) {
        showToast("Erro de comunicação ao salvar controles.", true);
    }
}

function renderMappingTable() {
    if (cameras.length === 0) {
        mappingTableBody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center;" class="text-muted">
                    Cadastre uma câmera primeiro para poder mapear disparos.
                </td>
            </tr>
        `;
        return;
    }

    mappingTableBody.innerHTML = cameras.map(cam => {
        // Encontra o binding da câmera
        const binding = controlBindings.find(b => b.camera_id === cam.id);
        let badgeHtml = '<span class="text-muted">Nenhum mapeamento</span>';
        
        if (binding) {
            if (binding.binding_type === 'keyboard') {
                badgeHtml = `<span class="binding-badge">Teclado: ${binding.key}</span>`;
            } else if (binding.binding_type === 'gamepad') {
                badgeHtml = `<span class="binding-badge">Controle ${binding.gamepad_index} | Botão ${binding.button_index}</span>`;
            }
        }

        const isListening = listeningCameraId === cam.id;
        const btnText = isListening ? 'Aguardando tecla/botão...' : 'Mapear';
        const btnClass = isListening ? 'btn-mapping listening' : 'btn-mapping';

        return `
            <tr>
                <td style="font-weight: 500;">${cam.name}</td>
                <td>${binding ? (binding.binding_type === 'keyboard' ? 'Teclado' : 'Gamepad/Arcade USB') : '-'}</td>
                <td>${badgeHtml}</td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="${btnClass}" onclick="startListening('${cam.id}')">
                            ${btnText}
                        </button>
                        ${binding ? `
                        <button class="btn btn-secondary" style="padding: 0.4rem 0.75rem; font-size: 0.8rem;" onclick="clearBinding('${cam.id}')">
                            Limpar
                        </button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function startListening(camId) {
    listeningCameraId = camId;
    renderMappingTable();
    showToast("Aguardando entrada: pressione uma tecla ou botão no controle arcade...");
}

function clearBinding(camId) {
    controlBindings = controlBindings.filter(b => b.camera_id !== camId);
    saveBindings();
}

// --- Detecção do Teclado e Gamepad ---
function setupKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
        // Se estiver aguardando mapeamento para o teclado/controle
        if (listeningCameraId) {
            e.preventDefault();
            // Ignora teclas de navegação comuns
            if (['Tab', 'Shift', 'Control', 'Alt'].includes(e.key)) return;

            // Substitui ou adiciona binding
            controlBindings = controlBindings.filter(b => b.camera_id !== listeningCameraId);
            controlBindings.push({
                camera_id: listeningCameraId,
                binding_type: 'keyboard',
                key: e.code
            });

            listeningCameraId = null;
            saveBindings();
            return;
        }

        // Pressionamento normal de teclas durante o funcionamento
        const binding = controlBindings.find(b => b.binding_type === 'keyboard' && b.key === e.code);
        if (binding) {
            e.preventDefault();
            triggerClip(binding.camera_id);
        }
    });
}
let lastConnectedGamepadsStr = "";

function setupGamepadLoop() {
    function pollGamepads() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        
        // Filtra os slots de gamepad que realmente possuem controles conectados
        const connectedGamepads = Array.from(gamepads).filter(Boolean);
        
        // Detecta se a lista de controles mudou para recriar o painel visual
        const connectedStr = connectedGamepads.map(gp => `${gp.index}:${gp.id}:${gp.buttons.length}`).join('|');
        if (connectedStr !== lastConnectedGamepadsStr) {
            lastConnectedGamepadsStr = connectedStr;
            renderGamepadDebugger(connectedGamepads);
        }

        for (let gIndex = 0; gIndex < gamepads.length; gIndex++) {
            const gp = gamepads[gIndex];
            if (!gp) continue;

            // Inicializa estado anterior do controle se não existir
            if (!lastGamepadState[gIndex]) {
                lastGamepadState[gIndex] = gp.buttons.map(() => false);
            }

            for (let bIndex = 0; bIndex < gp.buttons.length; bIndex++) {
                const btn = gp.buttons[bIndex];
                const pressed = btn.pressed;
                const wasPressed = lastGamepadState[gIndex][bIndex];

                // Atualiza o estado visual do botão indicador no debugger de arcade
                const btnIndicator = document.getElementById(`gp-${gIndex}-btn-${bIndex}`);
                if (btnIndicator) {
                    if (pressed) {
                        btnIndicator.classList.add('active');
                    } else {
                        btnIndicator.classList.remove('active');
                    }
                }

                // Detecta transição de subida do botão (pressionamento instantâneo)
                if (pressed && !wasPressed) {
                    handleGamepadButtonPress(gIndex, bIndex);
                }

                lastGamepadState[gIndex][bIndex] = pressed;
            }
        }
        requestAnimationFrame(pollGamepads);
    }
    requestAnimationFrame(pollGamepads);
}

function renderGamepadDebugger(connectedGamepads) {
    const container = document.getElementById('gamepad-debugger-container');
    if (!container) return;

    if (connectedGamepads.length === 0) {
        container.innerHTML = `
            <p class="text-muted" style="font-size: 0.9rem; text-align: center;">Nenhum controle detectado. Conecte seu Arcade USB e pressione qualquer botão.</p>
        `;
        return;
    }

    container.innerHTML = connectedGamepads.map(gp => {
        const buttonsHtml = Array.from({ length: gp.buttons.length }, (_, bIndex) => `
            <div class="gamepad-btn-indicator" id="gp-${gp.index}-btn-${bIndex}">
                ${bIndex}
            </div>
        `).join('');

        return `
            <div class="gamepad-device">
                <h5>${gp.id} (Porta ${gp.index})</h5>
                <div class="gamepad-buttons-grid">
                    ${buttonsHtml}
                </div>
            </div>
        `;
    }).join('');
}

function handleGamepadButtonPress(gamepadIndex, buttonIndex) {
    // Se estiver escutando para mapear
    if (listeningCameraId) {
        controlBindings = controlBindings.filter(b => b.camera_id !== listeningCameraId);
        controlBindings.push({
            camera_id: listeningCameraId,
            binding_type: 'gamepad',
            gamepad_index: gamepadIndex,
            button_index: buttonIndex
        });
        listeningCameraId = null;
        saveBindings();
        return;
    }

    // Funcionamento de disparo
    const binding = controlBindings.find(b => 
        b.binding_type === 'gamepad' && 
        b.gamepad_index === gamepadIndex && 
        b.button_index === buttonIndex
    );
    if (binding) {
        triggerClip(binding.camera_id);
    }
}
// --- Trigger de Recorte ---
async function triggerClip(cameraId) {
    const secBefore = parseInt(configBefore.value) || 5;
    const secAfter = parseInt(configAfter.value) || 3;
    const totalDurationMs = (secBefore + secAfter) * 1000;

    // Feedback visual imediato na tela (coração piscando / borda piscando vermelho)
    const card = document.getElementById(`card-${cameraId}`);
    const dot = document.getElementById(`dot-${cameraId}`);
    const statusText = document.getElementById(`text-status-${cameraId}`);
    
    if (card) {
        card.style.borderColor = 'var(--danger)';
        card.style.boxShadow = '0 0 25px var(--danger-glow)';
    }
    if (dot) {
        dot.className = 'status-dot recording';
    }
    if (statusText) {
        statusText.textContent = 'GRAVANDO RECORTE...';
    }

    // Aciona um efeito sonoro de click para dar feedback físico ao operador arcade
    playBeepSound();

    try {
        const response = await fetch(`${API_BASE}/api/trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                camera_id: cameraId,
                seconds_before: secBefore,
                seconds_after: secAfter,
                clip_name_prefix: 'corte'
            })
        });

        if (response.ok) {
            const data = await response.json();
            showToast(`GATILHO REGISTRADO! Gerando clipe...`);
            
            // Aguarda o término exato da gravação futura mais uma folga pequena
            setTimeout(async () => {
                showToast(`RECORTADO: clipe "${data.clip_filename}" salvo!`);
                // Reseta status visuais
                loadCameras(); 
                loadClips();
            }, (secAfter * 1000) + 1000);
        } else {
            const err = await response.json();
            showToast(`Erro ao gravar clipe: ${err.detail}`, true);
            loadCameras();
        }
    } catch (error) {
        showToast("Erro ao conectar ao servidor.", true);
        loadCameras();
    }
}

function playBeepSound() {
    try {
        const soundSelect = document.getElementById('config-sound-select');
        const selectedSound = soundSelect ? soundSelect.value : (localStorage.getItem('selectedSound') || 'arcade');
        
        if (selectedSound === 'silent') {
            return; // Modo silencioso
        }

        // Fecha o contexto anterior se ainda estiver aberto
        if (window.activeAudioContext) {
            try { window.activeAudioContext.close(); } catch (err) {}
        }
        
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        window.activeAudioContext = audioCtx; // Salva globalmente para evitar Garbage Collection e corte de som
        
        const now = audioCtx.currentTime;

        if (selectedSound === 'arcade') {
            // Retro Arcade: sweep ascendente com onda triangular (3 segundos)
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            osc.type = 'triangle';
            
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(800, now + 1.2);
            osc.frequency.setValueAtTime(800, now + 1.2);
            osc.frequency.exponentialRampToValueAtTime(1200, now + 3.0);
            
            gainNode.gain.setValueAtTime(0.01, now);
            gainNode.gain.linearRampToValueAtTime(1.0, now + 0.15);
            gainNode.gain.setValueAtTime(1.0, now + 2.0);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 3.0);
            
            osc.start(now);
            osc.stop(now + 3.0);
            
        } else if (selectedSound === 'chime') {
            // Chime Suave: acorde maior (C5, E5, G5) arpejado suave (3 segundos)
            const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5
            freqs.forEach((freq, index) => {
                const osc = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                osc.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + (index * 0.1));
                
                gainNode.gain.setValueAtTime(0.01, now);
                gainNode.gain.linearRampToValueAtTime(0.25, now + 0.05 + (index * 0.1));
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 3.0);
                
                osc.start(now);
                osc.stop(now + 3.0);
            });
            
        } else if (selectedSound === 'coin') {
            // Retro Coin: som de pegar moeda clássico 8-bit (0.5 segundos)
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            osc.type = 'square';
            osc.frequency.setValueAtTime(987.77, now); // Si 5
            osc.frequency.setValueAtTime(1318.51, now + 0.08); // Mi 6
            
            gainNode.gain.setValueAtTime(0.01, now);
            gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01);
            gainNode.gain.setValueAtTime(0.3, now + 0.35);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
            
            osc.start(now);
            osc.stop(now + 0.5);
            
        } else if (selectedSound === 'laser') {
            // Retro Laser: sweep descendente rápido com onda dente-de-serra (0.4 segundos)
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(1500, now);
            osc.frequency.exponentialRampToValueAtTime(150, now + 0.3);
            
            gainNode.gain.setValueAtTime(0.01, now);
            gainNode.gain.linearRampToValueAtTime(0.3, now + 0.02);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            
            osc.start(now);
            osc.stop(now + 0.4);
            
        } else if (selectedSound === 'beep') {
            // Bip Clássico: bip padrão de temporizador (0.3 segundos)
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1000, now);
            
            gainNode.gain.setValueAtTime(0.01, now);
            gainNode.gain.linearRampToValueAtTime(0.5, now + 0.02);
            gainNode.gain.setValueAtTime(0.5, now + 0.22);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            
            osc.start(now);
            osc.stop(now + 0.3);
        }

        // Garante a liberação do recurso de áudio após a reprodução
        setTimeout(() => {
            if (window.activeAudioContext === audioCtx) {
                try { audioCtx.close(); } catch(err) {}
                window.activeAudioContext = null;
            }
        }, 3500);
        
    } catch(e) {
        console.warn("AudioContext não permitido ou não suportado", e);
    }
}

// Credenciais do Supabase (Nuvem & Realtime)
const SUPABASE_URL = "https://wdjyxbrlergrvfilulyv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indkanl4YnJsZXJncnZmaWx1bHl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2OTA4MDIsImV4cCI6MjEwMzI2NjgwMn0.1bVKL8h4iaLz6J_tT3dg3N0zUJmSs5WP3SHwjDi9tqg";

let supabaseClient = null;
try {
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
} catch(e) {}

let selectedGalleryDate = 'all';

// --- Galeria de Clipes Agrupada por Data (Supabase + Local) ---
async function loadClips() {
    let loadedFromCloud = false;
    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('lances')
                .select('*')
                .order('created_at', { ascending: false });

            if (!error && data && data.length > 0) {
                clips = data.map(lance => {
                    const ts = new Date(lance.created_at).getTime() / 1000;
                    const videoUrl = lance.video_url || `https://pub-bf1a3aa70cd049a8ad4774397028451d.r2.dev/${lance.filename}`;
                    const previewUrl = lance.preview_url || videoUrl.replace('pub-bf1a3aa70cd049a8ad4774397028451d.r2.dev/', 'pub-bf1a3aa70cd049a8ad4774397028451d.r2.dev/previews/');

                    return {
                        filename: lance.filename,
                        video_url: videoUrl,
                        preview_url: previewUrl,
                        thumb_url: lance.thumb_url || `https://pub-bf1a3aa70cd049a8ad4774397028451d.r2.dev/thumbs/${lance.filename}.jpg`,
                        size_bytes: lance.size_bytes || 0,
                        created_at: isNaN(ts) ? Date.now() / 1000 : ts
                    };
                });
                loadedFromCloud = true;
            }
        } catch(e) {
            console.warn("Aviso ao conectar ao Supabase:", e);
        }
    }

    if (!loadedFromCloud) {
        try {
            const response = await fetch(`${API_BASE}/api/clips`);
            if (response.ok) {
                const data = await response.json();
                clips = data.map(c => ({
                    filename: c.filename,
                    video_url: `${API_BASE}/api/clips/${c.filename}`,
                    thumb_url: `${API_BASE}/api/clips/${c.filename}/thumb`,
                    size_bytes: c.size_bytes,
                    created_at: c.created_at
                }));
            }
        } catch (error) {
            console.error("Erro ao carregar clipes:", error);
        }
    }

    renderClips();
}

function getDayKey(timestampSec) {
    const d = new Date(timestampSec * 1000);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatGroupDateHeader(dateKey, sampleTimestampSec) {
    const now = new Date();
    const todayKey = getDayKey(now.getTime() / 1000);
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getDayKey(yesterday.getTime() / 1000);

    const d = new Date(sampleTimestampSec * 1000);
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const dateFormatted = d.toLocaleDateString('pt-BR', options);
    const formattedWithCap = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);

    if (dateKey === todayKey) {
        return `Hoje • ${formattedWithCap}`;
    } else if (dateKey === yesterdayKey) {
        return `Ontem • ${formattedWithCap}`;
    } else {
        return formattedWithCap;
    }
}

function updateGalleryDateFilterOptions(groupedDates) {
    const dateSelect = document.getElementById('gallery-date-filter');
    if (!dateSelect) return;

    const currentVal = dateSelect.value || selectedGalleryDate;
    dateSelect.innerHTML = `<option value="all">📅 Todas as Datas (${clips.length} lances)</option>`;

    Object.keys(groupedDates).forEach(dateKey => {
        const group = groupedDates[dateKey];
        const label = formatGroupDateHeader(dateKey, group[0].created_at);
        const opt = document.createElement('option');
        opt.value = dateKey;
        opt.textContent = `${label} (${group.length})`;
        if (dateKey === currentVal) opt.selected = true;
        dateSelect.appendChild(opt);
    });

    dateSelect.onchange = (e) => {
        selectedGalleryDate = e.target.value;
        renderClips();
    };
}

function renderClips() {
    if (!clipsGridContainer) return;

    if (clips.length === 0) {
        clipsGridContainer.innerHTML = `
            <div class="glass-card" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                <p class="text-muted">Nenhum recorte gerado ainda. Pressione um botão arcade para iniciar!</p>
            </div>
        `;
        return;
    }

    // 1. Agrupa clipes por data (YYYY-MM-DD)
    const groupedDates = {};
    clips.forEach(clip => {
        const dayKey = getDayKey(clip.created_at);
        if (!groupedDates[dayKey]) {
            groupedDates[dayKey] = [];
        }
        groupedDates[dayKey].push(clip);
    });

    // 2. Atualiza opções do dropdown de filtro por data
    updateGalleryDateFilterOptions(groupedDates);

    // 3. Filtra se uma data específica estiver selecionada
    const visibleDateKeys = selectedGalleryDate === 'all' 
        ? Object.keys(groupedDates) 
        : Object.keys(groupedDates).filter(k => k === selectedGalleryDate);

    if (visibleDateKeys.length === 0) {
        clipsGridContainer.innerHTML = `
            <div class="glass-card" style="text-align: center; padding: 2.5rem;">
                <p class="text-muted">Nenhum lance encontrado para a data selecionada.</p>
            </div>
        `;
        return;
    }

    // 4. Renderiza blocos com cabeçalhos por data
    clipsGridContainer.innerHTML = visibleDateKeys.map(dateKey => {
        const groupClips = groupedDates[dateKey];
        const dateHeader = formatGroupDateHeader(dateKey, groupClips[0].created_at);

        const cardsHtml = groupClips.map(clip => {
            const timeFormatted = new Date(clip.created_at * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const sizeMb = (clip.size_bytes / (1024 * 1024)).toFixed(2);
            
            const targetClip = groupClips.find(c => c.filename === clip.filename) || clip;
            const thumbUrl = targetClip.thumb_url || `${API_BASE}/api/clips/${clip.filename}/thumb`;

            return `
                <div class="clip-card" onclick="openPlayer('${clip.filename}')">
                    <div class="clip-thumbnail">
                        <!-- Ícone de play grande no hover -->
                        <svg class="play-icon" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"></path>
                        </svg>
                        <!-- Miniatura ultra leve e rápida (10KB) -->
                        <img class="clip-thumbnail-img" src="${thumbUrl}" loading="lazy" alt="${clip.filename}">
                    </div>
                    <div class="clip-info">
                        <div class="clip-name" title="${clip.filename}">${clip.filename}</div>
                        <div class="clip-meta">
                            <span>Horário: ${timeFormatted}</span>
                            <span>${sizeMb} MB</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="gallery-date-section">
                <div class="date-group-header">
                    <div class="date-group-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>${dateHeader}</span>
                    </div>
                    <span class="date-group-count">${groupClips.length} ${groupClips.length === 1 ? 'lance' : 'lances'}</span>
                </div>
                <div class="clips-grid">
                    ${cardsHtml}
                </div>
            </div>
        `;
    }).join('');
}

// --- Player de Preview Personalizado ---
function openPlayer(filename) {
    activeClipFilename = filename;
    playerVideoTitle.textContent = `Lance: ${filename}`;
    
    const targetClip = clips.find(c => c.filename === filename);
    const videoUrl = targetClip?.preview_url || targetClip?.video_url || `${API_BASE}/api/clips/${filename}`;

    // Configura o source do vídeo e recarrega
    previewVideo.src = videoUrl;
    previewVideo.load();
    previewVideo.playbackRate = 1.0;
    
    // Reseta botões de velocidade
    speedButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-speed') === '1.0') {
            btn.classList.add('active');
        }
    });

    // Abre o modal
    playerModal.classList.add('active');
    
    // Play automático
    previewVideo.play().catch(() => {
        playerPlayBtn.textContent = 'Play';
    });
    playerPlayBtn.textContent = 'Pause';

    // Configura link de download
    btnDownloadClip.href = `${API_BASE}/api/clips/${filename}`;
}

function closePlayer() {
    previewVideo.pause();
    previewVideo.src = '';
    playerModal.classList.remove('active');
    activeClipFilename = null;
}

function setupPlayerEventListeners() {
    // Fechar modal
    btnCloseModal.addEventListener('click', closePlayer);
    playerModal.addEventListener('click', (e) => {
        if (e.target === playerModal) closePlayer();
    });

    // Play/Pause
    playerPlayBtn.addEventListener('click', () => {
        if (previewVideo.paused) {
            previewVideo.play();
            playerPlayBtn.textContent = 'Pause';
        } else {
            previewVideo.pause();
            playerPlayBtn.textContent = 'Play';
        }
    });

    // Detectar play/pause nativos (por exemplo, ao clicar no vídeo)
    previewVideo.addEventListener('play', () => {
        playerPlayBtn.textContent = 'Pause';
    });
    previewVideo.addEventListener('pause', () => {
        playerPlayBtn.textContent = 'Play';
    });

    // Loop toggle
    playerLoopBtn.addEventListener('click', () => {
        previewVideo.loop = !previewVideo.loop;
        playerLoopBtn.textContent = `Loop: ${previewVideo.loop ? 'ON' : 'OFF'}`;
        playerLoopBtn.classList.toggle('active', previewVideo.loop);
    });

    // Velocidades
    speedButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const speed = parseFloat(btn.getAttribute('data-speed'));
            previewVideo.playbackRate = speed;
            
            speedButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Volume
    playerVolume.addEventListener('input', (e) => {
        previewVideo.volume = e.target.value;
    });

    // Atualização de Progresso (Tempo)
    previewVideo.addEventListener('timeupdate', () => {
        if (!isNaN(previewVideo.duration)) {
            const value = (previewVideo.currentTime / previewVideo.duration) * 1000;
            playerProgress.max = 1000;
            playerProgress.value = value;
            
            // Exibe tempo formatado
            const current = formatTime(previewVideo.currentTime);
            const total = formatTime(previewVideo.duration);
            playerTime.textContent = `${current} / ${total}`;
        }
    });

    // Busca manual clicando/arrastando na barra
    playerProgress.addEventListener('input', (e) => {
        if (!isNaN(previewVideo.duration)) {
            const time = (e.target.value / 1000) * previewVideo.duration;
            previewVideo.currentTime = time;
        }
    });

    // Frame a Frame (Voltar 1 frame - ~0.03 segundos)
    playerPrevFrameBtn.addEventListener('click', () => {
        previewVideo.pause();
        previewVideo.currentTime = Math.max(0, previewVideo.currentTime - 0.033);
    });

    // Frame a Frame (Avançar 1 frame - ~0.03 segundos)
    playerNextFrameBtn.addEventListener('click', () => {
        previewVideo.pause();
        previewVideo.currentTime = Math.min(previewVideo.duration, previewVideo.currentTime + 0.033);
    });

    // Excluir Clipe
    btnDeleteClip.addEventListener('click', async () => {
        if (!activeClipFilename) return;
        if (!confirm("Tem certeza que deseja excluir este clipe permanentemente?")) return;

        try {
            const response = await fetch(`${API_BASE}/api/clips/${activeClipFilename}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                showToast("Clipe deletado com sucesso!");
                closePlayer();
                loadClips();
            } else {
                showToast("Erro ao deletar o clipe.", true);
            }
        } catch (error) {
            showToast("Erro ao comunicar com o servidor.", true);
        }
    });
}

// Formata segundos em MM:SS:CC (Minutos, Segundos, Centésimos)
function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00.00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const hundredths = Math.floor((seconds % 1) * 100);
    
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`;
}
