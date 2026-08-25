// Base da API sempre apontando para a origem da página atual
const API_BASE = window.location.origin;

// Credenciais do Supabase (Nuvem & Realtime)
const SUPABASE_URL = "https://wdjyxbrlergrvfilulyv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indkanl4YnJsZXJncnZmaWx1bHl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2OTA4MDIsImV4cCI6MjEwMzI2NjgwMn0.1bVKL8h4iaLz6J_tT3dg3N0zUJmSs5WP3SHwjDi9tqg";

let supabaseClient = null;
try {
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
} catch (e) {
    console.warn("Supabase client não pôde ser iniciado:", e);
}

// Estado Global
let allClips = [];
let filteredClips = [];
let currentFilter = 'all';
let searchQuery = '';
let activeClip = null;
let knownClipCount = 0;
let pollingInterval = null;

// Favoritos locais no dispositivo do atleta
let favorites = JSON.parse(localStorage.getItem('atleta_favs') || '[]');

// Elementos DOM
const clipsContainer = document.getElementById('clips-container');
const feedTitle = document.getElementById('feed-title');
const feedCounter = document.getElementById('feed-counter');
const favCountBadge = document.getElementById('fav-count');
const inputSearch = document.getElementById('input-search');
const btnClearSearch = document.getElementById('btn-clear-search');
const filterChipsContainer = document.getElementById('filter-chips');
const btnRefresh = document.getElementById('btn-refresh');
const newClipsBanner = document.getElementById('new-clips-banner');
const btnBannerLoad = document.getElementById('btn-banner-load');

// Elementos do Modal Player
const playerModal = document.getElementById('player-modal');
const playerBackdrop = document.getElementById('player-backdrop');
const btnClosePlayer = document.getElementById('btn-close-player');
const atletaVideo = document.getElementById('atleta-video');
const playerTitle = document.getElementById('player-title');
const playerMeta = document.getElementById('player-meta');
const videoProgress = document.getElementById('video-progress');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const btnPlayPause = document.getElementById('btn-play-pause');
const iconPlay = btnPlayPause.querySelector('.icon-play');
const iconPause = btnPlayPause.querySelector('.icon-pause');
const btnSkipBack = document.getElementById('btn-skip-back');
const btnSkipForward = document.getElementById('btn-skip-forward');
const btnFramePrev = document.getElementById('btn-frame-prev');
const btnFrameNext = document.getElementById('btn-frame-next');
const btnLoopToggle = document.getElementById('btn-loop-toggle');
const speedButtons = document.querySelectorAll('.speed-btn');
const btnShareClip = document.getElementById('btn-share-clip');
const btnDownloadClip = document.getElementById('btn-download-clip');
const btnFavToggle = document.getElementById('btn-fav-toggle');
const videoTouchOverlay = document.getElementById('video-touch-overlay');
const touchIndicator = document.getElementById('touch-indicator');
const toastElement = document.getElementById('toast');

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', () => {
    updateFavBadge();
    loadClips(true);
    setupEventListeners();
    setupRealtimeSubscription();
});

// --- Carregar Clipes (Supabase com Fallback Local) ---
async function loadClips(isInitial = false) {
    let loadedFromCloud = false;

    // 1. Tenta carregar do Supabase (Nuvem - funciona na Vercel e em qualquer lugar)
    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('lances')
                .select('*')
                .order('created_at', { ascending: false });

            if (!error && data && data.length > 0) {
                allClips = data.map(lance => {
                    const ts = new Date(lance.created_at).getTime() / 1000;
                    return {
                        filename: lance.filename,
                        video_url: lance.video_url || `${SUPABASE_URL}/storage/v1/object/public/videos/${lance.filename}`,
                        thumb_url: lance.thumb_url || `${SUPABASE_URL}/storage/v1/object/public/videos/thumbs/${lance.filename}.jpg`,
                        camera_name: lance.camera_name || extractCameraLabel(lance.filename),
                        size_bytes: lance.size_bytes || 0,
                        created_at: isNaN(ts) ? Date.now() / 1000 : ts
                    };
                });
                loadedFromCloud = true;
            }
        } catch (err) {
            console.warn("Aviso ao conectar ao Supabase:", err);
        }
    }

    // 2. Fallback para API Local se estiver no computador da quadra
    if (!loadedFromCloud) {
        try {
            const response = await fetch(`${API_BASE}/api/clips`);
            if (response.ok) {
                const data = await response.json();
                allClips = data.map(clip => ({
                    filename: clip.filename,
                    video_url: `${API_BASE}/api/clips/${clip.filename}`,
                    thumb_url: `${API_BASE}/api/clips/${clip.filename}/thumb`,
                    camera_name: extractCameraLabel(clip.filename),
                    size_bytes: clip.size_bytes,
                    created_at: clip.created_at
                }));
            }
        } catch (error) {
            console.error("Erro ao carregar clipes locais:", error);
        }
    }

    if (allClips.length > knownClipCount && !isInitial) {
        newClipsBanner.style.display = 'block';
    }
    knownClipCount = allClips.length;

    applyFiltersAndRender();
}

// --- Subscrição em Tempo Real (Supabase Realtime) ---
function setupRealtimeSubscription() {
    if (!supabaseClient) {
        startPolling();
        return;
    }

    try {
        supabaseClient
            .channel('realtime_lances_feed')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lances' }, (payload) => {
                const lance = payload.new;
                const ts = new Date(lance.created_at).getTime() / 1000;
                const newClip = {
                    filename: lance.filename,
                    video_url: lance.video_url || `${SUPABASE_URL}/storage/v1/object/public/videos/${lance.filename}`,
                    thumb_url: lance.thumb_url || `${SUPABASE_URL}/storage/v1/object/public/videos/thumbs/${lance.filename}.jpg`,
                    camera_name: lance.camera_name || extractCameraLabel(lance.filename),
                    size_bytes: lance.size_bytes || 0,
                    created_at: isNaN(ts) ? Date.now() / 1000 : ts
                };

                allClips.unshift(newClip);
                newClipsBanner.style.display = 'block';
                showToast("🔥 Novo lance gravado na quadra!");
            })
            .subscribe();
    } catch (e) {
        console.warn("Falha ao iniciar Realtime, usando polling fallback:", e);
        startPolling();
    }
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(() => {
        loadClips(false);
    }, 5000);
}

let selectedDateFilter = 'all';

// --- Helpers de Data para Agrupamento ---
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

function formatChipDateLabel(dateKey, sampleTimestampSec) {
    const now = new Date();
    const todayKey = getDayKey(now.getTime() / 1000);
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getDayKey(yesterday.getTime() / 1000);

    if (dateKey === todayKey) return '📅 Hoje';
    if (dateKey === yesterdayKey) return '📅 Ontem';

    const d = new Date(sampleTimestampSec * 1000);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `📅 ${day}/${month}`;
}

// --- Filtros & Renderização ---
function applyFiltersAndRender() {
    filteredClips = allClips.filter(clip => {
        const isFav = favorites.includes(clip.filename);
        if (currentFilter === 'favs' && !isFav) return false;
        
        // Filtro por câmera
        if (currentFilter !== 'all' && currentFilter !== 'favs') {
            if (!clip.filename.includes(currentFilter)) return false;
        }

        // Filtro por data
        if (selectedDateFilter !== 'all') {
            const clipDayKey = getDayKey(clip.created_at);
            if (clipDayKey !== selectedDateFilter) return false;
        }

        // Filtro por busca
        if (searchQuery.trim() !== '') {
            const query = searchQuery.toLowerCase();
            const dateStr = formatDateTime(clip.created_at).toLowerCase();
            const filename = clip.filename.toLowerCase();
            const camLabel = extractCameraLabel(clip.filename).toLowerCase();
            if (!dateStr.includes(query) && !filename.includes(query) && !camLabel.includes(query)) {
                return false;
            }
        }

        return true;
    });

    renderClipsGrid();
    renderDynamicFilterChips();
    updateCounter();
}

function renderClipsGrid() {
    if (filteredClips.length === 0) {
        clipsContainer.innerHTML = `
            <div class="empty-box">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                    <line x1="7" y1="2" x2="7" y2="22"></line>
                    <line x1="17" y1="17" x2="17" y2="22"></line>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                </svg>
                <p style="font-weight: 700;">Nenhum lance encontrado.</p>
                <span style="font-size: 0.8rem; color: var(--text-tertiary);">Grave um lance no botão arcade ou escolha outro filtro!</span>
            </div>
        `;
        return;
    }

    // 1. Agrupa os clipes filtrados por dia (YYYY-MM-DD)
    const groupedDates = {};
    filteredClips.forEach(clip => {
        const dayKey = getDayKey(clip.created_at);
        if (!groupedDates[dayKey]) {
            groupedDates[dayKey] = [];
        }
        groupedDates[dayKey].push(clip);
    });

    const dateKeys = Object.keys(groupedDates);

    // 2. Renderiza as seções agrupadas por data
    clipsContainer.innerHTML = dateKeys.map(dateKey => {
        const groupClips = groupedDates[dateKey];
        const dateHeader = formatGroupDateHeader(dateKey, groupClips[0].created_at);

        const cardsHtml = groupClips.map((clip, index) => {
            const isFav = favorites.includes(clip.filename);
            const formattedTime = new Date(clip.created_at * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const timeAgo = formatTimeAgo(clip.created_at);
            const sizeMb = (clip.size_bytes / (1024 * 1024)).toFixed(1);
            const camLabel = clip.camera_name || extractCameraLabel(clip.filename);
            const clipUrl = clip.video_url || `${API_BASE}/api/clips/${clip.filename}`;
            const thumbUrl = clip.thumb_url || `${API_BASE}/api/clips/${clip.filename}/thumb`;

            return `
                <div class="video-card" data-filename="${clip.filename}">
                    <div class="card-preview" onclick="openPlayer('${clip.filename}')">
                        <span class="card-cam-badge">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="color: #60a5fa;">
                                <circle cx="12" cy="12" r="8"></circle>
                            </svg>
                            ${camLabel}
                        </span>
                        <span class="card-time-badge">${timeAgo}</span>
                        
                        <img class="card-thumb-img" src="${thumbUrl}" loading="lazy" alt="Lance">
                        
                        <div class="card-overlay">
                            <div class="play-bubble">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                </svg>
                            </div>
                        </div>
                    </div>

                    <div class="card-info">
                        <div class="card-meta-row">
                            <div>
                                <div class="card-title">Lance às ${formattedTime}</div>
                                <div class="card-subtext">${sizeMb} MB • ${camLabel}</div>
                            </div>
                            <button class="btn-star ${isFav ? 'active' : ''}" onclick="toggleFavorite('${clip.filename}', event)" title="Favoritar lance">
                                <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                                </svg>
                            </button>
                        </div>

                        <div class="card-buttons-row">
                            <button class="btn-card-action btn-card-primary" onclick="openPlayer('${clip.filename}')">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                </svg>
                                <span>Assistir</span>
                            </button>

                            <button class="btn-card-action" onclick="shareClipDirectly('${clip.filename}', event)" style="color: #34d399;">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="18" cy="5" r="3"></circle>
                                    <circle cx="6" cy="12" r="3"></circle>
                                    <circle cx="18" cy="19" r="3"></circle>
                                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                                </svg>
                                <span>WhatsApp</span>
                            </button>

                            <a href="${clipUrl}" class="btn-card-action" download="${clip.filename}" onclick="showToast('Iniciando download... 💾')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                <span>Baixar</span>
                            </a>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <section class="atleta-date-section">
                <div class="atleta-date-header">
                    <div class="atleta-date-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>${dateHeader}</span>
                    </div>
                    <span class="atleta-date-count">${groupClips.length} ${groupClips.length === 1 ? 'lance' : 'lances'}</span>
                </div>
                <div class="videos-grid">
                    ${cardsHtml}
                </div>
            </section>
        `;
    }).join('');
}

function renderDynamicFilterChips() {
    // 1. Remove chips dinâmicos anteriores
    filterChipsContainer.querySelectorAll('.chip-dynamic').forEach(el => el.remove());

    // 2. Extrai datas únicas dos clipes
    const datesMap = {};
    allClips.forEach(c => {
        const dayKey = getDayKey(c.created_at);
        if (!datesMap[dayKey]) {
            datesMap[dayKey] = c.created_at;
        }
    });

    // Adiciona chips de datas se houver mais de 1 data
    const dateKeys = Object.keys(datesMap);
    if (dateKeys.length > 1) {
        dateKeys.forEach(dateKey => {
            const btn = document.createElement('button');
            const isActive = selectedDateFilter === dateKey;
            btn.className = `filter-chip chip-dynamic ${isActive ? 'active' : ''}`;
            btn.textContent = formatChipDateLabel(dateKey, datesMap[dateKey]);
            btn.addEventListener('click', () => {
                if (selectedDateFilter === dateKey) {
                    selectedDateFilter = 'all';
                } else {
                    selectedDateFilter = dateKey;
                }
                applyFiltersAndRender();
            });
            filterChipsContainer.appendChild(btn);
        });
    }

    // 3. Extrai câmeras únicas
    const cameraIds = new Set();
    allClips.forEach(c => {
        const match = c.filename.match(/cam_\d+/);
        if (match) cameraIds.add(match[0]);
    });

    cameraIds.forEach(camId => {
        const btn = document.createElement('button');
        const isActive = currentFilter === camId;
        btn.className = `filter-chip chip-dynamic ${isActive ? 'active' : ''}`;
        btn.setAttribute('data-filter', camId);
        btn.textContent = extractCameraLabel(camId);
        btn.addEventListener('click', () => setFilter(camId));
        filterChipsContainer.appendChild(btn);
    });
}

function updateCounter() {
    feedCounter.textContent = `${filteredClips.length} ${filteredClips.length === 1 ? 'vídeo' : 'vídeos'}`;
    if (currentFilter === 'favs') {
        feedTitle.textContent = "Meus Favoritos ⭐";
    } else if (selectedDateFilter !== 'all') {
        const sample = allClips.find(c => getDayKey(c.created_at) === selectedDateFilter);
        feedTitle.textContent = sample ? formatGroupDateHeader(selectedDateFilter, sample.created_at) : "Lances da Data";
    } else if (currentFilter === 'all') {
        feedTitle.textContent = "Todos os Lances";
    } else {
        feedTitle.textContent = extractCameraLabel(currentFilter);
    }
}

function updateFavBadge() {
    favCountBadge.textContent = favorites.length;
}

function setFilter(filterType) {
    currentFilter = filterType;
    document.querySelectorAll('.chips-scroll .filter-chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-filter') === filterType);
    });
    applyFiltersAndRender();
}

// --- Player de Vídeo ---
function openPlayer(filename) {
    const clip = allClips.find(c => c.filename === filename);
    if (!clip) return;

    activeClip = clip;
    const isFav = favorites.includes(filename);
    const dateFormatted = formatDateTime(clip.created_at);
    const sizeMb = (clip.size_bytes / (1024 * 1024)).toFixed(1);

    const clipUrl = clip.video_url || `${API_BASE}/api/clips/${filename}`;

    playerTitle.textContent = clip.camera_name || extractCameraLabel(filename);
    playerMeta.textContent = `${dateFormatted} • ${sizeMb} MB`;
    
    // Configura botões
    btnDownloadClip.href = clipUrl;
    btnDownloadClip.setAttribute('download', filename);
    btnFavToggle.classList.toggle('active', isFav);
    btnFavToggle.querySelector('.ico-star').setAttribute('fill', isFav ? 'currentColor' : 'none');

    // Carrega o vídeo
    atletaVideo.src = clipUrl;
    atletaVideo.playbackRate = 1.0;
    atletaVideo.loop = true;
    btnLoopToggle.classList.add('active');

    // Reseta botões de velocidade
    speedButtons.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-speed') === '1.0');
    });

    // Abre o modal
    playerModal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Inicia reprodução
    atletaVideo.play().then(() => {
        updatePlayPauseUI(true);
    }).catch(() => {
        updatePlayPauseUI(false);
    });
}

function closePlayer() {
    atletaVideo.pause();
    atletaVideo.src = '';
    playerModal.classList.remove('active');
    document.body.style.overflow = '';
    activeClip = null;
}

function updatePlayPauseUI(isPlaying) {
    if (isPlaying) {
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
    } else {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
    }
}

function triggerTouchIndicator() {
    touchIndicator.classList.add('show');
    setTimeout(() => {
        touchIndicator.classList.remove('show');
    }, 350);
}

// --- Favoritos (localStorage) ---
function toggleFavorite(filename, e) {
    if (e) e.stopPropagation();
    
    const index = favorites.indexOf(filename);
    if (index > -1) {
        favorites.splice(index, 1);
        showToast("Removido dos favoritos");
    } else {
        favorites.push(filename);
        showToast("Adicionado aos favoritos ⭐");
    }

    localStorage.setItem('atleta_favs', JSON.stringify(favorites));
    updateFavBadge();
    applyFiltersAndRender();

    if (activeClip && activeClip.filename === filename) {
        const isFav = favorites.includes(filename);
        btnFavToggle.classList.toggle('active', isFav);
        btnFavToggle.querySelector('.ico-star').setAttribute('fill', isFav ? 'currentColor' : 'none');
    }
}

// --- Compartilhamento Nativo / WhatsApp ---
async function shareClipDirectly(filename, e) {
    if (e) e.stopPropagation();
    
    const targetClip = allClips.find(c => c.filename === filename) || activeClip;
    const videoUrl = targetClip?.video_url || `${API_BASE}/api/clips/${filename}`;
    const shareTitle = `Lance - Momentos`;
    const shareText = `Confira esse lance gravado no Momentos:`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: shareTitle,
                text: shareText,
                url: videoUrl
            });
            showToast("Lance compartilhado!");
        } catch (err) {
            if (err.name !== 'AbortError') {
                copyUrlToClipboard(videoUrl);
            }
        }
    } else {
        copyUrlToClipboard(videoUrl);
    }
}

function copyUrlToClipboard(url) {
    navigator.clipboard.writeText(url).then(() => {
        showToast("Link do lance copiado! Cole no WhatsApp 📋");
    }).catch(() => {
        showToast("Link: " + url);
    });
}

// --- Notificações Toast ---
function showToast(message) {
    toastElement.textContent = message;
    toastElement.classList.add('show');
    setTimeout(() => {
        toastElement.classList.remove('show');
    }, 2800);
}

// --- Formatadores de Data & Hora ---
function formatDateTime(timestamp) {
    const d = new Date(timestamp * 1000);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month} às ${hours}:${mins}`;
}

function formatTimeAgo(timestamp) {
    const diffSec = Math.floor((Date.now() / 1000) - timestamp);
    if (diffSec < 60) return "Agora mesmo";
    if (diffSec < 3600) return `Há ${Math.floor(diffSec / 60)} min`;
    if (diffSec < 86400) return `Há ${Math.floor(diffSec / 3600)} h`;
    return formatDateTime(timestamp).split(' às ')[0];
}

function formatPlayerTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "00:00.00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function extractCameraLabel(filename) {
    if (filename.includes('cam_1787010390')) return 'Câmera Principal';
    if (filename.includes('cam_1787010398')) return 'Câmera 2';
    const match = filename.match(/cam_\d+/);
    return match ? `Câmera ${match[0].slice(-4)}` : 'Câmera';
}

// --- Event Listeners ---
function setupEventListeners() {
    btnRefresh.addEventListener('click', () => {
        loadClips(true);
        showToast("Feed atualizado!");
    });

    btnBannerLoad.addEventListener('click', () => {
        newClipsBanner.style.display = 'none';
        applyFiltersAndRender();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.querySelectorAll('.chips-scroll .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            setFilter(chip.getAttribute('data-filter'));
        });
    });

    inputSearch.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        btnClearSearch.style.display = searchQuery ? 'block' : 'none';
        applyFiltersAndRender();
    });

    btnClearSearch.addEventListener('click', () => {
        inputSearch.value = '';
        searchQuery = '';
        btnClearSearch.style.display = 'none';
        applyFiltersAndRender();
    });

    btnClosePlayer.addEventListener('click', closePlayer);
    playerBackdrop.addEventListener('click', closePlayer);

    btnPlayPause.addEventListener('click', () => {
        if (atletaVideo.paused) {
            atletaVideo.play();
        } else {
            atletaVideo.pause();
        }
    });

    videoTouchOverlay.addEventListener('click', () => {
        if (atletaVideo.paused) {
            atletaVideo.play();
        } else {
            atletaVideo.pause();
        }
        triggerTouchIndicator();
    });

    atletaVideo.addEventListener('play', () => updatePlayPauseUI(true));
    atletaVideo.addEventListener('pause', () => updatePlayPauseUI(false));

    atletaVideo.addEventListener('timeupdate', () => {
        if (!isNaN(atletaVideo.duration) && atletaVideo.duration > 0) {
            const val = (atletaVideo.currentTime / atletaVideo.duration) * 1000;
            videoProgress.value = val;
            timeCurrent.textContent = formatPlayerTime(atletaVideo.currentTime);
            timeTotal.textContent = formatPlayerTime(atletaVideo.duration);
        }
    });

    videoProgress.addEventListener('input', (e) => {
        if (!isNaN(atletaVideo.duration)) {
            const newTime = (e.target.value / 1000) * atletaVideo.duration;
            atletaVideo.currentTime = newTime;
            timeCurrent.textContent = formatPlayerTime(newTime);
        }
    });

    btnSkipBack.addEventListener('click', () => {
        atletaVideo.currentTime = Math.max(0, atletaVideo.currentTime - 3);
    });

    btnSkipForward.addEventListener('click', () => {
        atletaVideo.currentTime = Math.min(atletaVideo.duration || 0, atletaVideo.currentTime + 3);
    });

    btnFramePrev.addEventListener('click', () => {
        atletaVideo.pause();
        atletaVideo.currentTime = Math.max(0, atletaVideo.currentTime - 0.033);
    });

    btnFrameNext.addEventListener('click', () => {
        atletaVideo.pause();
        atletaVideo.currentTime = Math.min(atletaVideo.duration || 0, atletaVideo.currentTime + 0.033);
    });

    btnLoopToggle.addEventListener('click', () => {
        atletaVideo.loop = !atletaVideo.loop;
        btnLoopToggle.classList.toggle('active', atletaVideo.loop);
        showToast(atletaVideo.loop ? "Loop contínuo ativado" : "Loop desativado");
    });

    speedButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const speed = parseFloat(btn.getAttribute('data-speed'));
            atletaVideo.playbackRate = speed;
            speedButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            showToast(`Câmera Lenta: ${speed}x`);
        });
    });

    btnShareClip.addEventListener('click', () => {
        if (activeClip) shareClipDirectly(activeClip.filename);
    });

    btnFavToggle.addEventListener('click', () => {
        if (activeClip) toggleFavorite(activeClip.filename);
    });
}
