// ==============================================================================
// MOMENTOS • Guardião de Rotas (Proteção de Acesso & Redirecionamento Automático)
// ==============================================================================

(async function() {
    'use strict';

    const path = window.location.pathname.toLowerCase();
    const isLoginPage = path.endsWith('/login.html') || path.endsWith('/login');
    const isGestorPage = path.endsWith('/gestor.html') || path.endsWith('/gestor');
    const isVendasPage = path.endsWith('/vendas.html') || path.endsWith('/vendas');
    const isAtletaPage = path.includes('/atleta');
    const isSystemPage = !isLoginPage && !isGestorPage && !isVendasPage && !isAtletaPage;

    // O Portal do Atleta é de acesso livre para os jogadores
    if (isAtletaPage) return;

    // Aguarda carregamento do AuthService se ainda não estiver disponível
    if (!window.AuthService) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!window.AuthService) return;

    const user = window.AuthService.getCurrentUser();

    // 1. Se estiver na página de login e já tiver sessão válida
    if (isLoginPage) {
        if (user) {
            const destination = await window.AuthService.resolveUserDestination(user);
            window.location.href = destination;
        }
        return;
    }

    // 2. Se for uma página restrita e não houver usuário logado
    if (!user) {
        window.location.href = '/login.html';
        return;
    }

    // 3. Se for a página do Gestor, garante que é Admin
    if (isGestorPage) {
        if (user.role !== 'admin' && user.email !== 'admin@momentos.com') {
            window.location.href = '/vendas.html';
        }
        return;
    }

    // 4. Se for o Sistema Principal (index.html / dashboard)
    if (isSystemPage) {
        if (user.role === 'admin' || user.email === 'admin@momentos.com') {
            return; // Gestor tem acesso total
        }

        const lic = await window.AuthService.checkUserLicense(user.email);
        if (!lic.hasValidLicense) {
            window.location.href = '/vendas.html';
        }
    }
})();
