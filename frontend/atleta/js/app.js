// ==========================================================================
// MOMENTOS • Engine do Portal do Atleta (Instagram Reels & TikTok Swipe)
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

// Estado Global da Aplicação
let allClips = [];
let filteredClips = [];
let currentFilter = 'all'; // 'all', 'today', 'favs', or date 'YYYY-MM-DD'
let currentViewMode = 'reels'; // 'reels' or 'grid'
let isMuted = true; // Começa mudo para permitir autoplay no mobile sem bloqueio
let currentSpeed = 1.0;
let activeSlideIndex = 0;
let knownClipCount = 0;
let pollingInterval = null;
let currentActiveVideo = null;
let currentActiveSlide = null;
let intersectionObserver = null;

// Favoritos locais no dispositivo do atleta
let favorites = JSON.parse(localStorage.getItem('atleta_favs') || '[]');

// Elementos DOM
const reelsFeed = document.getElementById('reels-feed');
const gridExplore = document.getElementById('grid-explore');
const gridClipsContainer = document.getElementById('grid-clips-container');
const storiesContainer = document.getElementById('stories-container');
const topFavCount = document.getElementById('top-fav-count');
const btnGlobalAudio = document.getElementById('btn-global-audio');
const iconAudioMuted = document.querySelector('.icon-audio-muted');
const iconAudioOn = document.querySelector('.icon-audio-on');
const btnToggleView = document.getElementById('btn-toggle-view');
const iconGridView = document.querySelector('.icon-grid-view');
const iconReelsView = document.querySelector('.icon-reels-view');
const newClipsBanner = document.getElementById('new-clips-banner');
const toastElement = document.getElementById('toast');

// Modal Speed Sheet
const speedSheetBackdrop = document.getElementById('speed-sheet-backdrop');
const btnCloseSpeedSheet = document.getElementById('btn-close-speed-sheet');
const speedOptButtons = document.querySelectorAll('.speed-opt');

// Abas do Topo
const tabAll = document.getElementById('tab-all');
const tabToday = document.getElementById('tab-today');
const tabFavs = document.getElementById('tab-favs');

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
        newClipsBanner.style.display = 'flex';
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
            .channel('realtime_reels_feed')
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
                newClipsBanner.style.display = 'flex';
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

// --- Barra de Stories (Pílulas de Datas) ---
function renderStoriesBar() {
    const datesMap = {};
    allClips.forEach(clip => {
        const d = getDayKey(clip.created_at);
        datesMap[d] = (datesMap[d] || 0) + 1;
    });

    const dateKeys = Object.keys(datesMap);
    const todayKey = getDayKey(Date.now() / 1000);

    let storiesHtml = `
        <button class="story-pill ${currentFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">
            <span>⚽ Todos</span>
        </button>
    `;

    dateKeys.forEach(dKey => {
        const isToday = dKey === todayKey;
        const [yyyy, mm, dd] = dKey.split('-');
        const label = isToday ? '🔥 Hoje' : `📅 ${dd}/${mm}`;

        storiesHtml += `
            <button class="story-pill ${currentFilter === dKey ? 'active' : ''}" onclick="setFilter('${dKey}')">
                <span>${label} (${datesMap[dKey]})</span>
            </button>
        `;
    });

    storiesContainer.innerHTML = storiesHtml;
}

// --- Filtros e Renderização ---
function applyFiltersAndRender() {
    const todayKey = getDayKey(Date.now() / 1000);

    filteredClips = allClips.filter(clip => {
        if (currentFilter === 'favs') {
            return favorites.includes(clip.filename);
        }
        if (currentFilter === 'today') {
            return getDayKey(clip.created_at) === todayKey;
        }
        if (currentFilter !== 'all') {
            return getDayKey(clip.created_at) === currentFilter;
        }
        return true;
    });

    updateTopTabsUI();

    if (currentViewMode === 'reels') {
        renderReelsFeed();
    } else {
        renderGridView();
    }
}

// --- MODO 1: RENDERIZAÇÃO DO FEED REELS (Arrastar para Cima) ---
function renderReelsFeed() {
    if (filteredClips.length === 0) {
        reelsFeed.innerHTML = `
            <div class="reels-loading-placeholder">
                <div style="font-size: 3rem; margin-bottom: 0.5rem;">⚽</div>
                <p style="font-weight: 800; font-size: 1.1rem; color: #fff;">Nenhum lance encontrado</p>
                <p style="font-size: 0.8rem; color: var(--text-muted);">Aperte o botão arcade na quadra para gravar um momento!</p>
            </div>
        `;
        return;
    }

    reelsFeed.innerHTML = filteredClips.map((clip, index) => {
        const isFav = favorites.includes(clip.filename);
        const formattedTime = new Date(clip.created_at * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const timeAgo = formatTimeAgo(clip.created_at);
        const sizeMb = (clip.size_bytes / (1024 * 1024)).toFixed(1);
        const camLabel = clip.camera_name || extractCameraLabel(clip.filename);

        return `
            <div class="reel-slide" data-filename="${clip.filename}" data-index="${index}">
                <!-- Fundo desfocado com miniatura garantida -->
                <div class="reel-backdrop-blur" style="background-image: url('${clip.thumb_url}');"></div>

                <!-- Imagem de Poster sempre visível como fallback (sem tela preta) -->
                <img class="reel-poster-fallback" src="${clip.thumb_url}" alt="Lance" loading="eager">

                <!-- Vídeo em Stream Preview -->
                <video class="reel-video" 
                       playsinline 
                       webkit-playsinline
                       muted
                       loop 
                       preload="auto" 
                       poster="${clip.thumb_url}"
                       src="${clip.preview_url || clip.video_url}"></video>

                <!-- Coração Gigante (Double-Tap) -->
                <div class="reel-big-heart">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path>
                    </svg>
                </div>

                <!-- Indicador de Play/Pause -->
                <div class="reel-tap-indicator">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                </div>

                <!-- Barra Lateral Direita de Ações (Reels Style) -->
                <div class="reel-actions-rail">
                    <!-- Curtir -->
                    <button class="action-rail-btn btn-like ${isFav ? 'active' : ''}" 
                            onclick="toggleFavorite('${clip.filename}', this, event)">
                        <div class="rail-btn-icon">
                            <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2">
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                            </svg>
                        </div>
                        <span class="rail-btn-label">${isFav ? 'Salvo' : 'Curtir'}</span>
                    </button>

                    <!-- VAR / Menu de Velocidades (0.25x a 2.0x) -->
                    <button class="action-rail-btn btn-var" 
                            onclick="openSpeedSheetForSlide(this, event)">
                        <div class="rail-btn-icon">
                            <span class="var-speed-badge">1.0x</span>
                        </div>
                        <span class="rail-btn-label">Velocidade</span>
                    </button>

                    <!-- WhatsApp -->
                    <button class="action-rail-btn btn-whatsapp" 
                            onclick="shareClipDirect('${clip.filename}', event)">
                        <div class="rail-btn-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                <circle cx="18" cy="5" r="3"></circle>
                                <circle cx="6" cy="12" r="3"></circle>
                                <circle cx="18" cy="19" r="3"></circle>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                            </svg>
                        </div>
                        <span class="rail-btn-label">WhatsApp</span>
                    </button>

                    <!-- Baixar Original em Alta Qualidade -->
                    <a href="${clip.video_url}" 
                       download="${clip.filename}" 
                       class="action-rail-btn btn-download" 
                       onclick="showToast('Iniciando download em Full HD... 💾')">
                        <div class="rail-btn-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </div>
                        <span class="rail-btn-label">Baixar</span>
                    </a>
                </div>

                <!-- Overlay de Informações e Legenda no Rodapé -->
                <div class="reel-bottom-overlay">
                    <div class="reel-author-row">
                        <div class="reel-avatar-bubble">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="12" cy="12" r="10"></circle>
                            </svg>
                        </div>
                        <span class="reel-author-name">Arena Momentos</span>
                        <span class="reel-camera-tag">${camLabel}</span>
                    </div>

                    <div class="reel-caption-text">
                        <svg class="ico-lance-bullet" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        <strong>Lance às ${formattedTime}</strong> • ${timeAgo} • ${sizeMb} MB
                    </div>

                    <div class="reel-progress-track">
                        <div class="reel-progress-fill"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    setupReelsObserver();
    setupSlideGestures();
}

// --- Observador de Interseção (Autoplay no vídeo visível / Pause nos outros) ---
function setupReelsObserver() {
    if (intersectionObserver) {
        intersectionObserver.disconnect();
    }

    const options = {
        root: reelsFeed,
        threshold: 0.65
    };

    intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const slide = entry.target;
            const video = slide.querySelector('video');
            const poster = slide.querySelector('.reel-poster-fallback');
            const progressFill = slide.querySelector('.reel-progress-fill');

            if (entry.isIntersecting) {
                currentActiveVideo = video;
                currentActiveSlide = slide;
                activeSlideIndex = parseInt(slide.getAttribute('data-index') || '0');

                video.muted = isMuted;
                video.playbackRate = currentSpeed;
                video.currentTime = 0;
                
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        if (poster) poster.style.opacity = '0';
                    }).catch(() => {
                        // Se o navegador bloquear áudio, garante mudo e toca
                        video.muted = true;
                        video.play().catch(() => {});
                    });
                }

                // Vincula atualização de tempo na barra de progresso do slide ativo
                video.ontimeupdate = () => {
                    if (video.duration && progressFill) {
                        const pct = (video.currentTime / video.duration) * 100;
                        progressFill.style.width = `${pct}%`;
                    }
                };
            } else {
                video.pause();
                video.currentTime = 0;
                video.ontimeupdate = null;
                if (poster) poster.style.opacity = '1';
                if (progressFill) progressFill.style.width = '0%';
            }
        });
    }, options);

    document.querySelectorAll('.reel-slide').forEach(slide => {
        intersectionObserver.observe(slide);
    });
}

// --- Gestos de Toque (Double-Tap para Curtir / Single para Play-Pause) ---
function setupSlideGestures() {
    document.querySelectorAll('.reel-slide').forEach(slide => {
        let lastTap = 0;
        const video = slide.querySelector('video');
        const heartAnim = slide.querySelector('.reel-big-heart');
        const tapIndicator = slide.querySelector('.reel-tap-indicator');
        const filename = slide.getAttribute('data-filename');
        const likeBtn = slide.querySelector('.btn-like');

        slide.addEventListener('click', (e) => {
            if (e.target.closest('.reel-actions-rail') || e.target.closest('.reel-author-row')) {
                return;
            }

            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;

            if (tapLength < 300 && tapLength > 0) {
                // Double-Tap: Curtir lance com coração gigante! ❤️
                if (!favorites.includes(filename)) {
                    toggleFavorite(filename, likeBtn);
                }
                heartAnim.classList.add('animate');
                setTimeout(() => heartAnim.classList.remove('animate'), 650);
            } else {
                // Single-Tap: Play / Pause
                if (video.paused) {
                    video.play();
                } else {
                    video.pause();
                    tapIndicator.classList.add('show');
                    setTimeout(() => tapIndicator.classList.remove('show'), 350);
                }
            }
            lastTap = currentTime;
        });
    });
}

// --- Menu / Bottom Sheet de Velocidades (0.25x a 2.0x) ---
function openSpeedSheetForSlide(btn, e) {
    if (e) e.stopPropagation();
    speedSheetBackdrop.style.display = 'flex';
    
    // Atualiza botões ativos na sheet
    speedOptButtons.forEach(opt => {
        const sp = parseFloat(opt.getAttribute('data-speed'));
        opt.classList.toggle('active', sp === currentSpeed);
    });
}

function selectSpeed(speed) {
    currentSpeed = speed;
    if (currentActiveVideo) {
        currentActiveVideo.playbackRate = speed;
    }

    // Atualiza badges em todos os slides
    document.querySelectorAll('.var-speed-badge').forEach(b => {
        b.textContent = `${speed}x`;
    });

    speedSheetBackdrop.style.display = 'none';
    showToast(`⚡ Velocidade do lance ajustada: ${speed}x`);
}

// --- Alternador Global de Áudio (Mutado / Com Som) ---
function toggleGlobalAudio() {
    isMuted = !isMuted;
    if (currentActiveVideo) {
        currentActiveVideo.muted = isMuted;
        if (!isMuted && currentActiveVideo.paused) {
            currentActiveVideo.play().catch(() => {});
        }
    }

    iconAudioMuted.style.display = isMuted ? 'block' : 'none';
    iconAudioOn.style.display = isMuted ? 'none' : 'block';

    showToast(isMuted ? "🔇 Vídeo no mudo" : "🔊 Som ativado!");
}

// --- MODO 2: RENDERIZAÇÃO DA GRADE DE EXPLORAR ---
function renderGridView() {
    if (filteredClips.length === 0) {
        gridClipsContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                <p style="font-weight: 800; color: #fff;">Nenhum lance na grade</p>
            </div>
        `;
        return;
    }

    gridClipsContainer.innerHTML = filteredClips.map((clip, index) => {
        const formattedTime = new Date(clip.created_at * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="grid-thumb-card" onclick="jumpToReel(${index})">
                <img class="grid-thumb-img" src="${clip.thumb_url}" loading="lazy" alt="Lance">
                <span class="grid-thumb-badge">${formattedTime}</span>
            </div>
        `;
    }).join('');
}

function jumpToReel(index) {
    toggleViewMode('reels');
    const targetSlide = document.querySelector(`.reel-slide[data-index="${index}"]`);
    if (targetSlide) {
        targetSlide.scrollIntoView({ behavior: 'auto' });
    }
}

// --- Favoritos (Salvos) ---
function toggleFavorite(filename, btnElement, e) {
    if (e) e.stopPropagation();

    const index = favorites.indexOf(filename);
    if (index > -1) {
        favorites.splice(index, 1);
        showToast("Removido dos salvos");
        if (btnElement) {
            btnElement.classList.remove('active');
            btnElement.querySelector('.rail-btn-label').textContent = 'Curtir';
            btnElement.querySelector('svg').setAttribute('fill', 'none');
        }
    } else {
        favorites.push(filename);
        showToast("Salvo nos seus lances favoritos ❤️");
        if (btnElement) {
            btnElement.classList.add('active');
            btnElement.querySelector('.rail-btn-label').textContent = 'Salvo';
            btnElement.querySelector('svg').setAttribute('fill', 'currentColor');
        }
    }

    localStorage.setItem('atleta_favs', JSON.stringify(favorites));
    updateFavBadge();

    if (currentFilter === 'favs') {
        applyFiltersAndRender();
    }
}

function updateFavBadge() {
    topFavCount.textContent = favorites.length;
}

function setFilter(filterType) {
    currentFilter = filterType;
    applyFiltersAndRender();
    renderStoriesBar();
}

function updateTopTabsUI() {
    tabAll.classList.toggle('active', currentFilter === 'all');
    tabToday.classList.toggle('active', currentFilter === 'today');
    tabFavs.classList.toggle('active', currentFilter === 'favs');
}

// --- Alternância entre Reels e Grade ---
function toggleViewMode(forcedMode) {
    if (forcedMode) {
        currentViewMode = forcedMode;
    } else {
        currentViewMode = currentViewMode === 'reels' ? 'grid' : 'reels';
    }

    if (currentViewMode === 'reels') {
        reelsFeed.style.display = 'block';
        gridExplore.style.display = 'none';
        iconGridView.style.display = 'block';
        iconReelsView.style.display = 'none';
        renderReelsFeed();
    } else {
        reelsFeed.style.display = 'none';
        gridExplore.style.display = 'block';
        iconGridView.style.display = 'none';
        iconReelsView.style.display = 'block';
        if (currentActiveVideo) currentActiveVideo.pause();
        renderGridView();
    }
}

// --- Compartilhamento Direto / WhatsApp ---
async function shareClipDirect(filename, e) {
    if (e) e.stopPropagation();

    const targetClip = allClips.find(c => c.filename === filename);
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

// --- Configuração de Eventos Globais ---
function setupEventListeners() {
    tabAll.addEventListener('click', () => setFilter('all'));
    tabToday.addEventListener('click', () => setFilter('today'));
    tabFavs.addEventListener('click', () => setFilter('favs'));

    btnGlobalAudio.addEventListener('click', toggleGlobalAudio);
    btnToggleView.addEventListener('click', () => toggleViewMode());

    // Botões de Velocidade
    speedOptButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const sp = parseFloat(btn.getAttribute('data-speed'));
            selectSpeed(sp);
        });
    });

    btnCloseSpeedSheet.addEventListener('click', () => {
        speedSheetBackdrop.style.display = 'none';
    });

    speedSheetBackdrop.addEventListener('click', (e) => {
        if (e.target === speedSheetBackdrop) {
            speedSheetBackdrop.style.display = 'none';
        }
    });

    // Banner de novos lances em tempo real
    newClipsBanner.addEventListener('click', () => {
        newClipsBanner.style.display = 'none';
        loadClips(true);
        if (reelsFeed) reelsFeed.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Navegação por teclado (Seta Cima / Baixo e Espaço)
    window.addEventListener('keydown', (e) => {
        if (currentViewMode !== 'reels') return;
        if (e.key === 'ArrowDown') {
            reelsFeed.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        } else if (e.key === 'ArrowUp') {
            reelsFeed.scrollBy({ top: -window.innerHeight, behavior: 'smooth' });
        } else if (e.key === ' ') {
            e.preventDefault();
            if (currentActiveVideo) {
                if (currentActiveVideo.paused) currentActiveVideo.play();
                else currentActiveVideo.pause();
            }
        }
    });
}

// --- Utilitários ---
function getDayKey(timestampSec) {
    const d = new Date(timestampSec * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
