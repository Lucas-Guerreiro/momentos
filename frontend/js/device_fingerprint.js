// ==============================================================================
// MOMENTOS • Identificador Único de Dispositivo (Device Fingerprinting & Binding)
// ==============================================================================

(function(window) {
    'use strict';

    const STORAGE_KEY = 'momentos_device_fingerprint';

    // Gera um Hash FNV-1a rápido em hexadecimal
    function fnv1a(str) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return ('0000000' + (hash >>> 0).toString(16)).substr(-8).toUpperCase();
    }

    // Canvas Fingerprinting sutil
    function getCanvasFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 50;
            const ctx = canvas.getContext('2d');
            if (!ctx) return 'no-canvas';
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('MOMENTOS-SPORTS-2026', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('MOMENTOS-SPORTS-2026', 4, 17);
            return canvas.toDataURL();
        } catch (e) {
            return 'canvas-error';
        }
    }

    // Detecta nome legível do dispositivo e navegador
    function getDeviceFriendlyName() {
        const ua = navigator.userAgent;
        let browser = 'Navegador Web';
        let os = 'Dispositivo';

        if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Edg')) browser = 'Edge';
        else if (ua.includes('Chrome')) browser = 'Chrome';
        else if (ua.includes('Safari')) browser = 'Safari';

        if (ua.includes('Windows')) os = 'Windows';
        else if (ua.includes('Mac OS')) os = 'macOS';
        else if (ua.includes('Android')) os = 'Android';
        else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
        else if (ua.includes('Linux')) os = 'Linux';

        return `${browser} no ${os} (${window.screen.width}x${window.screen.height})`;
    }

    // Gera ou recupera o Device ID permanente
    function getOrCreateDeviceId() {
        let stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.deviceId) {
                    return parsed;
                }
            } catch(e) {}
        }

        // Constrói atributos estáveis do hardware e navegador
        const components = [
            navigator.userAgent || '',
            navigator.language || '',
            screen.width + 'x' + screen.height,
            screen.colorDepth || '',
            new Date().getTimezoneOffset(),
            navigator.hardwareConcurrency || 2,
            getCanvasFingerprint()
        ];

        const rawSignature = components.join('###');
        const hash1 = fnv1a(rawSignature);
        const hash2 = fnv1a(rawSignature + 'SALT_MOMENTOS_ARENA');
        const randomEntropy = Math.random().toString(36).substring(2, 6).toUpperCase();

        const deviceId = `DEV-${hash1.substr(0, 4)}-${hash2.substr(0, 4)}-${randomEntropy}`;
        const deviceData = {
            deviceId: deviceId,
            friendlyName: getDeviceFriendlyName(),
            createdAt: new Date().toISOString()
        };

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(deviceData));
        } catch (e) {}

        return deviceData;
    }

    window.DeviceFingerprint = {
        getDevice: getOrCreateDeviceId,
        getDeviceId: () => getOrCreateDeviceId().deviceId,
        getFriendlyName: () => getOrCreateDeviceId().friendlyName
    };

})(window);
