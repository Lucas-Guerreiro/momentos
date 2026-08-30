// ==========================================================================
// MOMENTOS • Portal do Atleta (Engine Estilo Instagram & Reels)
// ==========================================================================

const API_BASE = window.location.origin;

// Credenciais do Supabase (Nuvem & Realtime)
const SUPABASE_URL = "https://wdjyxbrlergrvfilulyv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indkanl4YnJsZXJncnZmaWx1bHl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2OTA4MDIsImV4cCI6MjEwMzI2NjgwMn0.1bVKL8h4iaLz6J_tT3dg3N0zUJmSs5WP3SHwjDi9tqg";
const R2_PUBLIC_URL = "https://pub-bf1a3aa70cd049a8ad4774397028451d.r2.dev";

let supabaseClient = null;
try {
    if (window.supabase) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
} catch (e) {
    console.warn("Supabase client notice:", e);
}

// Estado da Aplicação
let allClips = [];
let filteredClips = [];
let currentFilter = 'all'; // 'all', 'favs', or date string 'YYYY-MM-DD', or camera
let activeNavTab = 'feed'; // 'feed', 'reels', 'favs'
let searchQuery = '';
let activeClip = null;
let currentVarSpeed = 1.0;
let knownClipCount = 0;
let pollingInterval = null;
let lastTapTime = 0;

// Favoritos locais (LocalStorage)
let favorites = JSON.parse(localStorage.getItem('atleta_favs') || '[]');

// Elementos do DOM
const clipsContainer = document.getElementById('clips-container');
const storiesContainer = document.getElementById('stories-container');
const favCountBadge = document.getElementById('fav-count');
const searchDrawer = document.getElementById('search-drawer');
const inputSearch = document.getElementById('input-search');
const btnOpenSearch = document.getElementById('btn-open-search');
const btnClearSearch = document.getElementById('btn-clear-search');
const btnHeaderFavs = document.getElementById('btn-header-favs');
const feedFilterIndicator = document.getElementById('feed-filter-indicator');
const feedFilterText = document.getElementById('feed-filter-text');
const btnResetFilter = document.getElementById('btn-reset-filter');
const newClipsBanner = document.getElementById('new-clips-banner');
const btnBannerLoad = document.getElementById('btn-banner-load');
const toastElement = document.getElementById('toast');

// Elementos do Reels Modal
const playerModal = document.getElementById('player-modal');
const playerBackdrop = document.getElementById('player-backdrop');
const btnClosePlayer = document.getElementById('btn-close-player');
const atletaVideo = document.getElementById('atleta-video');
const playerTitle = document.getElementById('player-title');
const playerCamBadge = document.getElementById('player-cam-badge');
const playerMeta = document.getElementById('player-meta');
const reelsProgressBar = document.getElementById('reels-progress-bar');
const bigHeart = document.getElementById('big-heart');
const btnFavToggle = document.getElementById('btn-fav-toggle');
const favLabel = document.getElementById('fav-label');
const btnVarCycle = document.getElementById('btn-var-cycle');
const varSpeedIndicator = document.getElementById('var-speed-indicator');
const btnShareClip = document.getElementById('btn-share-clip');
const btnDownloadClip = document.getElementById('btn-download-clip');

// Bottom Nav
const navTabFeed = document.getElementById('nav-tab-feed');
const navTabReels = document.getElementById('nav-tab-reels');
const navTabFavs = document.getElementById('nav-tab-favs');
const navTabRefresh = document.getElementById('nav-tab-refresh');

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', () => {
    updateFavBadge();
    loadClips(true);
    setupEventListeners();
    setupRealtimeSubscription();
});

// --- Carregar Lances (Supabase com Fallback Local) ---
async function loadClips(isInitial = false) {
    let loadedFromCloud = false;

    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('lances')
                .select('*')
                .order('created_at', { ascending: false });

            if (!error && data && data.length > 0) {
                allClips = data.map(lance => {
                    const ts = new Date(lance.created_at).getTime() / 1000;
                    const videoUrl = lance.video_url || `${R2_PUBLIC_URL}/${lance.filename}`;
                    const previewUrl = lance.preview_url || videoUrl.replace('pub-bf1a3aa70cd049a8ad4774397028451d.r2.dev/', 'pub-bf1a3aa70cd049a8ad4774397028451d.r2.dev/previews/');
                    const thumbUrl = lance.thumb_url || `${R2_PUBLIC_URL}/thumbs/${lance.filename}.jpg`;

                    return {
                        filename: lance.filename,
                        video_url: videoUrl,
                        preview_url: previewUrl,
                        thumb_url: thumbUrl,
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

    if (!loadedFromCloud) {
        try {
            const response = await fetch(`${API_BASE}/api/clips`);
            if (response.ok) {
                const data = await response.json();
                allClips = data.map(clip => ({
                    filename: clip.filename,
                    video_url: `${API_BASE}/api/clips/${clip.filename}`,
                    preview_url: `${API_BASE}/api/clips/${clip.filename}`,
                    thumb_url: `${API_BASE}/api/clips/${clip.filename}/thumb`,
                    camera_name: extractCameraLabel(clip.filename),
                    size_bytes: clip.size_bytes,
                    created_at: clip.created_at
                }));
            }
        } catch (error) {
            console.error("Erro ao carregar lances locais:", error);
        }
    }

    if (allClips.length > knownClipCount && !isInitial) {
        newClipsBanner.style.display = 'block';
    }
    knownClipCount = allClips.length;

    renderStoriesBar();
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
            .channel('realtime_insta_feed')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lances' }, (payload) => {
                const lance = payload.new;
                const ts = new Date(lance.created_at).getTime() / 1000;
                const videoUrl = lance.video_url || `${R2_PUBLIC_URL}/${lance.filename}`;
                const previewUrl = lance.preview_url || videoUrl.replace('pub-bf1a3aa70cd049a8ad4774397028451d.r2.dev/', 'pub-bf1a3aa70cd049a8ad4774397028451d.r2.dev/previews/');
                const thumbUrl = lance.thumb_url || `${R2_PUBLIC_URL}/thumbs/${lance.filename}.jpg`;

                const newClip = {
                    filename: lance.filename,
                    video_url: videoUrl,
                    preview_url: previewUrl,
                    thumb_url: thumbUrl,
                    camera_name: lance.camera_name || extractCameraLabel(lance.filename),
                    size_bytes: lance.size_bytes || 0,
                    created_at: isNaN(ts) ? Date.now() / 1000 : ts
                };

                allClips.unshift(newClip);
                newClipsBanner.style.display = 'block';
                showToast("🔥 Novo lance gravado na quadra!");
                renderStoriesBar();
            })
            .subscribe();
    } catch (e) {
        console.warn("Fallback para polling:", e);
        startPolling();
    }
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(() => {
        loadClips(false);
    }, 6000);
}

// --- Barra de Stories (Filtros Visuais) ---
function renderStoriesBar() {
    const datesMap = {};
    allClips.forEach(clip => {
        const d = getDayKey(clip.created_at);
        datesMap[d] = (datesMap[d] || 0) + 1;
    });

    const dateKeys = Object.keys(datesMap);
    const todayKey = getDayKey(Date.now() / 1000);

    let storiesHtml = `
        <!-- Story: Todos -->
        <div class="story-item ${currentFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">
            <div class="story-ring">
                <div class="story-avatar">⚽</div>
            </div>
            <span class="story-label">Todos</span>
        </div>
    `;

    if (favorites.length > 0) {
        storiesHtml += `
            <!-- Story: Favoritos -->
            <div class="story-item ${currentFilter === 'favs' ? 'active' : ''}" onclick="setFilter('favs')">
                <div class="story-ring">
                    <div class="story-avatar" style="color: var(--accent-red);">❤️</div>
                </div>
                <span class="story-label">Salvos (${favorites.length})</span>
            </div>
        `;
    }

    dateKeys.forEach(dKey => {
        const isToday = dKey === todayKey;
        const [yyyy, mm, dd] = dKey.split('-');
        const label = isToday ? 'Hoje' : `${dd}/${mm}`;
        const icon = isToday ? '🔥' : '📅';

        storiesHtml += `
            <div class="story-item ${currentFilter === dKey ? 'active' : ''}" onclick="setFilter('${dKey}')">
                <div class="story-ring">
                    <div class="story-avatar">${icon}</div>
                </div>
                <span class="story-label">${label}</span>
            </div>
        `;
    });

    storiesContainer.innerHTML = storiesHtml;
}

// --- Filtros e Renderização do Feed Instagram ---
function applyFiltersAndRender() {
    filteredClips = allClips.filter(clip => {
        // 1. Filtro de Favoritos
        if (currentFilter === 'favs' && !favorites.includes(clip.filename)) {
            return false;
        }

        // 2. Filtro de Data
        if (currentFilter !== 'all' && currentFilter !== 'favs') {
            const clipDateKey = getDayKey(clip.created_at);
            if (clipDateKey !== currentFilter && !clip.filename.includes(currentFilter)) {
                return false;
            }
        }

        // 3. Filtro de Busca
        if (searchQuery) {
            const timeStr = new Date(clip.created_at * 1000).toLocaleTimeString('pt-BR');
            const matchSearch = clip.filename.toLowerCase().includes(searchQuery) ||
                                clip.camera_name.toLowerCase().includes(searchQuery) ||
                                timeStr.includes(searchQuery);
            if (!matchSearch) return false;
        }

        return true;
    });

    // Indicador de Filtro Ativo
    if (currentFilter !== 'all') {
        feedFilterIndicator.style.display = 'flex';
        let label = currentFilter === 'favs' ? 'Lances Salvos ❤️' : `Data: ${currentFilter}`;
        feedFilterText.textContent = `Exibindo: ${label} (${filteredClips.length})`;
    } else {
        feedFilterIndicator.style.display = 'none';
    }

    renderFeed();
}

function renderFeed() {
    if (filteredClips.length === 0) {
        clipsContainer.innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem; color: var(--text-secondary);">
                <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⚽</div>
                <p style="font-weight: 800; font-size: 1rem; color: white;">Nenhum lance encontrado</p>
                <p style="font-size: 0.8rem; margin-top: 4px;">Aperte o botão arcade na quadra para gravar um momento!</p>
            </div>
        `;
        return;
    }

    clipsContainer.innerHTML = filteredClips.map((clip, index) => {
        const isFav = favorites.includes(clip.filename);
        const formattedTime = new Date(clip.created_at * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const timeAgo = formatTimeAgo(clip.created_at);
        const sizeMb = (clip.size_bytes / (1024 * 1024)).toFixed(1);
        const camLabel = clip.camera_name || extractCameraLabel(clip.filename);

        return `
            <article class="insta-post" data-filename="${clip.filename}">
                <!-- Cabeçalho do Post -->
                <div class="post-header">
                    <div class="post-author-group">
                        <div class="post-avatar">⚽</div>
                        <div class="post-meta-text">
                            <div class="post-author-name">
                                Arena Momentos <span class="verified-badge">●</span>
                            </div>
                            <span class="post-time-ago">Lance às ${formattedTime} • ${timeAgo}</span>
                        </div>
                    </div>
                    <span class="post-cam-pill">${camLabel}</span>
                </div>

                <!-- Palco de Mídia (Toque para Abrir / Double-Tap para Curtir) -->
                <div class="post-media-stage" onclick="handlePostMediaClick('${clip.filename}', event)">
                    <img class="post-thumb-img" src="${clip.thumb_url}" loading="lazy" alt="Lance">
                    <div class="post-overlay">
                        <div class="play-bubble-insta">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                        </div>
                    </div>
                </div>

                <!-- Barra de Ações (Instagram Style) -->
                <div class="post-actions-bar">
                    <div class="actions-left">
                        <!-- Curtir -->
                        <button class="action-btn btn-like ${isFav ? 'active' : ''}" onclick="toggleFavorite('${clip.filename}', event)" title="Curtir lance">
                            <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2">
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                            </svg>
                        </button>

                        <!-- Assistir em Câmera Lenta / Reels -->
                        <button class="action-btn btn-var" onclick="openReelsPlayer('${clip.filename}')" title="Câmera Lenta / VAR">
                            <span>⚡ VAR Lenta</span>
                        </button>

                        <!-- WhatsApp -->
                        <button class="action-btn btn-whatsapp" onclick="shareDirect('${clip.filename}', event)" title="Enviar no WhatsApp">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                <circle cx="18" cy="5" r="3"></circle>
                                <circle cx="6" cy="12" r="3"></circle>
                                <circle cx="18" cy="19" r="3"></circle>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                            </svg>
                        </button>
                    </div>

                    <!-- Baixar Original em Alta Qualidade -->
                    <a href="${clip.video_url}" download="${clip.filename}" class="action-btn btn-download" onclick="showToast('Iniciando download em Full HD... 💾')" title="Baixar Vídeo Original">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                        </svg>
                    </a>
                </div>

                <!-- Legenda do Lance -->
                <div class="post-caption-box">
                    <div class="likes-counter">${isFav ? 'Curtido por você ⭐' : 'Toque para assistir e salvar'}</div>
                    <div class="caption-text">
                        <strong>Arena Momentos</strong> Lance gravado na ${camLabel} • ${sizeMb} MB
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

// --- Interação de Toque no Vídeo (Double-Tap para Curtir / Single para Abrir) ---
function handlePostMediaClick(filename, event) {
    const now = Date.now();
    const timeDiff = now - lastTapTime;

    if (timeDiff < 300 && timeDiff > 0) {
        // Double-Tap detectado: Curtir lance!
        if (!favorites.includes(filename)) {
            toggleFavorite(filename);
        }
        showBigHeartAnimation();
    } else {
        // Single tap: Abre no modo Reels
        openReelsPlayer(filename);
    }
    lastTapTime = now;
}

// --- Player em Modo "Reels" / Tela Cheia ---
function openReelsPlayer(filename) {
    const clip = allClips.find(c => c.filename === filename);
    if (!clip) return;

    activeClip = clip;
    currentVarSpeed = 1.0;
    const isFav = favorites.includes(filename);
    const dateFormatted = formatDateTime(clip.created_at);
    const sizeMb = (clip.size_bytes / (1024 * 1024)).toFixed(1);

    playerTitle.textContent = "Arena Momentos";
    playerCamBadge.textContent = clip.camera_name;
    playerMeta.textContent = `Lance gravado às ${dateFormatted} • ${sizeMb} MB (Full HD)`;
    
    // Configura botões do Reels
    btnDownloadClip.href = clip.video_url;
    btnDownloadClip.setAttribute('download', filename);
    updateFavUI(isFav);
    varSpeedIndicator.textContent = "1.0x";

    // Carrega o vídeo com Preview Otimizado
    atletaVideo.src = clip.preview_url || clip.video_url;
    atletaVideo.playbackRate = 1.0;
    atletaVideo.currentTime = 0;

    playerModal.classList.add('active');
    document.body.style.overflow = 'hidden';

    atletaVideo.play().catch(() => {});
}

function closeReelsPlayer() {
    atletaVideo.pause();
    atletaVideo.src = '';
    playerModal.classList.remove('active');
    document.body.style.overflow = '';
    activeClip = null;
}

// --- Ciclo de Velocidades do VAR (1.0x -> 0.5x -> 0.25x) ---
function cycleVarSpeed() {
    if (!atletaVideo) return;

    if (currentVarSpeed === 1.0) {
        currentVarSpeed = 0.5;
        showToast("⚡ Câmera Lenta: 0.5x");
    } else if (currentVarSpeed === 0.5) {
        currentVarSpeed = 0.25;
        showToast("⚡ Câmera Super Lenta (VAR): 0.25x");
    } else {
        currentVarSpeed = 1.0;
        showToast("▶️ Velocidade Normal: 1.0x");
    }

    atletaVideo.playbackRate = currentVarSpeed;
    varSpeedIndicator.textContent = `${currentVarSpeed}x`;
}

// --- Animação de Coração Flutuante ---
function showBigHeartAnimation() {
    bigHeart.classList.add('animate');
    setTimeout(() => {
        bigHeart.classList.remove('animate');
    }, 600);
}

// --- Favoritos ---
function toggleFavorite(filename, e) {
    if (e) e.stopPropagation();

    const index = favorites.indexOf(filename);
    if (index > -1) {
        favorites.splice(index, 1);
        showToast("Removido dos salvos");
    } else {
        favorites.push(filename);
        showToast("Salvo nos seus lances favoritos ❤️");
        showBigHeartAnimation();
    }

    localStorage.setItem('atleta_favs', JSON.stringify(favorites));
    updateFavBadge();
    renderStoriesBar();
    applyFiltersAndRender();

    if (activeClip && activeClip.filename === filename) {
        updateFavUI(favorites.includes(filename));
    }
}

function updateFavUI(isFav) {
    btnFavToggle.classList.toggle('active', isFav);
    favLabel.textContent = isFav ? 'Salvo' : 'Curtir';
}

function updateFavBadge() {
    favCountBadge.textContent = favorites.length;
}

function setFilter(filterType) {
    currentFilter = filterType;
    renderStoriesBar();
    applyFiltersAndRender();
}

// --- Compartilhamento Direto / WhatsApp ---
async function shareDirect(filename, e) {
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
                copyToClipboard(videoUrl);
            }
        }
    } else {
        copyToClipboard(videoUrl);
    }
}

function copyToClipboard(url) {
    navigator.clipboard.writeText(url).then(() => {
        showToast("Link do lance copiado! Cole no WhatsApp 📋");
    }).catch(() => {
        prompt("Copie o link do lance:", url);
    });
}

// --- Listeners e Controles de Eventos ---
function setupEventListeners() {
    // Busca
    btnOpenSearch.addEventListener('click', () => {
        const isHidden = searchDrawer.style.display === 'none';
        searchDrawer.style.display = isHidden ? 'block' : 'none';
        if (isHidden) inputSearch.focus();
    });

    inputSearch.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        applyFiltersAndRender();
    });

    btnClearSearch.addEventListener('click', () => {
        inputSearch.value = '';
        searchQuery = '';
        searchDrawer.style.display = 'none';
        applyFiltersAndRender();
    });

    btnResetFilter.addEventListener('click', () => {
        setFilter('all');
    });

    btnHeaderFavs.addEventListener('click', () => {
        setFilter(currentFilter === 'favs' ? 'all' : 'favs');
    });

    // Modal Reels
    btnClosePlayer.addEventListener('click', closeReelsPlayer);
    playerBackdrop.addEventListener('click', closeReelsPlayer);
    btnVarCycle.addEventListener('click', cycleVarSpeed);
    
    btnFavToggle.addEventListener('click', () => {
        if (activeClip) toggleFavorite(activeClip.filename);
    });

    btnShareClip.addEventListener('click', (e) => {
        if (activeClip) shareDirect(activeClip.filename, e);
    });

    // Atualização de Progresso do Vídeo no Reels
    atletaVideo.addEventListener('timeupdate', () => {
        if (atletaVideo.duration) {
            const pct = (atletaVideo.currentTime / atletaVideo.duration) * 100;
            reelsProgressBar.style.width = `${pct}%`;
        }
    });

    // Toque no vídeo do Reels para Pausar/Play
    atletaVideo.addEventListener('click', () => {
        if (atletaVideo.paused) {
            atletaVideo.play();
        } else {
            atletaVideo.pause();
        }
    });

    // Banner de novos lances
    btnBannerLoad.addEventListener('click', () => {
        newClipsBanner.style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        loadClips(true);
    });

    // Bottom Navigation Tabs
    navTabFeed.addEventListener('click', () => {
        setFilter('all');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        updateNavTabs('feed');
    });

    navTabReels.addEventListener('click', () => {
        if (allClips.length > 0) {
            openReelsPlayer(allClips[0].filename);
        }
    });

    navTabFavs.addEventListener('click', () => {
        setFilter('favs');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        updateNavTabs('favs');
    });

    navTabRefresh.addEventListener('click', () => {
        showToast("Atualizando lances... 🔄");
        loadClips(true);
    });
}

function updateNavTabs(tab) {
    document.querySelectorAll('.bottom-nav .nav-item').forEach(item => item.classList.remove('active'));
    if (tab === 'feed') navTabFeed.classList.add('active');
    if (tab === 'favs') navTabFavs.classList.add('active');
}

// --- Utilitários ---
function getDayKey(timestampSec) {
    const d = new Date(timestampSec * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateTime(timestampSec) {
    const d = new Date(timestampSec * 1000);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatTimeAgo(timestampSec) {
    const diff = Math.floor(Date.now() / 1000 - timestampSec);
    if (diff < 60) return "agora";
    if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
    return `há ${Math.floor(diff / 86400)} d`;
}

function extractCameraLabel(filename) {
    if (filename.includes('cam_1787010398') || filename.includes('cam_1787619412')) return 'Câmera 2';
    return 'Câmera Principal';
}

function showToast(msg) {
    toastElement.textContent = msg;
    toastElement.classList.add('show');
    setTimeout(() => {
        toastElement.classList.remove('show');
    }, 2800);
}
