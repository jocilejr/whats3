const express = require('express');
const cors = require('cors');
const { DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const makeWASocket = require('@whiskeysockets/baileys').default;
const qrTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['*'],
    allowedHeaders: ['*']
}));
app.use(express.json());

// Global state management
let instances = new Map(); // instanceId -> { sock, qr, connected, connecting, user }
let currentQR = null;
let qrUpdateInterval = null;

// QR Code auto-refresh every 30 seconds (WhatsApp QR expires after 60s)
const startQRRefresh = (instanceId) => {
    if (qrUpdateInterval) clearInterval(qrUpdateInterval);
    
    qrUpdateInterval = setInterval(() => {
        const instance = instances.get(instanceId);
        if (instance && !instance.connected && instance.connecting) {
            console.log('🔄 QR Code expirado, gerando novo...');
            // Don't reconnect immediately, let WhatsApp generate new QR
        }
    }, 30000); // 30 seconds
};

const stopQRRefresh = () => {
    if (qrUpdateInterval) {
        clearInterval(qrUpdateInterval);
        qrUpdateInterval = null;
    }
};

async function connectInstance(instanceId) {
    try {
        console.log(`🔄 Iniciando conexão para instância: ${instanceId}`);
        
        // Create instance directory
        const authDir = `./auth_${instanceId}`;
        if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        
        const sock = makeWASocket({
            auth: state,
            browser: ['WhatsFlow', 'Desktop', '1.0.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 30000,
            generateHighQualityLinkPreview: true,
            markOnlineOnConnect: true,
            syncFullHistory: true,
            retryRequestDelayMs: 5000,
            maxRetries: 5
        });

        // Initialize instance
        instances.set(instanceId, {
            sock: sock,
            qr: null,
            connected: false,
            connecting: true,
            user: null,
            lastSeen: new Date()
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            const instance = instances.get(instanceId);
            
            if (qr) {
                console.log(`📱 Novo QR Code gerado para instância: ${instanceId}`);
                currentQR = qr;
                instance.qr = qr;
                
                // Manual QR display in terminal (since printQRInTerminal is deprecated)
                try {
                    qrTerminal.generate(qr, { small: true });
                } catch (err) {
                    console.log('⚠️ QR Terminal não disponível:', err.message);
                }
                
                startQRRefresh(instanceId);
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                const reason = lastDisconnect?.error?.output?.statusCode || 'unknown';
                
                console.log(`🔌 Instância ${instanceId} desconectada. Razão: ${reason}, Reconectar: ${shouldReconnect}`);
                
                instance.connected = false;
                instance.connecting = false;
                instance.user = null;
                stopQRRefresh();
                
                // Implement robust reconnection logic
                if (shouldReconnect) {
                    if (reason === DisconnectReason.restartRequired) {
                        console.log(`🔄 Restart requerido para ${instanceId}`);
                        setTimeout(() => connectInstance(instanceId), 5000);
                    } else if (reason === DisconnectReason.connectionClosed) {
                        console.log(`🔄 Conexão fechada, reconectando ${instanceId}`);
                        setTimeout(() => connectInstance(instanceId), 10000);
                    } else if (reason === DisconnectReason.connectionLost) {
                        console.log(`🔄 Conexão perdida, reconectando ${instanceId}`);
                        setTimeout(() => connectInstance(instanceId), 15000);
                    } else if (reason === DisconnectReason.timedOut) {
                        console.log(`⏱️ Timeout, reconectando ${instanceId}`);
                        setTimeout(() => connectInstance(instanceId), 20000);
                    } else {
                        console.log(`🔄 Reconectando ${instanceId} em 30 segundos`);
                        setTimeout(() => connectInstance(instanceId), 30000);
                    }
                } else {
                    console.log(`❌ Instância ${instanceId} deslogada permanentemente`);
                    // Clean auth files if logged out
                    try {
                        const authPath = path.join('./auth_' + instanceId);
                        if (fs.existsSync(authPath)) {
                            fs.rmSync(authPath, { recursive: true, force: true });
                            console.log(`🧹 Arquivos de auth removidos para ${instanceId}`);
                        }
                    } catch (err) {
                        console.log('⚠️ Erro ao limpar arquivos de auth:', err.message);
                    }
                }
                
                // Notify backend about disconnection
                try {
                    const fetch = (await import('node-fetch')).default;
                    await fetch(`${process.env.WHATSFLOW_API_URL || 'http://localhost:8889'}/api/whatsapp/disconnected`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            instanceId: instanceId,
                            reason: reason
                        })
                    });
                } catch (err) {
                    console.log('⚠️ Não foi possível notificar desconexão:', err.message);
                }
                
            } else if (connection === 'open') {
                console.log(`✅ Instância ${instanceId} conectada com SUCESSO!`);
                instance.connected = true;
                instance.connecting = false;
                instance.qr = null;
                instance.lastSeen = new Date();
                currentQR = null;
                stopQRRefresh();
                
                // Get user info
                instance.user = {
                    id: sock.user.id,
                    name: sock.user.name || sock.user.id.split(':')[0],
                    profilePictureUrl: null,
                    phone: sock.user.id.split(':')[0]
                };
                
                console.log(`👤 Usuário conectado: ${instance.user.name} (${instance.user.phone})`);
                
                // Try to get profile picture
                try {
                    const profilePic = await sock.profilePictureUrl(sock.user.id, 'image');
                    instance.user.profilePictureUrl = profilePic;
                    console.log('📸 Foto do perfil obtida');
                } catch (err) {
                    console.log('⚠️ Não foi possível obter foto do perfil');
                }
                
                // Wait a bit before importing chats to ensure connection is stable
                setTimeout(async () => {
                    try {
                        console.log('📥 Importando conversas existentes...');
                        
                        // Get all chats
                        const chats = await sock.getChats();
                        console.log(`📊 ${chats.length} conversas encontradas`);
                        
                        // Process chats in batches to avoid overwhelming the system
                        const batchSize = 20;
                        for (let i = 0; i < chats.length; i += batchSize) {
                            const batch = chats.slice(i, i + batchSize);
                            
                            // Send batch to Python backend
                            const fetch = (await import('node-fetch')).default;
                            await fetch(`${process.env.WHATSFLOW_API_URL || 'http://localhost:8889'}/api/chats/import`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    instanceId: instanceId,
                                    chats: batch,
                                    user: instance.user,
                                    batchNumber: Math.floor(i / batchSize) + 1,
                                    totalBatches: Math.ceil(chats.length / batchSize)
                                })
                            });
                            
                            console.log(`📦 Lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(chats.length / batchSize)} enviado`);
                            
                            // Small delay between batches
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                        
                        console.log('✅ Importação de conversas concluída');
                        
                    } catch (err) {
                        console.log('⚠️ Erro ao importar conversas:', err.message);
                    }
                }, 5000); // Wait 5 seconds after connection
                
                // Send connected notification to Python backend
                setTimeout(async () => {
                    try {
                        const fetch = (await import('node-fetch')).default;
                        await fetch(`${process.env.WHATSFLOW_API_URL || 'http://localhost:8889'}/api/whatsapp/connected`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                instanceId: instanceId,
                                user: instance.user,
                                connectedAt: new Date().toISOString()
                            })
                        });
                        console.log('✅ Backend notificado sobre a conexão');
                    } catch (err) {
                        console.log('⚠️ Erro ao notificar backend:', err.message);
                    }
                }, 2000);
                
            } else if (connection === 'connecting') {
                console.log(`🔄 Conectando instância ${instanceId}...`);
                instance.connecting = true;
                instance.lastSeen = new Date();
            }
        });

        sock.ev.on('creds.update', saveCreds);
        
        // Handle incoming messages with better error handling
        sock.ev.on('messages.upsert', async (m) => {
            const messages = m.messages;
            
            for (const message of messages) {
                if (!message.key.fromMe && message.message) {
                    const from = message.key.remoteJid;
                    const messageText = message.message.conversation || 
                                      message.message.extendedTextMessage?.text || 
                                      'Mídia recebida';
                    
                    // Extract contact name from WhatsApp
                    const pushName = message.pushName || '';
                    const contact = await sock.onWhatsApp(from);
                    const contactName = pushName || contact[0]?.name || '';
                    
                    console.log(`📥 Nova mensagem na instância ${instanceId}`);
                    console.log(`👤 Contato: ${contactName || from.split('@')[0]} (${from.split('@')[0]})`);
                    console.log(`💬 Mensagem: ${messageText.substring(0, 50)}...`);
                    
                    // Send to Python backend with retry logic
                    let retries = 3;
                    while (retries > 0) {
                        try {
                            const fetch = (await import('node-fetch')).default;
                            const response = await fetch(`${process.env.WHATSFLOW_API_URL || 'http://localhost:8889'}/api/messages/receive`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    instanceId: instanceId,
                                    from: from,
                                    message: messageText,
                                    pushName: pushName,
                                    contactName: contactName,
                                    timestamp: new Date().toISOString(),
                                    messageId: message.key.id,
                                    messageType: message.message.conversation ? 'text' : 'media'
                                })
                            });
                            
                            if (response.ok) {
                                break; // Success, exit retry loop
                            } else {
                                throw new Error(`HTTP ${response.status}`);
                            }
                        } catch (err) {
                            retries--;
                            console.log(`❌ Erro ao enviar mensagem (tentativas restantes: ${retries}):`, err.message);
                            if (retries > 0) {
                                await new Promise(resolve => setTimeout(resolve, 2000));
                            }
                        }
                    }
                }
            }
        });

        // Keep connection alive with heartbeat
        setInterval(() => {
            const instance = instances.get(instanceId);
            if (instance && instance.connected && instance.sock) {
                instance.lastSeen = new Date();
                // Send heartbeat
                instance.sock.sendPresenceUpdate('available').catch(() => {});
            }
        }, 60000); // Every minute

    } catch (error) {
        console.error(`❌ Erro fatal ao conectar instância ${instanceId}:`, error);
        const instance = instances.get(instanceId);
        if (instance) {
            instance.connecting = false;
            instance.connected = false;
        }
    }
}

// API Routes with better error handling
app.get('/status/:instanceId?', (req, res) => {
    const { instanceId } = req.params;
    
    if (instanceId) {
        const instance = instances.get(instanceId);
        if (instance) {
            res.json({
                connected: instance.connected,
                connecting: instance.connecting,
                user: instance.user,
                instanceId: instanceId,
                lastSeen: instance.lastSeen
            });
        } else {
            res.json({
                connected: false,
                connecting: false,
                user: null,
                instanceId: instanceId,
                lastSeen: null
            });
        }
    } else {
        // Return all instances
        const allInstances = {};
        for (const [id, instance] of instances) {
            allInstances[id] = {
                connected: instance.connected,
                connecting: instance.connecting,
                user: instance.user,
                lastSeen: instance.lastSeen
            };
        }
        res.json(allInstances);
    }
});

app.get('/qr/:instanceId', (req, res) => {
    const { instanceId } = req.params;
    const instance = instances.get(instanceId);
    
    if (instance && instance.qr) {
        res.json({
            qr: instance.qr,
            connected: instance.connected,
            instanceId: instanceId,
            expiresIn: 60 // QR expires in 60 seconds
        });
    } else {
        res.json({
            qr: null,
            connected: instance ? instance.connected : false,
            instanceId: instanceId,
            expiresIn: 0
        });
    }
});

app.post('/connect/:instanceId', (req, res) => {
    const { instanceId } = req.params;
    
    const instance = instances.get(instanceId);
    if (!instance || (!instance.connected && !instance.connecting)) {
        connectInstance(instanceId || 'default');
        res.json({ success: true, message: `Iniciando conexão para instância ${instanceId}...` });
    } else if (instance.connecting) {
        res.json({ success: true, message: `Instância ${instanceId} já está conectando...` });
    } else {
        res.json({ success: false, message: `Instância ${instanceId} já está conectada` });
    }
});

app.post('/disconnect/:instanceId', (req, res) => {
    const { instanceId } = req.params;
    const instance = instances.get(instanceId);

    if (instance && instance.sock) {
        try {
            instance.sock.logout();
            instances.delete(instanceId);
            stopQRRefresh();
            res.json({ success: true, message: `Instância ${instanceId} desconectada` });
        } catch (err) {
            res.json({ success: false, message: `Erro ao desconectar ${instanceId}: ${err.message}` });
        }
    } else {
        res.json({ success: false, message: 'Instância não encontrada' });
    }
});

const deriveDocumentFileName = (input, fallback = 'document') => {
    if (!input || typeof input !== 'string') {
        return fallback;
    }

    try {
        const parsed = new URL(input);
        if (parsed.pathname) {
            const segments = parsed.pathname.split('/').filter(Boolean);
            if (segments.length > 0) {
                return segments.pop();
            }
        }
    } catch (err) {
        // Ignore URL parsing errors and fallback to manual extraction
    }

    const sanitized = input.split('?')[0];
    const parts = sanitized.split('/').filter(Boolean);
    if (parts.length > 0) {
        return parts.pop();
    }

    return fallback;
};

const sanitizePhoneNumber = (phone) => {
    if (!phone) {
        return '';
    }
    return String(phone).replace(/\D/g, '');
};

const buildVCard = (contactData) => {
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    lines.push(`FN:${contactData.name}`);

    if (contactData.organization) {
        lines.push(`ORG:${contactData.organization}`);
    }

    const phoneDigits = sanitizePhoneNumber(contactData.phone);
    const formattedPhone = contactData.phone || phoneDigits;
    if (phoneDigits) {
        lines.push(`TEL;type=CELL;type=VOICE;waid=${phoneDigits}:${formattedPhone}`);
    } else if (formattedPhone) {
        lines.push(`TEL;type=CELL;type=VOICE:${formattedPhone}`);
    }

    if (contactData.email) {
        lines.push(`EMAIL;type=INTERNET:${contactData.email}`);
    }

    lines.push('END:VCARD');
    return lines.join('\n');
};

const parseStructuredData = (value) => {
    if (!value) {
        return null;
    }

    if (typeof value === 'object') {
        return value;
    }

    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (err) {
            return null;
        }
    }

    return null;
};

app.post('/send/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
add-media-types-and-validation-in-server.js
    const { to, message, imageData, mediaData, mediaUrl, fileName } = req.body;
    const rawType = req.body.type ?? 'text';
    const type = typeof rawType === 'string' ? rawType.toLowerCase().trim() : 'text';
    const mimetype = typeof req.body.mimetype === 'string' ? req.body.mimetype : undefined;


    const instance = instances.get(instanceId);
    if (!instance || !instance.connected || !instance.sock) {
        return res.status(400).json({
            success: false,
            error: 'Instância não conectada',
            instanceId: instanceId
        });
    }

    if (!to || typeof to !== 'string' || !to.trim()) {
        return res.status(400).json({
            success: false,
            error: 'Destinatário inválido',
            details: 'Informe o número ou JID de destino no campo "to".',
            instanceId: instanceId,
            type
        });
    }

    const mediaTypes = ['image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'poll'];
    const supportedTypes = ['text', ...mediaTypes];

    if (!supportedTypes.includes(type)) {
        return res.status(400).json({
            success: false,
            error: `Tipo de mensagem não suportado: ${type}`,
            supportedTypes,
            instanceId: instanceId,
            type
        });
    }

    const getBufferFromBase64 = (data, fieldName) => {
        if (typeof data !== 'string') {
            throw new Error(`Dados base64 inválidos no campo ${fieldName}`);
        }

        const sanitizedData = data.includes(',')
            ? data.substring(data.indexOf(',') + 1).trim()
            : data.trim();
        const normalized = sanitizedData.replace(/\s/g, '');
        const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;

        if (!normalized || !base64Regex.test(normalized)) {
            throw new Error(`Dados base64 inválidos no campo ${fieldName}`);
        }

        return Buffer.from(normalized, 'base64');
    };

    try {
        const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
add-media-types-and-validation-in-server.js
        const caption = typeof message === 'string' ? message : '';
        const trimmedCaption = caption.trim();
        let payload = null;

        if (type === 'text') {
            const text = typeof message === 'string' ? message.trim() : '';
            if (!text) {
                return res.status(400).json({
                    success: false,
                    error: 'Mensagem de texto vazia',
                    details: 'Preencha o campo "message" com o conteúdo a ser enviado.',
                    instanceId: instanceId,
                    type
                });
            }

            payload = { text };
        } else if (mediaTypes.includes(type)) {
            switch (type) {
                case 'image': {
                    const base64Source = typeof mediaData === 'string' ? mediaData : (typeof imageData === 'string' ? imageData : undefined);
                    const urlSource = typeof mediaUrl === 'string' ? mediaUrl.trim() : undefined;

                    if (!base64Source && !urlSource) {
                        return res.status(400).json({
                            success: false,
                            error: 'Imagem não fornecida',
                            details: 'Envie a imagem como base64 em "imageData"/"mediaData" ou informe uma URL em "mediaUrl".',
                            instanceId: instanceId,
                            type
                        });
                    }

                    if (base64Source) {
                        let buffer;
                        try {
                            buffer = getBufferFromBase64(base64Source, 'imageData');
                        } catch (err) {
                            return res.status(400).json({
                                success: false,
                                error: err.message,
                                instanceId: instanceId,
                                type
                            });
                        }

                        payload = { image: buffer };
                    } else {
                        payload = { image: { url: urlSource } };
                    }

                    if (trimmedCaption) {
                        payload.caption = caption;
                    }
                    break;
                }
                case 'video': {
                    const base64Source = typeof mediaData === 'string' ? mediaData : (typeof imageData === 'string' ? imageData : undefined);
                    const urlSource = typeof mediaUrl === 'string' ? mediaUrl.trim() : undefined;

                    if (!base64Source && !urlSource) {
                        return res.status(400).json({
                            success: false,
                            error: 'Vídeo não fornecido',
                            details: 'Envie o vídeo como base64 em "mediaData" ou informe uma URL em "mediaUrl".',
                            instanceId: instanceId,
                            type
                        });
                    }

                    if (base64Source) {
                        let buffer;
                        try {
                            buffer = getBufferFromBase64(base64Source, 'mediaData');
                        } catch (err) {
                            return res.status(400).json({
                                success: false,
                                error: err.message,
                                instanceId: instanceId,
                                type
                            });
                        }

                        payload = { video: buffer };
                    } else {
                        payload = { video: { url: urlSource } };
                    }

                    if (trimmedCaption) {
                        payload.caption = caption;
                    }
                    if (mimetype) {
                        payload.mimetype = mimetype;
                    }
                    if (typeof req.body.gifPlayback === 'boolean') {
                        payload.gifPlayback = req.body.gifPlayback;
                    }
                    break;
                }
                case 'audio': {
                    const base64Source = typeof mediaData === 'string' ? mediaData : (typeof imageData === 'string' ? imageData : undefined);
                    const urlSource = typeof mediaUrl === 'string' ? mediaUrl.trim() : undefined;

                    if (!base64Source && !urlSource) {
                        return res.status(400).json({
                            success: false,
                            error: 'Áudio não fornecido',
                            details: 'Envie o áudio como base64 em "mediaData" ou informe uma URL em "mediaUrl".',
                            instanceId: instanceId,
                            type
                        });
                    }

                    if (base64Source) {
                        let buffer;
                        try {
                            buffer = getBufferFromBase64(base64Source, 'mediaData');
                        } catch (err) {
                            return res.status(400).json({
                                success: false,
                                error: err.message,
                                instanceId: instanceId,
                                type
                            });
                        }

                        payload = { audio: buffer };
                    } else {
                        payload = { audio: { url: urlSource } };
                    }

                    if (mimetype) {
                        payload.mimetype = mimetype;
                    }
                    if (typeof req.body.ptt === 'boolean') {
                        payload.ptt = req.body.ptt;
                    }
                    if (Array.isArray(req.body.waveform)) {
                        payload.waveform = req.body.waveform;
                    }
                    break;
                }
                case 'document': {
                    const base64Source = typeof mediaData === 'string' ? mediaData : (typeof imageData === 'string' ? imageData : undefined);
                    const urlSource = typeof mediaUrl === 'string' ? mediaUrl.trim() : undefined;

                    if (!base64Source && !urlSource) {
                        return res.status(400).json({
                            success: false,
                            error: 'Documento não fornecido',
                            details: 'Envie o documento como base64 em "mediaData" ou informe uma URL em "mediaUrl".',
                            instanceId: instanceId,
                            type
                        });
                    }

                    if (base64Source) {
                        let buffer;
                        try {
                            buffer = getBufferFromBase64(base64Source, 'mediaData');
                        } catch (err) {
                            return res.status(400).json({
                                success: false,
                                error: err.message,
                                instanceId: instanceId,
                                type
                            });
                        }

                        payload = { document: buffer };
                    } else {
                        payload = { document: { url: urlSource } };
                    }

                    if (trimmedCaption) {
                        payload.caption = caption;
                    }
                    if (fileName && typeof fileName === 'string' && fileName.trim()) {
                        payload.fileName = fileName.trim();
                    }
                    if (mimetype) {
                        payload.mimetype = mimetype;
                    }
                    break;
                }
                case 'sticker': {
                    const stickerInfo = (typeof req.body.sticker === 'object' && req.body.sticker !== null) ? req.body.sticker : {};
                    const base64Source = typeof stickerInfo.data === 'string'
                        ? stickerInfo.data
                        : (typeof stickerInfo.base64 === 'string'
                            ? stickerInfo.base64
                            : (typeof mediaData === 'string'
                                ? mediaData
                                : (typeof imageData === 'string' ? imageData : undefined)));
                    const stickerUrl = typeof stickerInfo.url === 'string' && stickerInfo.url.trim()
                        ? stickerInfo.url.trim()
                        : (typeof mediaUrl === 'string' ? mediaUrl.trim() : undefined);

                    if (!base64Source && !stickerUrl) {
                        return res.status(400).json({
                            success: false,
                            error: 'Sticker não fornecido',
                            details: 'Envie o sticker como base64 em "sticker.data"/"sticker.base64" ou informe uma URL em "sticker.url"/"mediaUrl".',
                            instanceId: instanceId,
                            type
                        });
                    }

                    if (base64Source) {
                        let buffer;
                        try {
                            buffer = getBufferFromBase64(base64Source, 'sticker.data');
                        } catch (err) {
                            return res.status(400).json({
                                success: false,
                                error: err.message,
                                instanceId: instanceId,
                                type
                            });
                        }

                        payload = { sticker: buffer };
                    } else {
                        payload = { sticker: { url: stickerUrl } };
                    }
                    break;
                }
                case 'location': {
                    const locationInfo = (typeof req.body.location === 'object' && req.body.location !== null) ? req.body.location : {};
                    const latCandidate = locationInfo.degreesLatitude ?? locationInfo.latitude ?? req.body.degreesLatitude ?? req.body.latitude ?? req.body.lat;
                    const lonCandidate = locationInfo.degreesLongitude ?? locationInfo.longitude ?? req.body.degreesLongitude ?? req.body.longitude ?? req.body.lng;
                    const latitude = latCandidate !== undefined ? Number(latCandidate) : NaN;
                    const longitude = lonCandidate !== undefined ? Number(lonCandidate) : NaN;

                    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                        return res.status(400).json({
                            success: false,
                            error: 'Localização inválida',
                            details: 'Informe latitude e longitude válidas (degreesLatitude/degreesLongitude).',
                            instanceId: instanceId,
                            type
                        });
                    }

                    const locationMessage = {
                        location: {
                            degreesLatitude: latitude,
                            degreesLongitude: longitude
                        }
                    };

                    const locationName = locationInfo.name ?? req.body.locationName;
                    const locationAddress = locationInfo.address ?? req.body.locationAddress;
                    const locationDescription = locationInfo.description ?? req.body.locationDescription;

                    if (typeof locationName === 'string' && locationName.trim()) {
                        locationMessage.location.name = locationName.trim();
                    }
                    if (typeof locationAddress === 'string' && locationAddress.trim()) {
                        locationMessage.location.address = locationAddress.trim();
                    }
                    if (typeof locationDescription === 'string' && locationDescription.trim()) {
                        locationMessage.location.description = locationDescription.trim();
                    }

                    payload = locationMessage;
                    break;
                }
                case 'contact': {
                    const contactInfo = (typeof req.body.contact === 'object' && req.body.contact !== null) ? req.body.contact : {};
                    const providedContacts = Array.isArray(contactInfo.contacts) && contactInfo.contacts.length
                        ? contactInfo.contacts
                        : (Array.isArray(req.body.contacts) ? req.body.contacts : []);
                    const contactsList = [];

                    const addContactEntry = (entry) => {
                        if (!entry || typeof entry !== 'object') {
                            return;
                        }

                        const vcardValue = typeof entry.vcard === 'string' && entry.vcard.trim()
                            ? entry.vcard.trim()
                            : (typeof entry.vCard === 'string' && entry.vCard.trim() ? entry.vCard.trim() : undefined);

                        if (!vcardValue) {
                            return;
                        }

                        const entryDisplayName = (entry.displayName || entry.name || contactInfo.displayName || contactInfo.name || '').toString().trim();

                        contactsList.push({
                            displayName: entryDisplayName,
                            vcard: vcardValue
                        });
                    };

                    providedContacts.forEach(addContactEntry);

                    if (!contactsList.length && (typeof contactInfo.vcard === 'string' || typeof contactInfo.vCard === 'string')) {
                        addContactEntry(contactInfo);
                    }

                    if (!contactsList.length) {
                        return res.status(400).json({
                            success: false,
                            error: 'Contato inválido',
                            details: 'Forneça ao menos um contato com o campo "vcard" preenchido.',
                            instanceId: instanceId,
                            type
                        });
                    }

                    const defaultDisplayName = (contactInfo.displayName || contactInfo.name || contactsList[0].displayName || 'Contato').toString();

                    payload = {
                        contacts: {
                            displayName: defaultDisplayName,
                            contacts: contactsList.map((entry) => ({
                                displayName: entry.displayName || defaultDisplayName,
                                vcard: entry.vcard
                            }))
                        }
                    };
                    break;
                }
                case 'poll': {
                    const pollInfo = (typeof req.body.poll === 'object' && req.body.poll !== null) ? req.body.poll : {};
                    const pollNameCandidate = typeof pollInfo.name === 'string' && pollInfo.name.trim()
                        ? pollInfo.name.trim()
                        : (typeof pollInfo.title === 'string' && pollInfo.title.trim() ? pollInfo.title.trim() : null);

                    if (!pollNameCandidate) {
                        return res.status(400).json({
                            success: false,
                            error: 'Título da enquete não informado',
                            details: 'Defina o campo "poll.name" (ou "poll.title").',
                            instanceId: instanceId,
                            type
                        });
                    }

                    const rawOptions = Array.isArray(pollInfo.values) && pollInfo.values.length
                        ? pollInfo.values
                        : (Array.isArray(pollInfo.options) ? pollInfo.options : []);

                    const normalizedOptions = rawOptions
                        .map((option) => {
                            if (typeof option === 'string') {
                                return option.trim();
                            }
                            if (option && typeof option === 'object') {
                                const label = option.option || option.title || option.name || option.text;
                                return typeof label === 'string' ? label.trim() : '';
                            }
                            return '';
                        })
                        .filter((value) => !!value);

                    if (normalizedOptions.length < 2) {
                        return res.status(400).json({
                            success: false,
                            error: 'Opções da enquete insuficientes',
                            details: 'Informe pelo menos duas opções em "poll.values" ou "poll.options".',
                            instanceId: instanceId,
                            type
                        });
                    }

                    const pollMessage = {
                        poll: {
                            name: pollNameCandidate,
                            values: normalizedOptions
                        }
                    };

                    if (pollInfo.selectableCount !== undefined) {
                        const selectableCount = Number(pollInfo.selectableCount);
                        if (!Number.isInteger(selectableCount) || selectableCount < 1 || selectableCount > normalizedOptions.length) {
                            return res.status(400).json({
                                success: false,
                                error: 'Valor inválido para selectableCount',
                                details: 'O campo "poll.selectableCount" deve ser um número inteiro entre 1 e o total de opções.',
                                instanceId: instanceId,
                                type
                            });
                        }
                        pollMessage.poll.selectableCount = selectableCount;
                    } else if (pollInfo.allowMultipleAnswers || pollInfo.multiselect) {
                        pollMessage.poll.selectableCount = normalizedOptions.length;
                    }

                    payload = pollMessage;
                    break;
                }
                default:
                    return res.status(400).json({
                        success: false,
                        error: `Tipo de mensagem não suportado: ${type}`,
                        supportedTypes,
                        instanceId: instanceId,
                        type
                    });
            }
        }

        if (!payload) {
            return res.status(400).json({
                success: false,
                error: 'Não foi possível montar a mensagem para o tipo informado.',
                instanceId: instanceId,
                type
            });
        }

        await instance.sock.sendMessage(jid, payload);
        console.log(`📤 Mensagem ${type} enviada da instância ${instanceId} para ${to}`);
        res.json({ success: true, instanceId: instanceId, type, to: jid });

    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem da instância ${instanceId}:`, error);
        res.status(500).json({
            success: false,
            error: 'Erro interno ao enviar mensagem',
            details: error.message,
            instanceId: instanceId,
            type
        });
    }
});

// Groups endpoint with robust error handling  
app.get('/groups/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    
    try {
        const instance = instances.get(instanceId);
        if (!instance || !instance.connected || !instance.sock) {
            return res.status(400).json({ 
                success: false,
                error: `Instância ${instanceId} não está conectada`,
                instanceId: instanceId,
                groups: []
            });
        }
        
        console.log(`📥 Buscando grupos para instância: ${instanceId}`);
        
        // Multiple methods to get groups
        let groups = [];
        
        try {
            // Method 1: Get group metadata
            const groupIds = await instance.sock.groupFetchAllParticipating();
            console.log(`📊 Encontrados ${Object.keys(groupIds).length} grupos via groupFetchAllParticipating`);
            
            for (const [groupId, groupData] of Object.entries(groupIds)) {
                groups.push({
                    id: groupId,
                    name: groupData.subject || 'Grupo sem nome',
                    description: groupData.desc || '',
                    participants: groupData.participants ? groupData.participants.length : 0,
                    admin: groupData.participants ? 
                           groupData.participants.some(p => p.admin && p.id === instance.user?.id) : false,
                    created: groupData.creation || null
                });
            }
        } catch (error) {
            console.log(`⚠️ Método 1 falhou: ${error.message}`);
            
            try {
                // Method 2: Get chats and filter groups
                const chats = await instance.sock.getChats();
                const groupChats = chats.filter(chat => chat.id.endsWith('@g.us'));
                console.log(`📊 Encontrados ${groupChats.length} grupos via getChats`);
                
                groups = groupChats.map(chat => ({
                    id: chat.id,
                    name: chat.name || chat.subject || 'Grupo sem nome',
                    description: chat.description || '',
                    participants: chat.participantsCount || 0,
                    admin: false, // Cannot determine admin status from chat
                    created: chat.timestamp || null,
                    lastMessage: chat.lastMessage ? {
                        text: chat.lastMessage.message || '',
                        timestamp: chat.lastMessage.timestamp
                    } : null
                }));
            } catch (error2) {
                console.log(`⚠️ Método 2 falhou: ${error2.message}`);
                
                // Method 3: Simple fallback - return empty with proper structure
                groups = [];
            }
        }
        
        console.log(`✅ Retornando ${groups.length} grupos para instância ${instanceId}`);
        
        res.json({
            success: true,
            instanceId: instanceId,
            groups: groups,
            count: groups.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(`❌ Erro ao buscar grupos para instância ${instanceId}:`, error);
        res.status(500).json({
            success: false,
            error: `Erro interno ao buscar grupos: ${error.message}`,
            instanceId: instanceId,
            groups: []
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    const connectedInstances = Array.from(instances.values()).filter(i => i.connected).length;
    const connectingInstances = Array.from(instances.values()).filter(i => i.connecting).length;
    
    res.json({
        status: 'running',
        instances: {
            total: instances.size,
            connected: connectedInstances,
            connecting: connectingInstances
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Baileys service rodando na porta ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log('⏳ Aguardando comandos para conectar instâncias...');
});

module.exports = { app, instances };