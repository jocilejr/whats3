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

// Fixed body size to avoid PayloadTooLargeError when sending media as base64
const BODY_LIMIT = '15mb';
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));

app.use((err, req, res, next) => {
    if (
        err &&
        (err.type === 'entity.too.large' ||
            err.name === 'PayloadTooLargeError' ||
            err.status === 413 ||
            err.statusCode === 413)
    ) {
        console.warn(
            '⚠️ Payload base64 recebido excede o limite suportado. Utilize URLs HTTP/HTTPS públicas para enviar mídias.',
        );
        return res.status(413).json({
            error:
                'Envio de mídia em base64 excede o limite suportado. Forneça mídias via URLs HTTP/HTTPS acessíveis publicamente.',
        });
    }

    return next(err);
});

const BASE64_ALLOWED_CHARS = /^[A-Za-z0-9+/=\n\r\t ]+$/;
const SUPPORTED_MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);

let cachedFetch = null;

async function ensureFetch() {
    if (cachedFetch) {
        return cachedFetch;
    }

    const fetchModule = await import('node-fetch');
    cachedFetch = fetchModule.default;
    return cachedFetch;
}

function looksLikeBase64(value) {
    if (!value) {
        return false;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }

    const lowered = trimmed.toLowerCase();
    if (lowered.startsWith('data:')) {
        return true;
    }

    if (lowered.startsWith('http://') || lowered.startsWith('https://')) {
        return false;
    }

    if (trimmed.length < 128) {
        return false;
    }

    if (!BASE64_ALLOWED_CHARS.test(trimmed)) {
        return false;
    }

    return trimmed.replace(/\s+/g, '').length % 4 === 0;
}

function sanitizeMediaUrl(rawUrl) {
    const trimmed = (rawUrl || '').trim();

    if (!trimmed) {
        return { error: 'URL de mídia obrigatória não fornecida.' };
    }

    const lowered = trimmed.toLowerCase();
    if (!lowered.startsWith('http://') && !lowered.startsWith('https://')) {
        if (looksLikeBase64(trimmed)) {
            return {
                error:
                    'Envio de mídia em base64 detectado. Utilize apenas URLs HTTP/HTTPS acessíveis publicamente.',
            };
        }

        return { error: 'URL de mídia deve começar com http:// ou https://.' };
    }

    return { url: trimmed };
}

async function inspectRemoteMedia(url) {
    const fetch = await ensureFetch();
    let response;

    try {
        response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    } catch (err) {
        throw new Error(`Não foi possível acessar a mídia remota: ${err.message}`);
    }

    if (!response.ok) {
        if (response.status === 405 || response.status === 501) {
            try {
                response = await fetch(url, { method: 'GET', redirect: 'follow' });
            } catch (err) {
                throw new Error(`Não foi possível acessar a mídia remota: ${err.message}`);
            }

            if (!response.ok) {
                throw new Error(
                    `Não foi possível acessar a mídia remota (status ${response.status}).`,
                );
            }

            if (response.body && typeof response.body.cancel === 'function') {
                response.body.cancel();
            } else if (response.body && typeof response.body.destroy === 'function') {
                response.body.destroy();
            }
        } else {
            throw new Error(`Não foi possível acessar a mídia remota (status ${response.status}).`);
        }
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (!contentLengthHeader) {
        return { contentLength: null };
    }

    const contentLength = Number(contentLengthHeader);
    if (Number.isNaN(contentLength)) {
        return { contentLength: null };
    }

    return { contentLength };
}

function buildMediaMessage(type, url, caption, providedFileName) {
    const mediaContent = { url };

    if (type === 'document') {
        let fileName = providedFileName || '';
        if (!fileName) {
            try {
                const parsed = new URL(url);
                fileName = path.basename(parsed.pathname) || '';
            } catch (err) {
                fileName = '';
            }
        }

        if (fileName) {
            mediaContent.fileName = fileName;
        }
    }

    const payload = { [type]: mediaContent };
    if (caption) {
        payload.caption = caption;
    }

    return payload;
}

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

app.post('/send/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const {
        to,
        message,
        type: rawType = 'text',
        mediaUrl,
        fileName,
        mediaType: providedMediaType,
    } = req.body;
    const imageData = typeof req.body?.imageData === 'string' ? req.body.imageData.trim() : '';
    const rawMessage = typeof message === 'string' ? message.trim() : '';

    const instance = instances.get(instanceId);
    if (!instance || !instance.connected || !instance.sock) {
        return res.status(400).json({ error: 'Instância não conectada', instanceId: instanceId });
    }

    try {
        const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        const normalizedRawType = typeof rawType === 'string' ? rawType.trim().toLowerCase() : 'text';
        const isGenericMediaType = ['media', 'mídia', 'midia'].includes(normalizedRawType);
        let normalizedType = normalizedRawType;

        if (isGenericMediaType) {
            const normalizedProvidedMediaType =
                typeof providedMediaType === 'string' ? providedMediaType.trim().toLowerCase() : '';

            if (!SUPPORTED_MEDIA_TYPES.has(normalizedProvidedMediaType)) {
                return res.status(400).json({
                    error:
                        "Tipo de mídia genérico requer campo 'mediaType' com um dos valores: image, video, audio ou document.",
                });
            }

            normalizedType = normalizedProvidedMediaType;
        }

        const caption =
            typeof req.body?.caption === 'string'
                ? req.body.caption
                : !isGenericMediaType
                ? rawMessage
                : '';

        if (normalizedType === 'text') {
            await instance.sock.sendMessage(jid, { text: rawMessage });
            console.log(`📤 Mensagem enviada da instância ${instanceId} para ${to}`);
            return res.json({ success: true, instanceId: instanceId });
        }

        if (!SUPPORTED_MEDIA_TYPES.has(normalizedType)) {
            return res.status(400).json({ error: `Unsupported message type: ${rawType}` });
        }

        if (imageData) {
            try {
                const approxBytes = Buffer.from(imageData, 'base64').length;
                console.warn(
                    `❌ Payload base64 recebido (${(approxBytes / (1024 * 1024)).toFixed(2)} MB). ` +
                        'Envio em base64 não é suportado.'
                );
            } catch (err) {
                console.warn('❌ Payload base64 inválido recebido e descartado.');
            }

            return res.status(400).json({
                error: 'Envio de mídia em base64 não é suportado. Utilize apenas URLs públicas acessíveis.',
            });
        }

        let sanitized;
        if (isGenericMediaType) {
            if (!rawMessage) {
                return res.status(400).json({
                    error: 'Mensagens de mídia devem fornecer a URL pública no campo "message".',
                });
            }

            if (looksLikeBase64(rawMessage)) {
                return res.status(400).json({
                    error: 'Envio de mídia em base64 não é suportado. Utilize apenas URLs públicas acessíveis.',
                });
            }

            sanitized = sanitizeMediaUrl(rawMessage);
            if (sanitized.error) {
                return res.status(400).json({ error: sanitized.error });
            }
        } else {
            sanitized = sanitizeMediaUrl(mediaUrl);
            if (sanitized.error) {
                return res.status(400).json({ error: sanitized.error });
            }
        }

        if (!sanitized?.url) {
            return res.status(400).json({
                error: 'Mensagens de mídia devem incluir uma URL HTTP/HTTPS pública.',
            });
        }

        let metadata;
        try {
            metadata = await inspectRemoteMedia(sanitized.url);
        } catch (err) {
            console.warn(`⚠️ Falha ao validar mídia remota: ${err.message}`);
            return res.status(400).json({ error: err.message });
        }

        if (metadata.contentLength && metadata.contentLength > MAX_MEDIA_BYTES) {
            const sizeMb = (metadata.contentLength / (1024 * 1024)).toFixed(2);
            console.warn(`❌ Mídia remota com ${sizeMb} MB excede o limite suportado.`);
            return res.status(413).json({
                error: `Mídia remota excede o limite de ${MAX_MEDIA_BYTES / (1024 * 1024)} MB.`,
            });
        }

        if (metadata.contentLength) {
            console.log(
                `🌐 Media remota reporta ${metadata.contentLength} bytes (~${(
                    metadata.contentLength /
                    (1024 * 1024)
                ).toFixed(2)} MB)`
            );
        } else {
            console.log('🌐 Media remota sem header content-length informado');
        }

        const messagePayload = buildMediaMessage(normalizedType, sanitized.url, caption, fileName);
        await instance.sock.sendMessage(jid, messagePayload);

        console.log(`📤 Mensagem enviada da instância ${instanceId} para ${to}`);
        return res.json({ success: true, instanceId: instanceId });
    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem da instância ${instanceId}:`, error);
        return res.status(500).json({ error: error.message, instanceId: instanceId });
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