// ==============================================================================
// MOMENTOS • Script da Tela de Vendas & Ativação de Licenças
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
    const userEmailDisplay = document.getElementById('user-display-email');
    const btnLogout = document.getElementById('btn-logout');
    const formActivate = document.getElementById('form-activate-key');
    const inputKey = document.getElementById('input-license-key');
    const btnActivate = document.getElementById('btn-activate');
    const alertBox = document.getElementById('activation-alert');
    const deviceInfoName = document.getElementById('device-info-name');
    const toast = document.getElementById('toast');

    // 1. Identificação do Usuário e Aparelho
    const user = window.AuthService ? window.AuthService.getCurrentUser() : null;
    const deviceData = window.DeviceFingerprint ? window.DeviceFingerprint.getDevice() : { deviceId: 'DEV-UNKNOWN', friendlyName: 'Aparelho' };

    if (user && userEmailDisplay) {
        userEmailDisplay.textContent = user.email;
    }

    if (deviceInfoName) {
        deviceInfoName.textContent = `${deviceData.friendlyName} (${deviceData.deviceId})`;
    }

    // 2. Logout
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            window.AuthService.logout();
        });
    }

    function showAlert(msg, isError = true) {
        alertBox.textContent = msg;
        alertBox.className = `act-alert ${isError ? 'error' : 'success'}`;
        alertBox.style.display = 'block';
    }

    // 3. Formulário de Ativação
    formActivate.addEventListener('submit', async (e) => {
        e.preventDefault();
        const chave = inputKey.value.trim().toUpperCase();

        btnActivate.disabled = true;
        btnActivate.innerHTML = '<span>Vinculando aparelho...</span>';

        try {
            const res = await window.AuthService.activateLicenseKey(chave, user?.email || 'cliente@arena.com');
            if (res.success) {
                showAlert("🎉 Licença ativada e vinculada a este aparelho com sucesso! Redirecionando para o sistema...", false);
                setTimeout(() => {
                    window.location.href = '/index.html';
                }, 1200);
            } else {
                showAlert(res.error || "Chave inválida ou não encontrada.");
                btnActivate.disabled = false;
                btnActivate.innerHTML = '<span>Ativar Aparelho</span>';
            }
        } catch (err) {
            showAlert("Erro de conexão ao ativar licença.");
            btnActivate.disabled = false;
            btnActivate.innerHTML = '<span>Ativar Aparelho</span>';
        }
    });

    // 4. Contratar Plano via WhatsApp
    window.hirePlan = (planName) => {
        const email = user ? user.email : 'cliente@arena.com';
        const msg = encodeURIComponent(
            `Olá! Gostaria de contratar a licença do *${planName}* para o sistema MOMENTOS.\n\n` +
            `📧 Meu E-mail: ${email}\n` +
            `📱 Meu Aparelho (Device ID): ${deviceData.deviceId} (${deviceData.friendlyName})\n\n` +
            `Por favor, me envie a chave de ativação!`
        );
        window.open(`https://api.whatsapp.com/send?text=${msg}`, '_blank');
    };

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
});
