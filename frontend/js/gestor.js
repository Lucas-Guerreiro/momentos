// ==============================================================================
// MOMENTOS • Script do Painel do Gestor de Licenças
// ==============================================================================

(function() {
    'use strict';

    function initGestor() {
        let allLicenses = [];
        const toast = document.getElementById('toast');

        // Elementos DOM
        const userEmailSpan = document.getElementById('header-user-email');
        const btnLogout = document.getElementById('btn-logout');
        const formCreate = document.getElementById('form-create-license');
        const selectPlano = document.getElementById('lic-plano');
        const inputDias = document.getElementById('lic-dias');
        const inputMaxDevices = document.getElementById('lic-max-devices');
        const tableBody = document.getElementById('licenses-table-body');
        const searchInput = document.getElementById('input-search-licenses');
        const btnRefresh = document.getElementById('btn-refresh-licenses');

        // Box da Nova Licença
        const newLicBox = document.getElementById('new-license-box');
        const newLicKeyDisplay = document.getElementById('new-lic-key-display');
        const newLicPlanBadge = document.getElementById('new-lic-plan-badge');
        const btnCopyNewKey = document.getElementById('btn-copy-new-key');
        const btnWhatsappNewKey = document.getElementById('btn-whatsapp-new-key');

        // KPIs
        const kpiTotal = document.getElementById('kpi-total');
        const kpiAtivas = document.getElementById('kpi-ativas');
        const kpiAparelhos = document.getElementById('kpi-aparelhos');
        const kpiDisponiveis = document.getElementById('kpi-disponiveis');

        // 1. Configura dados do usuário logado
        const user = window.AuthService ? window.AuthService.getCurrentUser() : null;
        if (user && userEmailSpan) {
            userEmailSpan.textContent = user.email;
        }

        // 2. Evento de Logout
        if (btnLogout) {
            btnLogout.addEventListener('click', () => {
                if (confirm("Deseja encerrar a sessão de Gestor?")) {
                    window.AuthService.logout();
                }
            });
        }

        // 3. Atualiza campo de dias ao mudar o plano selecionado
        if (selectPlano && inputDias) {
            selectPlano.addEventListener('change', () => {
                const selectedOpt = selectPlano.options[selectPlano.selectedIndex];
                const defaultDays = selectedOpt.getAttribute('data-days');
                if (defaultDays) inputDias.value = defaultDays;
            });
        }

        // 4. Carregar Licenças
        async function loadLicenses() {
            if (!tableBody) return;
            
            try {
                if (window.AuthService && window.AuthService.listLicenses) {
                    allLicenses = await window.AuthService.listLicenses();
                } else {
                    allLicenses = [];
                }
                updateKPIs();
                renderTable();
            } catch (error) {
                console.error("Erro ao carregar licenças:", error);
                tableBody.innerHTML = `<tr><td colspan="7" style="color:#ef4444; text-align:center; padding: 1.5rem;">Erro ao carregar licenças. Tente atualizar.</td></tr>`;
            }
        }

        // 5. Atualizar KPIs
        function updateKPIs() {
            if (kpiTotal) kpiTotal.textContent = allLicenses.length;
            if (kpiAtivas) kpiAtivas.textContent = allLicenses.filter(l => l.status === 'ativa').length;
            if (kpiAparelhos) kpiAparelhos.textContent = allLicenses.filter(l => l.device_id).length;
            if (kpiDisponiveis) kpiDisponiveis.textContent = allLicenses.filter(l => l.status === 'disponivel').length;
        }

        // 6. Renderizar Tabela
        function renderTable() {
            if (!tableBody) return;
            const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
            const filtered = allLicenses.filter(l => {
                if (!query) return true;
                return (l.chave && l.chave.toLowerCase().includes(query)) ||
                       (l.usuario_email && l.usuario_email.toLowerCase().includes(query)) ||
                       (l.device_id && l.device_id.toLowerCase().includes(query)) ||
                       (l.tipo_plano && l.tipo_plano.toLowerCase().includes(query));
            });

            if (filtered.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-muted);">Nenhuma licença encontrada. Crie sua primeira chave acima!</td></tr>`;
                return;
            }

            tableBody.innerHTML = filtered.map(lic => {
                const expFormatted = lic.data_expiracao ? new Date(lic.data_expiracao).toLocaleDateString('pt-BR') : 'Não ativada';
                const statusClass = lic.status || 'disponivel';
                const deviceTxt = lic.device_id ? `${lic.device_info || 'Aparelho'} (<code>${lic.device_id}</code>)` : '<span style="color:#94a3b8;">Nenhum</span>';
                const clienteTxt = lic.usuario_email ? `<strong>${lic.usuario_email}</strong>` : '<span style="color:#94a3b8;">Disponível</span>';

                return `
                    <tr>
                        <td>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <code style="font-weight:800; color:#fff;">${lic.chave}</code>
                                <button class="btn-act" onclick="copyText('${lic.chave}')" title="Copiar Chave">📋</button>
                            </div>
                        </td>
                        <td><span class="plan-pill">${(lic.tipo_plano || 'MENSAL').toUpperCase()}</span></td>
                        <td><span class="badge-status ${statusClass}">${statusClass.toUpperCase()}</span></td>
                        <td>${clienteTxt}</td>
                        <td>${deviceTxt}</td>
                        <td>${expFormatted}</td>
                        <td>
                            <div class="table-actions-cell">
                                ${lic.device_id ? `<button class="btn-act btn-unbind" onclick="handleUnbind('${lic.id}')" title="Desvincular Aparelho">🔄 Desvincular</button>` : ''}
                                <button class="btn-act" onclick="handleExtend('${lic.id}')" title="Adicionar +30 Dias">➕ +30d</button>
                                <button class="btn-act btn-block" onclick="handleToggleBlock('${lic.id}', '${lic.status}')">${lic.status === 'bloqueada' ? 'Desbloquear' : 'Bloquear'}</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        // 7. Criar Licença
        if (formCreate) {
            formCreate.addEventListener('submit', async (e) => {
                e.preventDefault();
                const plano = selectPlano.value;
                const dias = inputDias.value;
                const maxDev = inputMaxDevices ? inputMaxDevices.value : 1;
                const btn = document.getElementById('btn-generate');

                if (btn) btn.disabled = true;
                try {
                    const res = await window.AuthService.createLicense(plano, dias, maxDev);
                    if (res.success && res.license) {
                        const lic = res.license;
                        if (newLicKeyDisplay) newLicKeyDisplay.textContent = lic.chave;
                        if (newLicPlanBadge) newLicPlanBadge.textContent = `${plano.toUpperCase()} • ${dias} DIAS`;
                        if (newLicBox) newLicBox.style.display = 'block';

                        if (btnCopyNewKey) btnCopyNewKey.onclick = () => copyText(lic.chave);
                        if (btnWhatsappNewKey) {
                            btnWhatsappNewKey.onclick = () => {
                                const msg = encodeURIComponent(`Olá! Aqui está sua chave de ativação para o sistema MOMENTOS:\n\n🔑 Chave: *${lic.chave}*\nPlano: *${plano.toUpperCase()}* (${dias} dias)\n\nAcesse no seu computador para ativar: https://momentos.vercel.app/vendas`);
                                window.open(`https://api.whatsapp.com/send?text=${msg}`, '_blank');
                            };
                        }

                        showToast("Licença criada com sucesso!");
                        loadLicenses();
                    }
                } catch (err) {
                    showToast("Erro ao gerar licença.");
                } finally {
                    if (btn) btn.disabled = false;
                }
            });
        }

        // 8. Ações Globais
        window.copyText = (text) => {
            navigator.clipboard.writeText(text).then(() => {
                showToast("Chave copiada para a área de transferência! 📋");
            }).catch(() => {
                prompt("Copie a chave:", text);
            });
        };

        window.handleUnbind = async (id) => {
            if (confirm("Deseja desvincular o aparelho desta licença? O cliente poderá vincular um novo computador/celular.")) {
                const res = await window.AuthService.unbindDevice(id);
                showToast(res.message);
                loadLicenses();
            }
        };

        window.handleExtend = async (id) => {
            const res = await window.AuthService.extendLicenseDays(id, 30);
            showToast(res.message);
            loadLicenses();
        };

        window.handleToggleBlock = async (id, currentStatus) => {
            const res = await window.AuthService.toggleLicenseBlock(id, currentStatus);
            showToast(`Licença ${res.newStatus === 'bloqueada' ? 'bloqueada' : 'desbloqueada'}`);
            loadLicenses();
        };

        if (searchInput) searchInput.addEventListener('input', renderTable);
        if (btnRefresh) {
            btnRefresh.addEventListener('click', () => {
                showToast("Atualizando licenças...");
                loadLicenses();
            });
        }

        function showToast(msg) {
            if (!toast) return;
            toast.textContent = msg;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        // Inicializa o carregamento imediato
        loadLicenses();
    }

    // Garante inicialização em qualquer estado do DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGestor);
    } else {
        initGestor();
    }

})();
