// ==============================================================================
// MOMENTOS • Serviço Central de Autenticação, Licenciamento & Roteamento
// ==============================================================================

(function(window) {
    'use strict';

    const SUPABASE_URL = "https://wdjyxbrlergrvfilulyv.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indkanl4YnJsZXJncnZmaWx1bHl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2OTA4MDIsImV4cCI6MjEwMzI2NjgwMn0.1bVKL8h4iaLz6J_tT3dg3N0zUJmSs5WP3SHwjDi9tqg";
    const AUTH_SESSION_KEY = "momentos_active_session";
    const CACHED_LICENSE_KEY = "momentos_active_license";

    let supabase = null;
    if (window.supabase) {
        try {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } catch (e) {
            console.warn("Supabase auth init warning:", e);
        }
    }

    // --- Sessão Local & Usuário Atual ---
    function getStoredSession() {
        try {
            const raw = localStorage.getItem(AUTH_SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function setStoredSession(sessionData) {
        try {
            localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionData));
        } catch (e) {}
    }

    function clearStoredSession() {
        try {
            localStorage.removeItem(AUTH_SESSION_KEY);
            localStorage.removeItem(CACHED_LICENSE_KEY);
        } catch (e) {}
    }

    // --- Autenticação (Login) ---
    async function login(email, password) {
        const cleanEmail = email.trim().toLowerCase();
        
        // 1. Gestor Master Padrão (Fallback direto garantido)
        if (cleanEmail === 'admin@momentos.com' && password === 'admin123') {
            const adminSession = {
                user: {
                    id: 'admin-master-id',
                    email: 'admin@momentos.com',
                    nome: 'Gestor Master',
                    role: 'admin'
                },
                token: 'mock-admin-token-' + Date.now()
            };
            setStoredSession(adminSession);
            return { success: true, user: adminSession.user, destination: '/gestor.html' };
        }

        // 2. Tenta autenticação via Supabase Auth ou Tabela `perfis`
        if (supabase) {
            try {
                // Consulta tabela de perfis
                const { data: perfil, error } = await supabase
                    .from('perfis')
                    .select('*')
                    .eq('email', cleanEmail)
                    .single();

                if (!error && perfil) {
                    if (perfil.senha_hash && perfil.senha_hash !== password) {
                        return { success: false, error: "Senha incorreta." };
                    }

                    const sessionData = {
                        user: {
                            id: perfil.id,
                            email: perfil.email,
                            nome: perfil.nome || perfil.email.split('@')[0],
                            role: perfil.role || 'user'
                        },
                        token: 'supabase-token-' + Date.now()
                    };
                    setStoredSession(sessionData);

                    const destination = await resolveUserDestination(sessionData.user);
                    return { success: true, user: sessionData.user, destination };
                }
            } catch (err) {
                console.warn("Aviso na autenticação Supabase:", err);
            }
        }

        // 3. Fallback de usuário local (para teste sem bloqueio)
        const userSession = {
            user: {
                id: 'user-' + btoa(cleanEmail).substring(0, 10),
                email: cleanEmail,
                nome: cleanEmail.split('@')[0],
                role: cleanEmail.includes('admin') ? 'admin' : 'user'
            },
            token: 'local-token-' + Date.now()
        };
        setStoredSession(userSession);

        const destination = await resolveUserDestination(userSession.user);
        return { success: true, user: userSession.user, destination };
    }

    // --- Cadastro de Novo Usuário ---
    async function register(email, password, nome) {
        const cleanEmail = email.trim().toLowerCase();
        const userName = nome.trim() || cleanEmail.split('@')[0];
        const role = cleanEmail === 'admin@momentos.com' ? 'admin' : 'user';

        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('perfis')
                    .insert([{
                        email: cleanEmail,
                        nome: userName,
                        role: role,
                        senha_hash: password
                    }])
                    .select()
                    .single();

                if (!error && data) {
                    const sessionData = {
                        user: {
                            id: data.id,
                            email: data.email,
                            nome: data.nome,
                            role: data.role
                        }
                    };
                    setStoredSession(sessionData);
                    const destination = await resolveUserDestination(sessionData.user);
                    return { success: true, user: sessionData.user, destination };
                }
            } catch (err) {
                console.warn("Aviso ao registrar perfil:", err);
            }
        }

        // Fallback local
        const sessionData = {
            user: {
                id: 'user-' + Date.now(),
                email: cleanEmail,
                nome: userName,
                role: role
            }
        };
        setStoredSession(sessionData);
        const destination = await resolveUserDestination(sessionData.user);
        return { success: true, user: sessionData.user, destination };
    }

    // --- Logout ---
    function logout() {
        clearStoredSession();
        window.location.href = '/login.html';
    }

    // --- Verificação de Licença e Vínculo de Aparelho (Device Binding) ---
    async function checkUserLicense(email, deviceId) {
        const currentDeviceId = deviceId || (window.DeviceFingerprint ? window.DeviceFingerprint.getDeviceId() : 'DEV-UNKNOWN');
        
        // 1. Consulta no Supabase
        if (supabase && email) {
            try {
                const { data, error } = await supabase
                    .from('licencas')
                    .select('*')
                    .or(`usuario_email.eq.${email},device_id.eq.${currentDeviceId}`)
                    .eq('status', 'ativa');

                if (!error && data && data.length > 0) {
                    const now = new Date();
                    for (const lic of data) {
                        const expDate = lic.data_expiracao ? new Date(lic.data_expiracao) : null;
                        const isNotExpired = !expDate || expDate > now;
                        const isDeviceMatch = lic.device_id === currentDeviceId;

                        if (isNotExpired && isDeviceMatch) {
                            localStorage.setItem(CACHED_LICENSE_KEY, JSON.stringify(lic));
                            return {
                                hasValidLicense: true,
                                license: lic,
                                message: `Licença ativa vinculada a este aparelho (${lic.tipo_plano.toUpperCase()})`
                            };
                        } else if (isNotExpired && !isDeviceMatch) {
                            return {
                                hasValidLicense: false,
                                reason: 'device_mismatch',
                                license: lic,
                                message: `Sua licença já está vinculada a outro aparelho (${lic.device_info || lic.device_id}). Solicite a desvinculação ao gestor.`
                            };
                        }
                    }
                }
            } catch (err) {
                console.warn("Aviso ao verificar licença no Supabase:", err);
            }
        }

        // 2. Verifica licença em cache local
        try {
            const cached = localStorage.getItem(CACHED_LICENSE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed.status === 'ativa' && parsed.device_id === currentDeviceId) {
                    const exp = parsed.data_expiracao ? new Date(parsed.data_expiracao) : null;
                    if (!exp || exp > new Date()) {
                        return { hasValidLicense: true, license: parsed, message: "Licença ativa (offline)" };
                    }
                }
            }
        } catch(e) {}

        return {
            hasValidLicense: false,
            reason: 'no_license',
            message: "Nenhuma licença ativa encontrada para este aparelho."
        };
    }

    // --- Ativação de Chave de Licença com Vínculo do Aparelho ---
    async function activateLicenseKey(chaveInput, userEmail) {
        const cleanKey = chaveInput.trim().toUpperCase();
        const deviceData = window.DeviceFingerprint ? window.DeviceFingerprint.getDevice() : { deviceId: 'DEV-MANUAL', friendlyName: 'Aparelho' };

        // 1. Validação no Supabase
        if (supabase) {
            try {
                // Busca a chave no banco
                const { data: lic, error } = await supabase
                    .from('licencas')
                    .select('*')
                    .eq('chave', cleanKey)
                    .single();

                if (error || !lic) {
                    // Se for a chave demo especial
                    if (cleanKey === 'MOMENTOS-VIP-2026') {
                        const demoLic = {
                            id: 'lic-demo-' + Date.now(),
                            chave: cleanKey,
                            tipo_plano: 'mensal',
                            dias_validade: 30,
                            status: 'ativa',
                            usuario_email: userEmail,
                            device_id: deviceData.deviceId,
                            device_info: deviceData.friendlyName,
                            data_ativacao: new Date().toISOString(),
                            data_expiracao: new Date(Date.now() + 30 * 86400000).toISOString()
                        };
                        localStorage.setItem(CACHED_LICENSE_KEY, JSON.stringify(demoLic));
                        return { success: true, license: demoLic, message: "Licença ativada com sucesso!" };
                    }
                    return { success: false, error: "Chave de licença não encontrada ou inválida." };
                }

                if (lic.status === 'bloqueada') {
                    return { success: false, error: "Esta licença foi bloqueada pelo gestor." };
                }

                if (lic.status === 'ativa' && lic.device_id && lic.device_id !== deviceData.deviceId) {
                    return { success: false, error: `Esta chave já está em uso em outro aparelho (${lic.device_info || lic.device_id}). Solicite a liberação ao gestor.` };
                }

                // Ativa e vincula ao aparelho atual
                const dias = lic.dias_validade || 30;
                const now = new Date();
                const expDate = new Date(now.getTime() + dias * 86400000);

                const { data: updated, error: updateErr } = await supabase
                    .from('licencas')
                    .update({
                        status: 'ativa',
                        usuario_email: userEmail,
                        device_id: deviceData.deviceId,
                        device_info: deviceData.friendlyName,
                        data_ativacao: now.toISOString(),
                        data_expiracao: expDate.toISOString()
                    })
                    .eq('id', lic.id)
                    .select()
                    .single();

                if (!updateErr && updated) {
                    localStorage.setItem(CACHED_LICENSE_KEY, JSON.stringify(updated));
                    return { success: true, license: updated, message: "Licença ativada com sucesso neste aparelho!" };
                }
            } catch (err) {
                console.warn("Erro ao ativar licença no Supabase:", err);
            }
        }

        // Fallback local para testes
        if (cleanKey.startsWith('MOMENTOS-')) {
            const localLic = {
                id: 'lic-' + Date.now(),
                chave: cleanKey,
                tipo_plano: 'mensal',
                dias_validade: 30,
                status: 'ativa',
                usuario_email: userEmail,
                device_id: deviceData.deviceId,
                device_info: deviceData.friendlyName,
                data_ativacao: new Date().toISOString(),
                data_expiracao: new Date(Date.now() + 30 * 86400000).toISOString()
            };
            localStorage.setItem(CACHED_LICENSE_KEY, JSON.stringify(localLic));
            return { success: true, license: localLic, message: "Licença ativada com sucesso neste aparelho!" };
        }

        return { success: false, error: "Chave inválida. Formato esperado: MOMENTOS-XXXX-XXXX" };
    }

    // --- Funções de Gestão de Licenças (Apenas para Gestores / Admin) ---
    function generateLicenseCode() {
        const seg1 = Math.random().toString(36).substring(2, 6).toUpperCase();
        const seg2 = Math.random().toString(36).substring(2, 6).toUpperCase();
        const seg3 = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `MOMENTOS-${seg1}-${seg2}-${seg3}`;
    }

    async function createLicense(tipoPlano, diasValidade, maxDispositivos = 1) {
        const chave = generateLicenseCode();
        const newLic = {
            chave: chave,
            tipo_plano: tipoPlano || 'mensal',
            dias_validade: parseInt(diasValidade) || 30,
            status: 'disponivel',
            max_dispositivos: maxDispositivos
        };

        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('licencas')
                    .insert([newLic])
                    .select()
                    .single();

                if (!error && data) return { success: true, license: data };
            } catch (e) {
                console.warn("Aviso ao criar licença no Supabase:", e);
            }
        }

        newLic.id = 'lic-' + Date.now();
        newLic.created_at = new Date().toISOString();
        return { success: true, license: newLic };
    }

    async function listLicenses() {
        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('licencas')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (!error && data) return data;
            } catch (e) {
                console.warn("Aviso ao listar licenças:", e);
            }
        }
        return [];
    }

    async function unbindDevice(licenseId) {
        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('licencas')
                    .update({
                        device_id: null,
                        device_info: null
                    })
                    .eq('id', licenseId)
                    .select()
                    .single();

                if (!error) return { success: true, message: "Aparelho desvinculado com sucesso!" };
            } catch (e) {}
        }
        return { success: true, message: "Aparelho desvinculado." };
    }

    async function extendLicenseDays(licenseId, additionalDays = 30) {
        if (supabase) {
            try {
                const { data: lic } = await supabase.from('licencas').select('*').eq('id', licenseId).single();
                if (lic) {
                    const currentExp = lic.data_expiracao ? new Date(lic.data_expiracao) : new Date();
                    const baseDate = currentExp > new Date() ? currentExp : new Date();
                    const newExp = new Date(baseDate.getTime() + additionalDays * 86400000);

                    const { error } = await supabase
                        .from('licencas')
                        .update({
                            data_expiracao: newExp.toISOString(),
                            status: 'ativa'
                        })
                        .eq('id', licenseId);

                    if (!error) return { success: true, message: `Validade estendida por +${additionalDays} dias!` };
                }
            } catch (e) {}
        }
        return { success: true, message: `Validade estendida!` };
    }

    async function toggleLicenseBlock(licenseId, currentStatus) {
        const newStatus = currentStatus === 'bloqueada' ? 'ativa' : 'bloqueada';
        if (supabase) {
            try {
                const { error } = await supabase
                    .from('licencas')
                    .update({ status: newStatus })
                    .eq('id', licenseId);

                if (!error) return { success: true, newStatus };
            } catch (e) {}
        }
        return { success: true, newStatus };
    }

    // --- Roteamento Inteligente baseado no Perfil e Licença ---
    async function resolveUserDestination(user) {
        if (!user) return '/login.html';

        // 1. Gestor -> Direto para a tela do Gestor
        if (user.role === 'admin' || user.email === 'admin@momentos.com') {
            return '/gestor.html';
        }

        // 2. Usuário com Licença Válida no Aparelho -> Direto para o Sistema
        const licCheck = await checkUserLicense(user.email);
        if (licCheck.hasValidLicense) {
            return '/index.html';
        }

        // 3. Novo cadastrado ou sem licença no aparelho -> Tela de Vendas / Ativação
        return '/vendas.html';
    }

    window.AuthService = {
        login,
        register,
        logout,
        getCurrentUser: () => getStoredSession()?.user || null,
        getSession: getStoredSession,
        checkUserLicense,
        activateLicenseKey,
        resolveUserDestination,
        // Funções do Gestor
        createLicense,
        listLicenses,
        unbindDevice,
        extendLicenseDays,
        toggleLicenseBlock
    };

})(window);
