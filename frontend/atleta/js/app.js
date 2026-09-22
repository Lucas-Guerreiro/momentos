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
const gridCountLabel = document.getElementById('grid-count-label');
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
                    const previewUrl = lance.preview_url || videoUrl;
                    const thumbUrl = lance.thumb_url || `${API_BASE}/api/clips/${lance.filename}/thumb`;

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
                const previewUrl = lance.preview_url || videoUrl;
                const thumbUrl = lance.thumb_url || `${API_BASE}/api/clips/${lance.filename}/thumb`;

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
                showToast("Novo lance gravado na quadra!");
                renderStoriesBar();
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'lances' }, (payload) => {
                const deletedFilename = payload.old ? payload.old.filename : null;
                if (deletedFilename) {
                    allClips = allClips.filter(c => c.filename !== deletedFilename);
                    applyFiltersAndRender();
                } else {
                    loadClips(false);
                }
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

// --- Barra de Stories (Pílulas de Datas com Ícones SVG) ---
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
            <svg class="story-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polygon points="12 6 16 9 15 14 9 14 8 9"></polygon>
            </svg>
            <span>Todos</span>
        </button>
    `;

    dateKeys.forEach(dKey => {
        const isToday = dKey === todayKey;
        const [yyyy, mm, dd] = dKey.split('-');
        const label = isToday ? 'Hoje' : `${dd}/${mm}`;

        const iconSvg = isToday ? `
            <svg class="story-ico" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 23c-4.97 0-9-4.03-9-9 0-3.93 2.53-7.27 6.07-8.49.52-.18 1.05.21 1.05.76v.36c0 .35.21.67.54.8 1.13.45 2.01 1.39 2.41 2.55.22.65 1.07.82 1.52.31.81-.92 1.41-2.02 1.41-3.28 0-.47.45-.82.91-.71C19.78 7.37 21 10.53 21 14c0 4.97-4.03 9-9 9z"/>
            </svg>
        ` : `
            <svg class="story-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
        `;

        storiesHtml += `
            <button class="story-pill ${currentFilter === dKey ? 'active' : ''}" onclick="setFilter('${dKey}')">
                ${iconSvg}
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 8px;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polygon points="12 6 16 9 15 14 9 14 8 9"></polygon>
                </svg>
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
        const videoSrc = clip.preview_url || clip.video_url;
        const isFirst = index === 0;

        return `
            <div class="reel-slide" data-filename="${clip.filename}" data-index="${index}">
                <!-- Fundo desfocado com miniatura garantida -->
                <div class="reel-backdrop-blur" style="background-image: url('${clip.thumb_url}');"></div>

                <!-- Imagem de Poster sempre visível como fallback (sem tela preta) -->
                <img class="reel-poster-fallback" src="${clip.thumb_url}" alt="Lance" loading="${isFirst ? 'eager' : 'lazy'}" onerror="this.style.display='none'">

                <!-- Vídeo em Stream Preview (Lazy Loaded) -->
                <video class="reel-video" 
                       playsinline 
                       webkit-playsinline
                       muted
                       loop 
                       preload="${isFirst ? 'auto' : 'none'}" 
                       poster="${clip.thumb_url}"
                       ${isFirst ? `src="${videoSrc}#t=0.001"` : ''}
                       data-src="${videoSrc}#t=0.001"></video>

                <!-- Badge de Zoom por Pinça -->
                <div class="reel-zoom-badge">🔍 1.0x Zoom</div>

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

                    <!-- Editar Lance (Trim, Crop 9:16, Texto, Instagram) -->
                    <button class="action-rail-btn btn-edit-clip" 
                            onclick="openVideoStudio('${clip.filename}', event)">
                        <div class="rail-btn-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                <circle cx="6" cy="6" r="3"></circle>
                                <circle cx="6" cy="18" r="3"></circle>
                                <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
                                <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
                                <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
                            </svg>
                        </div>
                        <span class="rail-btn-label">Editar</span>
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

// --- Observador de Interseção (Lazy Loading & Autoplay no slide ativo) ---
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

                // Carrega source sob demanda se ainda não estiver carregado
                if (!video.src && video.getAttribute('data-src')) {
                    video.src = video.getAttribute('data-src');
                }

                // Preload do próximo slide
                const nextSlide = document.querySelector(`.reel-slide[data-index="${activeSlideIndex + 1}"]`);
                if (nextSlide) {
                    const nextVid = nextSlide.querySelector('video');
                    if (nextVid && !nextVid.src && nextVid.getAttribute('data-src')) {
                        nextVid.src = nextVid.getAttribute('data-src');
                        nextVid.preload = 'metadata';
                    }
                }

                video.muted = isMuted;
                video.playbackRate = currentSpeed;
                
                // Transiciona suavemente assim que o vídeo desenhar o frame
                video.onplaying = () => {
                    if (poster) poster.style.opacity = '0';
                };

                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => {
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

// --- Gestos de Toque (Double-Tap para Curtir / Pinch-to-Zoom de 2 Dedos / Panning) ---
function setupSlideGestures() {
    document.querySelectorAll('.reel-slide').forEach(slide => {
        let lastTap = 0;
        const video = slide.querySelector('video');
        const poster = slide.querySelector('.reel-poster-fallback');
        const heartAnim = slide.querySelector('.reel-big-heart');
        const tapIndicator = slide.querySelector('.reel-tap-indicator');
        const zoomBadge = slide.querySelector('.reel-zoom-badge');
        const filename = slide.getAttribute('data-filename');
        const likeBtn = slide.querySelector('.btn-like');

        // Estado do Pinch-to-Zoom
        let scale = 1;
        let lastScale = 1;
        let posX = 0;
        let posY = 0;
        let startX = 0;
        let startY = 0;
        let initialDistance = 0;
        let isPinching = false;
        let isPanning = false;

        function updateTransform() {
            if (scale < 1) scale = 1;
            if (scale > 4.5) scale = 4.5;

            const maxPanX = (scale - 1) * (slide.clientWidth / 2);
            const maxPanY = (scale - 1) * (slide.clientHeight / 2);
            posX = Math.max(-maxPanX, Math.min(maxPanX, posX));
            posY = Math.max(-maxPanY, Math.min(maxPanY, posY));

            const transformStr = `translate3d(${posX}px, ${posY}px, 0) scale(${scale})`;
            if (video) video.style.transform = transformStr;
            if (poster) poster.style.transform = transformStr;

            if (scale > 1.05) {
                slide.classList.add('is-zoomed');
                if (zoomBadge) {
                    zoomBadge.textContent = `🔍 ${scale.toFixed(1)}x Zoom (Toque duplo para resetar)`;
                    zoomBadge.style.opacity = '1';
                }
            } else {
                slide.classList.remove('is-zoomed');
                if (zoomBadge) zoomBadge.style.opacity = '0';
                posX = 0;
                posY = 0;
            }
        }

        function resetZoom() {
            scale = 1;
            lastScale = 1;
            posX = 0;
            posY = 0;
            if (video) {
                video.style.transition = 'transform 0.25s ease';
                setTimeout(() => { if (video) video.style.transition = ''; }, 250);
            }
            if (poster) {
                poster.style.transition = 'transform 0.25s ease';
                setTimeout(() => { if (poster) poster.style.transition = ''; }, 250);
            }
            updateTransform();
        }

        function getDistance(t1, t2) {
            return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        }

        // Touch Listeners: Pinça com 2 dedos e Pan com 1 dedo
        slide.addEventListener('touchstart', (e) => {
            if (e.target.closest('.reel-actions-rail') || e.target.closest('.reel-author-row')) return;

            if (e.touches.length === 2) {
                isPinching = true;
                initialDistance = getDistance(e.touches[0], e.touches[1]);
                lastScale = scale;
                e.preventDefault();
            } else if (e.touches.length === 1 && scale > 1.05) {
                isPanning = true;
                startX = e.touches[0].clientX - posX;
                startY = e.touches[0].clientY - posY;
            }
        }, { passive: false });

        slide.addEventListener('touchmove', (e) => {
            if (isPinching && e.touches.length === 2) {
                e.preventDefault();
                const currentDistance = getDistance(e.touches[0], e.touches[1]);
                if (initialDistance > 0) {
                    const diff = currentDistance / initialDistance;
                    scale = lastScale * diff;
                    updateTransform();
                }
            } else if (isPanning && e.touches.length === 1 && scale > 1.05) {
                e.preventDefault();
                posX = e.touches[0].clientX - startX;
                posY = e.touches[0].clientY - startY;
                updateTransform();
            }
        }, { passive: false });

        slide.addEventListener('touchend', (e) => {
            if (e.touches.length < 2) {
                isPinching = false;
                lastScale = scale;
            }
            if (e.touches.length === 0) {
                isPanning = false;
                if (scale <= 1.05) {
                    resetZoom();
                }
            }
        });

        // Clique e Double-Tap
        slide.addEventListener('click', (e) => {
            if (e.target.closest('.reel-actions-rail') || e.target.closest('.reel-author-row')) {
                return;
            }

            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;

            if (tapLength < 300 && tapLength > 0) {
                if (scale > 1.05) {
                    resetZoom();
                } else {
                    if (!favorites.includes(filename)) {
                        toggleFavorite(filename, likeBtn);
                    }
                    heartAnim.classList.add('animate');
                    setTimeout(() => heartAnim.classList.remove('animate'), 650);
                }
            } else {
                if (scale <= 1.05) {
                    if (video.paused) {
                        video.play();
                    } else {
                        video.pause();
                        tapIndicator.classList.add('show');
                        setTimeout(() => tapIndicator.classList.remove('show'), 350);
                    }
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
    showToast(`Velocidade do lance: ${speed}x`);
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

    showToast(isMuted ? "Vídeo no mudo" : "Som ativado!");
}

// --- MODO 2: RENDERIZAÇÃO DA GRADE DE EXPLORAR (Miniaturas Imediatas) ---
function renderGridView() {
    if (gridCountLabel) {
        gridCountLabel.textContent = `Exibindo ${filteredClips.length} lances gravados`;
    }

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
                <img class="grid-thumb-img" 
                     src="${clip.thumb_url}" 
                     loading="lazy" 
                     alt="Lance"
                     onerror="this.style.opacity='0.4'">
                <div class="grid-card-overlay">
                    <div class="grid-card-top">
                        <svg class="grid-play-icon" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                    </div>
                    <span class="grid-thumb-badge">${formattedTime}</span>
                </div>
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
        showToast("Salvo nos seus lances favoritos");
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
        iconReelsView.style.display = 'none'; // Mostra ícone de voltar para Reels
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

    // Inicializa controles do Estúdio de Edição do Atleta
    setupStudioEventListeners();
}

// ==========================================================================
// MOTOR DO ESTÚDIO DE EDIÇÃO DO ATLETA (Corte, Crop 9:16, Texto & Instagram)
// ==========================================================================

let studioClip = null;
let studioDuration = 10;
let studioTrimStart = 0;
let studioTrimEnd = 10;
let studioAspectRatio = '9-16'; // '9-16', '1-1', '16-9'
let studioPanPct = 50; // 0 a 100%
let studioText = '';
let studioTextStyle = 'black-pill';
let studioTextPos = 'middle'; // 'top', 'middle', 'bottom'
let studioIsRendering = false;

// Elementos do Estúdio
const studioModalBackdrop = document.getElementById('studio-modal-backdrop');
const btnCloseStudio = document.getElementById('btn-close-studio');
const btnStudioReset = document.getElementById('btn-studio-reset');
const studioClipTag = document.getElementById('studio-clip-tag');
const studioCropContainer = document.getElementById('studio-crop-container');
const studioVideoWrapper = document.getElementById('studio-video-wrapper');
const studioPosterFallback = document.getElementById('studio-poster-fallback');
const studioPreviewVideo = document.getElementById('studio-preview-video');
const studioPlayIndicator = document.getElementById('studio-play-indicator');
const iconStudioPlay = document.querySelector('.icon-studio-play');
const iconStudioPause = document.querySelector('.icon-studio-pause');
const btnStudioPlayToggle = document.getElementById('btn-studio-play-toggle');
const icoBtnPlay = document.querySelector('.ico-btn-play');
const icoBtnPause = document.querySelector('.ico-btn-pause');
const labelTrimPlay = document.getElementById('label-trim-play');

const studioTextOverlay = document.getElementById('studio-text-overlay');
const studioTextContent = document.getElementById('studio-text-content');

const trimStartRange = document.getElementById('trim-start-range');
const trimEndRange = document.getElementById('trim-end-range');
const trimStartLabel = document.getElementById('trim-start-label');
const trimDurLabel = document.getElementById('trim-dur-label');
const trimEndLabel = document.getElementById('trim-end-label');

const ratioButtons = document.querySelectorAll('.ratio-btn');
const panXRange = document.getElementById('pan-x-range');
const panPctLabel = document.getElementById('pan-pct-label');
const panSliderWrap = document.getElementById('pan-slider-wrap');

const studioTextInput = document.getElementById('studio-text-input');
const stylePills = document.querySelectorAll('.style-pill');
const posButtons = document.querySelectorAll('.pos-btn');

const btnStudioSave = document.getElementById('btn-studio-save');
const btnStudioShareInsta = document.getElementById('btn-studio-share-insta');

const studioTabButtons = document.querySelectorAll('.studio-tab-btn');
const studioPanels = document.querySelectorAll('.studio-panel');

const studioRenderOverlay = document.getElementById('studio-render-overlay');
const renderStatusTitle = document.getElementById('render-status-title');
const renderStatusSub = document.getElementById('render-status-sub');
const renderProgressFill = document.getElementById('render-progress-fill');

function toggleStudioPlayPause() {
    if (!studioPreviewVideo) return;
    if (studioPreviewVideo.paused) {
        if (studioDuration > 0 && studioPreviewVideo.currentTime >= studioTrimEnd - 0.1) {
            studioPreviewVideo.currentTime = studioTrimStart;
        }
        const playProm = studioPreviewVideo.play();
        if (playProm !== undefined) {
            playProm.then(() => {
                updateStudioPlayState(true);
            }).catch(err => {
                console.warn("Play bloqueado:", err);
                updateStudioPlayState(false);
            });
        }
    } else {
        studioPreviewVideo.pause();
        updateStudioPlayState(false);
    }
}

function updateStudioPlayState(isPlaying) {
    if (isPlaying) {
        if (studioPlayIndicator) studioPlayIndicator.classList.add('playing');
        if (studioPosterFallback) {
            studioPosterFallback.style.opacity = '0';
            studioPosterFallback.style.display = 'none';
        }
        if (icoBtnPlay) icoBtnPlay.style.display = 'none';
        if (icoBtnPause) icoBtnPause.style.display = 'block';
        if (labelTrimPlay) labelTrimPlay.textContent = 'Pausar';
    } else {
        if (studioPlayIndicator) studioPlayIndicator.classList.remove('playing');
        if (icoBtnPlay) icoBtnPlay.style.display = 'block';
        if (icoBtnPause) icoBtnPause.style.display = 'none';
        if (labelTrimPlay) labelTrimPlay.textContent = 'Play';
    }
}

function setupStudioEventListeners() {
    if (!studioModalBackdrop) return;

    // Fechar Modal
    btnCloseStudio.addEventListener('click', closeVideoStudio);
    btnStudioReset.addEventListener('click', resetStudioDefaults);

    // Play / Pause ao clicar no preview de vídeo ou no botão central
    studioCropContainer.addEventListener('click', (e) => {
        if (e.target.closest('#studio-text-overlay')) return;
        toggleStudioPlayPause();
    });

    if (btnStudioPlayToggle) {
        btnStudioPlayToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleStudioPlayPause();
        });
    }

    studioPreviewVideo.addEventListener('play', () => updateStudioPlayState(true));
    studioPreviewVideo.addEventListener('pause', () => updateStudioPlayState(false));
    studioPreviewVideo.addEventListener('playing', () => {
        if (studioPosterFallback) {
            studioPosterFallback.style.opacity = '0';
            studioPosterFallback.style.display = 'none';
        }
        updateStudioPlayState(true);
    });

    // Abas de Ferramentas
    studioTabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            studioTabButtons.forEach(b => b.classList.remove('active'));
            studioPanels.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPanel = document.getElementById(`panel-${tabName}`);
            if (targetPanel) targetPanel.classList.add('active');
        });
    });

    // Sliders de Corte (Trim)
    trimStartRange.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value);
        if (val >= studioTrimEnd - 0.5) {
            val = studioTrimEnd - 0.5;
            e.target.value = val;
        }
        studioTrimStart = Math.max(0, val);
        trimStartLabel.textContent = `${studioTrimStart.toFixed(1)}s`;
        trimDurLabel.textContent = `${(studioTrimEnd - studioTrimStart).toFixed(1)}s`;
        studioPreviewVideo.currentTime = studioTrimStart;
    });

    trimEndRange.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value);
        if (val <= studioTrimStart + 0.5) {
            val = studioTrimStart + 0.5;
            e.target.value = val;
        }
        studioTrimEnd = Math.min(studioDuration || 10, val);
        trimEndLabel.textContent = `${studioTrimEnd.toFixed(1)}s`;
        trimDurLabel.textContent = `${(studioTrimEnd - studioTrimStart).toFixed(1)}s`;
    });

    // Loop do Vídeo do Estúdio dentro do trecho cortado
    studioPreviewVideo.addEventListener('timeupdate', () => {
        if (studioDuration > 0 && studioTrimEnd > studioTrimStart + 0.2) {
            if (studioPreviewVideo.currentTime >= studioTrimEnd - 0.05) {
                studioPreviewVideo.currentTime = studioTrimStart;
            }
        }
    });

    // Seleção de Formato (Crop / Aspect Ratio)
    ratioButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            ratioButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const ratio = btn.getAttribute('data-ratio');
            studioAspectRatio = ratio;
            studioCropContainer.className = `studio-crop-container ratio-${ratio}`;

            if (ratio === '16-9') {
                panSliderWrap.style.display = 'none';
            } else {
                panSliderWrap.style.display = 'flex';
            }
            updateStudioTransform();
        });
    });

    // Slider de Pan Horizontal (Enquadramento)
    panXRange.addEventListener('input', (e) => {
        studioPanPct = parseInt(e.target.value);
        let labelText = 'Centro (50%)';
        if (studioPanPct < 40) labelText = `Foco Esquerda (${studioPanPct}%)`;
        else if (studioPanPct > 60) labelText = `Foco Direita (${studioPanPct}%)`;
        panPctLabel.textContent = labelText;
        updateStudioTransform();
    });

    // Entrada de Texto e Estilo
    studioTextInput.addEventListener('input', (e) => {
        studioText = e.target.value.trim();
        updateStudioTextOverlay();
    });

    stylePills.forEach(btn => {
        btn.addEventListener('click', () => {
            stylePills.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            studioTextStyle = btn.getAttribute('data-style');
            updateStudioTextOverlay();
        });
    });

    posButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            posButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            studioTextPos = btn.getAttribute('data-pos');
            updateStudioTextOverlay();
        });
    });

    // Drag & Drop no Texto Overlay via Touch/Mouse
    setupTextDragListeners();

    // Ações de Salvar e Compartilhar
    btnStudioSave.addEventListener('click', handleStudioSave);
    btnStudioShareInsta.addEventListener('click', handleStudioShareInstagram);
}

function updateStudioTransform() {
    if (studioAspectRatio === '16-9') {
        studioPreviewVideo.style.objectPosition = 'center center';
        if (studioPosterFallback) studioPosterFallback.style.objectPosition = 'center center';
    } else {
        // Ajusta a posição horizontal da imagem no enquadramento
        studioPreviewVideo.style.objectPosition = `${studioPanPct}% center`;
        if (studioPosterFallback) studioPosterFallback.style.objectPosition = `${studioPanPct}% center`;
    }
}

function updateStudioTextOverlay() {
    if (!studioText) {
        studioTextOverlay.style.display = 'none';
        return;
    }

    studioTextOverlay.style.display = 'block';
    studioTextContent.textContent = studioText;
    studioTextOverlay.className = `studio-text-overlay ${studioTextStyle}`;

    if (studioTextPos === 'top') {
        studioTextOverlay.style.top = '20%';
    } else if (studioTextPos === 'bottom') {
        studioTextOverlay.style.top = '78%';
    } else {
        studioTextOverlay.style.top = '48%';
    }
}

function setupTextDragListeners() {
    let isDragging = false;
    let startY = 0;
    let initialTopPct = 48;

    const onStart = (clientY) => {
        isDragging = true;
        startY = clientY;
        const parentRect = studioCropContainer.getBoundingClientRect();
        const elemRect = studioTextOverlay.getBoundingClientRect();
        initialTopPct = ((elemRect.top + elemRect.height / 2 - parentRect.top) / parentRect.height) * 100;
    };

    const onMove = (clientY) => {
        if (!isDragging) return;
        const parentRect = studioCropContainer.getBoundingClientRect();
        const deltaY = clientY - startY;
        const deltaPct = (deltaY / parentRect.height) * 100;
        let newTop = Math.max(12, Math.min(88, initialTopPct + deltaPct));
        studioTextOverlay.style.top = `${newTop}%`;
    };

    const onEnd = () => {
        isDragging = false;
    };

    studioTextOverlay.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) onStart(e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches.length > 0) onMove(e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener('touchend', onEnd);

    studioTextOverlay.addEventListener('mousedown', (e) => {
        onStart(e.clientY);
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) onMove(e.clientY);
    });

    window.addEventListener('mouseup', onEnd);
}

// Abrir o Estúdio para um clipe específico
function openVideoStudio(filename, event) {
    if (event) event.stopPropagation();

    // 1. Pausa qualquer reprodução ativa no feed para liberar a GPU mobile
    if (currentActiveVideo) {
        try { currentActiveVideo.pause(); } catch(e) {}
    }
    document.querySelectorAll('.reel-video').forEach(v => {
        try { v.pause(); } catch(e) {}
    });

    studioClip = allClips.find(c => c.filename === filename);
    if (!studioClip) {
        showToast("Lance não encontrado.");
        return;
    }

    studioClipTag.textContent = studioClip.camera_name || extractCameraLabel(studioClip.filename);

    // Seleciona a rota mais rápida e compatível com streaming Range
    const localVideoUrl = `${API_BASE}/api/clips/${studioClip.filename}`;
    const cloudVideoUrl = studioClip.video_url || `${R2_PUBLIC_URL}/${studioClip.filename}`;
    const isLocalNetwork = window.location.origin.includes('localhost') || 
                           window.location.origin.includes('127.0.0.1') || 
                           window.location.origin.includes('192.168.');
    const videoSrc = isLocalNetwork ? localVideoUrl : (cloudVideoUrl || localVideoUrl);

    // Mostra o poster imediatamente para garantir que a imagem apareça sem tela preta
    if (studioPosterFallback) {
        studioPosterFallback.src = studioClip.thumb_url;
        studioPosterFallback.style.display = 'block';
        studioPosterFallback.style.opacity = '1';
        studioPosterFallback.onerror = () => {
            studioPosterFallback.src = `${API_BASE}/api/clips/${studioClip.filename}/thumb`;
        };
    }

    // Inicializa variáveis de trim antes de qualquer evento
    studioDuration = 0;
    studioTrimStart = 0;
    studioTrimEnd = 9999;

    resetStudioDefaults();

    // Configura o vídeo sem crossorigin para permitir streaming do R2 sem bloqueio de segurança
    studioPreviewVideo.removeAttribute('crossorigin');
    studioPreviewVideo.poster = studioClip.thumb_url;
    studioPreviewVideo.muted = true;
    studioPreviewVideo.defaultMuted = true;
    studioPreviewVideo.playsInline = true;
    studioPreviewVideo.setAttribute('playsinline', '');
    studioPreviewVideo.setAttribute('webkit-playsinline', '');
    studioPreviewVideo.setAttribute('muted', '');
    studioPreviewVideo.setAttribute('loop', '');
    studioPreviewVideo.src = videoSrc;

    const hidePoster = () => {
        if (studioPosterFallback) {
            studioPosterFallback.style.opacity = '0';
            studioPosterFallback.style.display = 'none';
        }
    };

    const setupMetadata = () => {
        if (studioPreviewVideo.duration && !isNaN(studioPreviewVideo.duration) && studioPreviewVideo.duration > 0) {
            studioDuration = studioPreviewVideo.duration;
            studioTrimEnd = studioDuration;

            trimStartRange.min = 0;
            trimStartRange.max = studioDuration;
            trimStartRange.step = 0.1;
            trimStartRange.value = 0;

            trimEndRange.min = 0;
            trimEndRange.max = studioDuration;
            trimEndRange.step = 0.1;
            trimEndRange.value = studioDuration;

            trimStartLabel.textContent = "0.0s";
            trimEndLabel.textContent = `${studioDuration.toFixed(1)}s`;
            trimDurLabel.textContent = `${studioDuration.toFixed(1)}s`;
        }

        if (studioPreviewVideo.paused) {
            studioPreviewVideo.play().then(() => {
                updateStudioPlayState(true);
                hidePoster();
            }).catch(err => {
                console.log("Autoplay preview notice:", err);
                updateStudioPlayState(false);
            });
        }
    };

    studioPreviewVideo.onloadedmetadata = setupMetadata;
    if (studioPreviewVideo.readyState >= 1) {
        setupMetadata();
    }

    studioPreviewVideo.onplaying = hidePoster;
    studioPreviewVideo.oncanplay = hidePoster;
    studioPreviewVideo.onloadeddata = hidePoster;

    studioPreviewVideo.onerror = () => {
        const err = studioPreviewVideo.error;
        if (err && err.code === 1) return; // Ignore aborted requests
        
        console.warn("Aviso ao carregar vídeo no editor, tentando fallback local:", studioClip.filename);
        if (!studioPreviewVideo.src.includes('/api/clips/')) {
            studioPreviewVideo.src = `${API_BASE}/api/clips/${studioClip.filename}`;
            studioPreviewVideo.load();
            studioPreviewVideo.play().catch(() => {});
        }
    };

    studioModalBackdrop.style.display = 'flex';
    studioPreviewVideo.load();

    // Dispara o play imediatamente aproveitando a ação de clique do usuário
    const directPlay = studioPreviewVideo.play();
    if (directPlay !== undefined) {
        directPlay.then(() => {
            updateStudioPlayState(true);
            hidePoster();
        }).catch(err => {
            console.log("Aguardando buffer para reprodução imediata:", err);
        });
    }
}

function closeVideoStudio() {
    if (studioPreviewVideo) {
        studioPreviewVideo.pause();
        studioPreviewVideo.src = '';
    }
    studioModalBackdrop.style.display = 'none';

    // Retoma a reprodução do reel ativo
    if (currentActiveVideo) {
        currentActiveVideo.play().catch(() => {});
    }
}

function resetStudioDefaults() {
    studioAspectRatio = '9-16';
    studioPanPct = 50;
    studioText = '';
    studioTextStyle = 'black-pill';
    studioTextPos = 'middle';

    ratioButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-ratio') === '9-16'));
    studioCropContainer.className = 'studio-crop-container ratio-9-16';
    panSliderWrap.style.display = 'flex';

    panXRange.value = 50;
    panPctLabel.textContent = 'Centro (50%)';

    studioTextInput.value = '';
    stylePills.forEach(b => b.classList.toggle('active', b.getAttribute('data-style') === 'black-pill'));
    posButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-pos') === 'middle'));

    if (studioDuration > 0) {
        studioTrimStart = 0;
        studioTrimEnd = studioDuration;
        trimStartRange.value = 0;
        trimEndRange.value = studioDuration;
        trimStartLabel.textContent = "0.0s";
        trimEndLabel.textContent = `${studioDuration.toFixed(1)}s`;
        trimDurLabel.textContent = `${studioDuration.toFixed(1)}s`;
    }

    updateStudioTransform();
    updateStudioTextOverlay();
}

// ==========================================================================
// RENDERIZAÇÃO DUAL (Backend FFmpeg com Fallback em Canvas WebCodecs)
// ==========================================================================

async function renderEditedVideoBlob(progressCallback) {
    if (!studioClip) throw new Error("Nenhum lance selecionado");

    progressCallback(10, "Iniciando corte e enquadramento...");

    // 1. Tentar renderizar via API do Backend local (qualidade ultra-HD com FFmpeg nativo)
    try {
        const payload = {
            filename: studioClip.filename,
            start_time: studioTrimStart,
            end_time: studioTrimEnd,
            aspect_ratio: studioAspectRatio,
            pan_pct: studioPanPct,
            text: studioText,
            text_style: studioTextStyle,
            text_pos: studioTextPos
        };

        progressCallback(35, "Processando vídeo com aceleração de hardware...");

        const response = await fetch(`${API_BASE}/api/clips/edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            progressCallback(85, "Finalizando arquivo MP4...");
            const blob = await response.blob();
            progressCallback(100, "Concluído!");
            return new Blob([blob], { type: 'video/mp4' });
        }
    } catch (err) {
        console.warn("Backend local indisponível, utilizando motor Canvas do navegador:", err);
    }

    // 2. Fallback de alta performance no cliente (Canvas 2D + MediaRecorder)
    return await renderWithBrowserCanvas(progressCallback);
}

async function renderWithBrowserCanvas(progressCallback) {
    return new Promise((resolve, reject) => {
        try {
            progressCallback(20, "Preparando renderizador do navegador...");

            // Dimensões do Canvas baseadas no Formato Escolhido
            let targetW = 720;
            let targetH = 1280; // 9:16 vertical Reels
            if (studioAspectRatio === '1-1') {
                targetW = 720;
                targetH = 720;
            } else if (studioAspectRatio === '16-9') {
                targetW = 1280;
                targetH = 720;
            }

            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');

            const video = document.createElement('video');
            video.src = studioClip.video_url || studioClip.preview_url;
            video.crossOrigin = 'anonymous';
            video.muted = true;
            video.playsInline = true;

            video.onloadeddata = async () => {
                try {
                    video.currentTime = studioTrimStart;
                    await new Promise(r => video.onseeked = r);

                    progressCallback(40, "Renderizando frames e legendas...");

                    const stream = canvas.captureStream(30);
                    let options = { mimeType: 'video/webm; codecs=vp9' };
                    if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E"')) {
                        options = { mimeType: 'video/mp4; codecs="avc1.42E01E"' };
                    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
                        options = { mimeType: 'video/mp4' };
                    }

                    const mediaRecorder = new MediaRecorder(stream, options);
                    const chunks = [];

                    mediaRecorder.ondataavailable = (e) => {
                        if (e.data && e.data.size > 0) chunks.push(e.data);
                    };

                    mediaRecorder.onstop = () => {
                        const blob = new Blob(chunks, { type: options.mimeType || 'video/mp4' });
                        progressCallback(100, "Vídeo renderizado com sucesso!");
                        resolve(blob);
                    };

                    mediaRecorder.start(100);
                    video.play();

                    const dur = studioTrimEnd - studioTrimStart;

                    const drawFrame = () => {
                        if (video.currentTime >= studioTrimEnd || video.paused || video.ended) {
                            video.pause();
                            mediaRecorder.stop();
                            return;
                        }

                        const currentProgress = Math.min(95, 40 + ((video.currentTime - studioTrimStart) / dur) * 55);
                        progressCallback(currentProgress, `Renderizando: ${(video.currentTime - studioTrimStart).toFixed(1)}s / ${dur.toFixed(1)}s`);

                        // 1. Calcula o recorte (Crop & Pan)
                        const vw = video.videoWidth || 1280;
                        const vh = video.videoHeight || 720;

                        let cropW = vw;
                        let cropH = vh;
                        let cropX = 0;
                        let cropY = 0;

                        if (studioAspectRatio === '9-16') {
                            cropW = vh * (9 / 16);
                            cropX = (vw - cropW) * (studioPanPct / 100.0);
                        } else if (studioAspectRatio === '1-1') {
                            cropW = vh;
                            cropX = (vw - cropW) * (studioPanPct / 100.0);
                        }

                        // Limpa o canvas
                        ctx.fillStyle = "#000000";
                        ctx.fillRect(0, 0, targetW, targetH);

                        // Desenha o frame de vídeo recortado
                        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

                        // 2. Desenha Marca D'água
                        ctx.save();
                        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
                        ctx.roundRect(targetW - 130, 20, 110, 30, 6);
                        ctx.fill();
                        ctx.fillStyle = "#ffffff";
                        ctx.font = "bold 13px 'Plus Jakarta Sans', sans-serif";
                        ctx.fillText("⚡ MOMENTOS", targetW - 120, 40);
                        ctx.restore();

                        // 3. Desenha Texto / Legenda se configurado
                        if (studioText) {
                            drawTextOnCanvas(ctx, targetW, targetH);
                        }

                        requestAnimationFrame(drawFrame);
                    };

                    requestAnimationFrame(drawFrame);
                } catch (e) {
                    reject(e);
                }
            };

            video.onerror = (err) => reject(err);
        } catch (e) {
            reject(e);
        }
    });
}

function drawTextOnCanvas(ctx, w, h) {
    ctx.save();
    let textY = h * 0.48;
    if (studioTextPos === 'top') textY = h * 0.20;
    else if (studioTextPos === 'bottom') textY = h * 0.80;

    const fontSize = Math.round(w * 0.05);
    ctx.font = `900 ${fontSize}px 'Plus Jakarta Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const textMetrics = ctx.measureText(studioText);
    const boxPaddingX = 24;
    const boxPaddingY = 14;
    const boxW = textMetrics.width + (boxPaddingX * 2);
    const boxH = fontSize + (boxPaddingY * 2);
    const boxX = (w - boxW) / 2;
    const boxY = textY - (boxH / 2);

    if (studioTextStyle === 'black-pill') {
        ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 12);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(studioText, w / 2, textY);
    } else if (studioTextStyle === 'gold-pill') {
        const grad = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY + boxH);
        grad.addColorStop(0, "#fbbf24");
        grad.addColorStop(1, "#d97706");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 12);
        ctx.fill();

        ctx.fillStyle = "#000000";
        ctx.fillText(studioText, w / 2, textY);
    } else if (studioTextStyle === 'cyan-pill') {
        const grad = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY + boxH);
        grad.addColorStop(0, "#06b6d4");
        grad.addColorStop(1, "#2563eb");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 12);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(studioText, w / 2, textY);
    } else {
        // Texto Limpo com Sombra Intensa
        ctx.shadowColor = "rgba(0, 0, 0, 0.95)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(studioText, w / 2, textY);
    }
    ctx.restore();
}

// Salvar Vídeo Editado
async function handleStudioSave() {
    if (studioIsRendering) return;
    studioIsRendering = true;

    studioRenderOverlay.style.display = 'flex';
    renderStatusTitle.textContent = "Preparando seu Vídeo...";
    renderProgressFill.style.width = '10%';

    try {
        const blob = await renderEditedVideoBlob((pct, status) => {
            renderProgressFill.style.width = `${pct}%`;
            renderStatusSub.textContent = status;
        });

        // Dispara o download automático do arquivo
        const filename = `lance_momentos_${Date.now()}.mp4`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => URL.revokeObjectURL(url), 4000);

        showToast("Vídeo salvo com sucesso na sua galeria! 💾✨");
        setTimeout(() => {
            studioRenderOverlay.style.display = 'none';
            studioIsRendering = false;
        }, 800);
    } catch (err) {
        console.error("Erro ao renderizar vídeo:", err);
        showToast("Erro ao processar o vídeo.", true);
        studioRenderOverlay.style.display = 'none';
        studioIsRendering = false;
    }
}

// Compartilhar no Instagram via Web Share API
async function handleStudioShareInstagram() {
    if (studioIsRendering) return;
    studioIsRendering = true;

    studioRenderOverlay.style.display = 'flex';
    renderStatusTitle.textContent = "Preparando para o Instagram...";
    renderProgressFill.style.width = '10%';

    try {
        const blob = await renderEditedVideoBlob((pct, status) => {
            renderProgressFill.style.width = `${pct}%`;
            renderStatusSub.textContent = status;
        });

        const filename = `lance_momentos_${Date.now()}.mp4`;
        const file = new File([blob], filename, { type: 'video/mp4' });

        // Tenta acionar a Web Share API Nativa (abre Instagram / WhatsApp / TikTok)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            studioRenderOverlay.style.display = 'none';
            studioIsRendering = false;

            await navigator.share({
                files: [file],
                title: 'Meu Lance no Momentos',
                text: studioText || 'Confira esse lance gravado pelo Sistema Momentos! ⚽🔥'
            });
            showToast("Compartilhado com sucesso!");
        } else {
            // Em navegadores sem suporte a compartilhamento de arquivo direto (desktop):
            // Baixa o arquivo e abre o Instagram para o usuário postar
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            showToast("Vídeo baixado! Abrindo Instagram para postagem... 📸");
            setTimeout(() => {
                window.open('https://www.instagram.com/', '_blank');
                studioRenderOverlay.style.display = 'none';
                studioIsRendering = false;
            }, 1200);
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error("Erro ao compartilhar no Instagram:", err);
            showToast("Erro ao compartilhar vídeo.", true);
        }
        studioRenderOverlay.style.display = 'none';
        studioIsRendering = false;
    }
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

