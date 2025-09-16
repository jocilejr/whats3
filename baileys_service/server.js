const express = require('express');
const cors = require('cors');
const { DisconnectReason, useMultiFileAuthState, downloadMediaMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
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

const PARTICIPANT_ACTIONS = new Set(['add', 'remove', 'promote', 'demote']);

const normalizeJid = (jid) => {
    if (!jid || typeof jid !== 'string') {
        return jid;
    }

    try {
        return jidNormalizedUser(jid);
    } catch (err) {
        return jid;
    }
};

const ensureGroupJid = (groupId) => {
    if (!groupId || typeof groupId !== 'string') {
        throw new Error('ID do grupo inválido');
    }

    const trimmed = groupId.trim();
    if (!trimmed) {
        throw new Error('ID do grupo inválido');
    }

    return trimmed.endsWith('@g.us') ? trimmed : `${trimmed}@g.us`;
};

const ensureParticipantJid = (participant) => {
    if (!participant || typeof participant !== 'string') {
        throw new Error('Participante inválido');
    }

    const trimmed = participant.trim();
    if (!trimmed) {
        throw new Error('Participante inválido');
    }

    if (trimmed.includes('@')) {
        return trimmed;
    }

    return `${trimmed}@s.whatsapp.net`;
};

const getInstanceOrThrow = (instanceId) => {
    const instance = instances.get(instanceId);
    if (!instance || !instance.connected || !instance.sock) {
        const error = new Error(`Instância ${instanceId} não está conectada`);
        error.statusCode = 400;
        throw error;
    }

    return instance;
};

const ensureGroupCache = (instance) => {
    if (!instance.groupMetadata) {
        instance.groupMetadata = new Map();
    }
    return instance.groupMetadata;
};

const getMeJid = (instance) => {
    const userId = instance?.sock?.user?.id;
    if (!userId) {
        return null;
    }

    return normalizeJid(userId);
};

const buildParticipantsSummary = (participants = [], meJid = null) => {
    return participants.map((participant) => {
        const id = participant?.id || participant?.jid || participant?.user || participant?.participant || participant;
        const participantJid = typeof id === 'string' ? id : '';
        const normalized = participantJid ? normalizeJid(participantJid) : participantJid;
        const adminValue = participant?.admin;
        const isAdmin = Boolean(adminValue && adminValue !== 'none');
        const isSuperAdmin = adminValue === 'superadmin';
        const isMe = meJid ? normalizeJid(participantJid) === meJid : false;

        return {
            id: participantJid || normalized,
            jid: participantJid || normalized,
            name: participant?.name || participant?.notify || participant?.displayName || '',
            isAdmin,
            isSuperAdmin,
            isMe,
            phone: normalized?.endsWith('@s.whatsapp.net') ? normalized.replace('@s.whatsapp.net', '') : undefined,
            status: participant?.status
        };
    });
};

const serializeGroupMetadata = (metadata, instance) => {
    if (!metadata) {
        return null;
    }

    const meJid = getMeJid(instance);
    const participants = buildParticipantsSummary(metadata.participants || [], meJid);
    const isAdmin = participants.some((participant) => participant.isMe && participant.isAdmin);

    const announcementFlag = metadata?.announce;
    const restrictFlag = metadata?.restrict;

    return {
        id: metadata.id || metadata.jid || metadata.gid,
        jid: metadata.id || metadata.jid || metadata.gid,
        name: metadata.subject || metadata.name || 'Grupo sem nome',
        description: metadata.desc || metadata.description || '',
        owner: metadata.owner || metadata.creator || metadata.superAdmin,
        participants,
        participantCount: participants.length,
        permissions: {
            isAdmin,
            canManageParticipants: isAdmin,
            canEditInfo: isAdmin
        },
        settings: {
            announcement: announcementFlag === true || announcementFlag === 'true',
            locked: restrictFlag === true || restrictFlag === 'true',
            ephemeralDuration: metadata.ephemeralDuration || null
        },
        creation: metadata.creation || null,
        createdAt: metadata.creation ? new Date(metadata.creation * 1000).toISOString() : null,
        lastSyncedAt: metadata.lastSynced ? new Date(metadata.lastSynced).toISOString() : null
    };
};

const refreshGroupCache = async (instanceId) => {
    const instance = getInstanceOrThrow(instanceId);
    const cache = ensureGroupCache(instance);

    const groups = await instance.sock.groupFetchAllParticipating();
    cache.clear();

    const timestamp = Date.now();
    for (const [groupJid, metadata] of Object.entries(groups)) {
        metadata.id = groupJid;
        metadata.lastSynced = timestamp;
        cache.set(groupJid, metadata);
    }

    instance.groupCacheInitialized = true;
    instance.groupCacheTimestamp = timestamp;

    return cache;
};

const getGroupMetadataFromCache = async (instanceId, groupId, { forceRefresh = false } = {}) => {
    const instance = getInstanceOrThrow(instanceId);
    const cache = ensureGroupCache(instance);
    const groupJid = ensureGroupJid(groupId);

    let metadata = cache.get(groupJid);
    if (!metadata || forceRefresh) {
        metadata = await instance.sock.groupMetadata(groupJid);
        metadata.id = groupJid;
        metadata.lastSynced = Date.now();
        cache.set(groupJid, metadata);
    }

    return { instance, metadata, groupJid };
};

const ensureAdminPrivileges = async (instanceId, groupId) => {
    const { instance, metadata, groupJid } = await getGroupMetadataFromCache(instanceId, groupId);
    const meJid = getMeJid(instance);
    const participants = metadata?.participants || [];

    const isAdmin = participants.some((participant) => {
        const participantId = participant?.id || participant?.jid;
        if (!participantId) {
            return false;
        }
        return normalizeJid(participantId) === meJid && participant?.admin;
    });

    if (!isAdmin) {
        const error = new Error('Usuário conectado não é administrador do grupo');
        error.statusCode = 403;
        throw error;
    }

    return { instance, metadata, groupJid };
};

const applyParticipantsChange = (metadata, participants, action) => {
    if (!metadata.participants) {
        metadata.participants = [];
    }

    const normalizedMap = new Map();
    for (const participant of metadata.participants) {
        const participantId = participant?.id || participant?.jid;
        if (!participantId) {
            continue;
        }
        normalizedMap.set(normalizeJid(participantId), { ...participant });
    }

    for (const participant of participants) {
        const participantJid = normalizeJid(ensureParticipantJid(participant));
        const existing = normalizedMap.get(participantJid) || { id: participantJid };

        if (action === 'add') {
            normalizedMap.set(participantJid, { ...existing, id: existing.id || participantJid });
        } else if (action === 'remove') {
            normalizedMap.delete(participantJid);
        } else if (action === 'promote') {
            normalizedMap.set(participantJid, { ...existing, id: existing.id || participantJid, admin: existing.admin === 'superadmin' ? 'superadmin' : 'admin' });
        } else if (action === 'demote') {
            normalizedMap.set(participantJid, { ...existing, id: existing.id || participantJid, admin: null });
        }
    }

    metadata.participants = Array.from(normalizedMap.values());
    metadata.lastSynced = Date.now();
};

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
            lastSeen: new Date(),
            groupMetadata: new Map(),
            groupCacheInitialized: false,
            groupCacheTimestamp: null
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
                if (instance.groupMetadata) {
                    instance.groupMetadata.clear();
                }
                instance.groupCacheInitialized = false;
                instance.groupCacheTimestamp = null;
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

                try {
                    await refreshGroupCache(instanceId);
                    console.log('📚 Cache de grupos inicializado');
                } catch (err) {
                    console.log('⚠️ Não foi possível inicializar cache de grupos:', err.message);
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

        sock.ev.on('groups.update', (updates) => {
            const instance = instances.get(instanceId);
            if (!instance) {
                return;
            }

            const cache = ensureGroupCache(instance);
            const list = Array.isArray(updates) ? updates : [updates];
            const timestamp = Date.now();

            for (const update of list) {
                if (!update || !update.id) {
                    continue;
                }

                try {
                    const groupJid = ensureGroupJid(update.id);
                    const existing = cache.get(groupJid) || { id: groupJid };
                    const merged = { ...existing, ...update };

                    if (update.subject !== undefined) {
                        merged.subject = update.subject;
                    }

                    if (update.desc !== undefined) {
                        merged.desc = update.desc;
                    }

                    merged.lastSynced = timestamp;
                    cache.set(groupJid, merged);
                } catch (err) {
                    console.log('⚠️ Erro ao atualizar metadata do grupo:', err.message);
                }
            }
        });

        sock.ev.on('group-participants.update', async (updates) => {
            const instance = instances.get(instanceId);
            if (!instance) {
                return;
            }

            const cache = ensureGroupCache(instance);
            const list = Array.isArray(updates) ? updates : [updates];

            for (const update of list) {
                if (!update || !update.id || !update.participants || !update.action) {
                    continue;
                }

                try {
                    const groupJid = ensureGroupJid(update.id);
                    let metadata = cache.get(groupJid);

                    if (!metadata) {
                        try {
                            metadata = await instance.sock.groupMetadata(groupJid);
                            metadata.id = groupJid;
                        } catch (err) {
                            metadata = { id: groupJid, participants: [] };
                        }
                    }

                    applyParticipantsChange(metadata, update.participants, update.action);
                    cache.set(groupJid, metadata);
                } catch (err) {
                    console.log('⚠️ Erro ao atualizar participantes do grupo:', err.message);
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
    const {
        to,
        message,
        type = 'text',
        imageData,
        mediaData,
        mediaUrl,
        fileName,
        mimetype,
        location,
        contact,
        poll
    } = req.body;

    if (!to) {
        return res.status(400).json({ error: 'Destinatário inválido' });
    }

    const instance = instances.get(instanceId);
    if (!instance || !instance.connected || !instance.sock) {
        return res.status(400).json({ error: 'Instância não conectada', instanceId: instanceId });
    }

    try {
        const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        const normalizedType = String(type || 'text').toLowerCase();
        const mediaTypes = new Set(['image', 'video', 'audio', 'document', 'sticker']);
        const base64Data = imageData || mediaData || null;

        const sendFollowUpText = async (text) => {
            if (text) {
                await instance.sock.sendMessage(jid, { text });
            }
        };

        if (normalizedType === 'text') {
            if (!message) {
                return res.status(400).json({ error: 'Mensagem de texto vazia' });
            }
            await instance.sock.sendMessage(jid, { text: message });
        } else if (mediaTypes.has(normalizedType)) {
            if (!base64Data && !mediaUrl) {
                return res.status(400).json({ error: 'Missing media data' });
            }

            let payload = {};

            if (normalizedType === 'image') {
                payload = base64Data
                    ? { image: Buffer.from(base64Data, 'base64') }
                    : { image: { url: mediaUrl } };
                if (message) {
                    payload.caption = message;
                }
            } else if (normalizedType === 'video') {
                payload = base64Data
                    ? { video: Buffer.from(base64Data, 'base64') }
                    : { video: { url: mediaUrl } };
                if (message) {
                    payload.caption = message;
                }
            } else if (normalizedType === 'audio') {
                payload = base64Data
                    ? { audio: Buffer.from(base64Data, 'base64'), mimetype: mimetype || 'audio/mpeg' }
                    : { audio: { url: mediaUrl }, mimetype: mimetype || 'audio/mpeg' };
            } else if (normalizedType === 'document') {
                payload = base64Data
                    ? { document: Buffer.from(base64Data, 'base64') }
                    : { document: { url: mediaUrl } };
                payload.fileName = fileName || deriveDocumentFileName(mediaUrl);
                if (mimetype) {
                    payload.mimetype = mimetype;
                }
                if (message) {
                    payload.caption = message;
                }
            } else if (normalizedType === 'sticker') {
                payload = base64Data
                    ? { sticker: Buffer.from(base64Data, 'base64') }
                    : { sticker: { url: mediaUrl } };
            }

            await instance.sock.sendMessage(jid, payload);

            if (message && (normalizedType === 'audio' || normalizedType === 'sticker')) {
                await sendFollowUpText(message);
            }
        } else if (normalizedType === 'location') {
            const locationData = parseStructuredData(location) || parseStructuredData(mediaUrl);
            if (!locationData || typeof locationData.latitude === 'undefined' || typeof locationData.longitude === 'undefined') {
                return res.status(400).json({ error: 'Dados de localização inválidos' });
            }

            const latitude = Number(locationData.latitude);
            const longitude = Number(locationData.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                return res.status(400).json({ error: 'Latitude ou longitude inválidas' });
            }

            const locationPayload = {
                degreesLatitude: latitude,
                degreesLongitude: longitude
            };
            if (locationData.name) {
                locationPayload.name = locationData.name;
            }
            if (locationData.address) {
                locationPayload.address = locationData.address;
            }

            await instance.sock.sendMessage(jid, { location: locationPayload });
            await sendFollowUpText(message);
        } else if (normalizedType === 'contact') {
            const contactData = parseStructuredData(contact) || parseStructuredData(mediaUrl);
            if (!contactData || !contactData.name || !contactData.phone) {
                return res.status(400).json({ error: 'Dados do contato inválidos' });
            }

            const vcard = buildVCard(contactData);
            await instance.sock.sendMessage(jid, {
                contacts: {
                    displayName: contactData.name,
                    contacts: [
                        {
                            displayName: contactData.name,
                            vcard
                        }
                    ]
                }
            });
            await sendFollowUpText(message);
        } else if (normalizedType === 'poll') {
            const pollData = parseStructuredData(poll) || parseStructuredData(mediaUrl);
            if (
                !pollData ||
                !pollData.question ||
                !Array.isArray(pollData.options) ||
                pollData.options.length < 2
            ) {
                return res.status(400).json({ error: 'Dados da enquete inválidos' });
            }

            const selectableCount = pollData.allowMultiple
                ? Math.min(pollData.maxSelections || pollData.options.length, pollData.options.length)
                : 1;

            await instance.sock.sendMessage(jid, {
                poll: {
                    name: pollData.name || pollData.question,
                    values: pollData.options,
                    selectableCount: Math.max(1, selectableCount)
                }
            });
            await sendFollowUpText(message);
        } else {
            return res.status(400).json({ error: `Unsupported message type: ${type}` });
        }

        console.log(`📤 Mensagem enviada da instância ${instanceId} para ${to} (${normalizedType})`);
        res.json({ success: true, instanceId: instanceId });
    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem da instância ${instanceId}:`, error);
        res.status(500).json({ error: error.message, instanceId: instanceId });
    }
});

// Groups endpoint with robust error handling  
app.get('/groups/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const { refresh } = req.query;

    try {
        const instance = getInstanceOrThrow(instanceId);

        if (refresh === 'true') {
            try {
                await refreshGroupCache(instanceId);
            } catch (err) {
                console.log('⚠️ Erro ao atualizar cache de grupos:', err.message);
            }
        } else if (!instance.groupCacheInitialized) {
            try {
                await refreshGroupCache(instanceId);
            } catch (err) {
                console.log('⚠️ Cache de grupos não pôde ser inicializado automaticamente:', err.message);
            }
        }

        const cache = ensureGroupCache(instance);
        let metadataList = Array.from(cache.values());
        let source = 'cache';

        if (metadataList.length === 0) {
            source = 'fallback';
            try {
                const chats = await instance.sock.getChats();
                metadataList = chats
                    .filter((chat) => chat.id && chat.id.endsWith('@g.us'))
                    .map((chat) => ({
                        id: chat.id,
                        subject: chat.name || chat.subject || 'Grupo sem nome',
                        desc: chat.description || '',
                        participants: [],
                        creation: chat.timestamp,
                        lastSynced: Date.now()
                    }));
            } catch (fallbackError) {
                console.log('⚠️ Falha no fallback de grupos:', fallbackError.message);
                metadataList = [];
            }
        }

        const groups = metadataList
            .map((metadata) => serializeGroupMetadata(metadata, instance))
            .filter(Boolean);

        res.json({
            success: true,
            instanceId,
            groups,
            count: groups.length,
            cache: {
                initialized: instance.groupCacheInitialized || false,
                lastSyncedAt: instance.groupCacheTimestamp ? new Date(instance.groupCacheTimestamp).toISOString() : null,
                source
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        const status = error.statusCode || 500;
        console.error(`❌ Erro ao buscar grupos para instância ${instanceId}:`, error.message);
        res.status(status).json({
            success: false,
            error: error.message,
            instanceId,
            groups: []
        });
    }
});

app.post('/groups/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    const { subject, participants = [] } = req.body || {};

    if (!subject || typeof subject !== 'string') {
        return res.status(400).json({ success: false, error: 'Assunto do grupo é obrigatório' });
    }

    const participantList = Array.isArray(participants) ? participants : [participants];
    let normalizedParticipants;

    try {
        normalizedParticipants = Array.from(new Set(participantList.map(ensureParticipantJid)));
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }

    try {
        const instance = getInstanceOrThrow(instanceId);
        const metadata = await instance.sock.groupCreate(subject, normalizedParticipants);
        const groupJid = ensureGroupJid(metadata.id || metadata.gid);

        metadata.id = groupJid;
        metadata.lastSynced = Date.now();

        const cache = ensureGroupCache(instance);
        cache.set(groupJid, metadata);
        instance.groupCacheInitialized = true;
        instance.groupCacheTimestamp = metadata.lastSynced;

        res.json({
            success: true,
            instanceId,
            groupId: groupJid,
            group: serializeGroupMetadata(metadata, instance),
            participantsAdded: normalizedParticipants.length
        });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

app.post('/groups/:instanceId/:groupId/participants', async (req, res) => {
    const { instanceId, groupId } = req.params;
    const { action, participants } = req.body || {};

    const normalizedAction = typeof action === 'string' ? action.toLowerCase() : null;
    if (!normalizedAction || !PARTICIPANT_ACTIONS.has(normalizedAction)) {
        return res.status(400).json({ success: false, error: 'Ação inválida. Use add, remove, promote ou demote.' });
    }

    const participantList = Array.isArray(participants) ? participants : [participants];
    if (!participantList.length) {
        return res.status(400).json({ success: false, error: 'Informe ao menos um participante' });
    }

    let normalizedParticipants;

    try {
        normalizedParticipants = Array.from(new Set(participantList.map(ensureParticipantJid)));
    } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }

    try {
        const { instance, metadata, groupJid } = await ensureAdminPrivileges(instanceId, groupId);
        const result = await instance.sock.groupParticipantsUpdate(groupJid, normalizedParticipants, normalizedAction);

        applyParticipantsChange(metadata, normalizedParticipants, normalizedAction);
        ensureGroupCache(instance).set(groupJid, metadata);
        metadata.lastSynced = Date.now();

        res.json({
            success: true,
            instanceId,
            groupId: groupJid,
            action: normalizedAction,
            result: (result || []).map((item, index) => ({
                jid: item?.jid || normalizedParticipants[index],
                status: item?.status
            })),
            group: serializeGroupMetadata(metadata, instance)
        });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

app.patch('/groups/:instanceId/:groupId/subject', async (req, res) => {
    const { instanceId, groupId } = req.params;
    const { subject } = req.body || {};

    if (!subject || typeof subject !== 'string') {
        return res.status(400).json({ success: false, error: 'Novo assunto é obrigatório' });
    }

    try {
        const { instance, metadata, groupJid } = await ensureAdminPrivileges(instanceId, groupId);
        await instance.sock.groupUpdateSubject(groupJid, subject);

        metadata.subject = subject;
        metadata.lastSynced = Date.now();
        ensureGroupCache(instance).set(groupJid, metadata);

        res.json({
            success: true,
            instanceId,
            groupId: groupJid,
            group: serializeGroupMetadata(metadata, instance)
        });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

app.patch('/groups/:instanceId/:groupId/description', async (req, res) => {
    const { instanceId, groupId } = req.params;
    const { description = '' } = req.body || {};

    try {
        const { instance, metadata, groupJid } = await ensureAdminPrivileges(instanceId, groupId);
        await instance.sock.groupUpdateDescription(groupJid, description);

        metadata.desc = description;
        metadata.description = description;
        metadata.lastSynced = Date.now();
        ensureGroupCache(instance).set(groupJid, metadata);

        res.json({
            success: true,
            instanceId,
            groupId: groupJid,
            group: serializeGroupMetadata(metadata, instance)
        });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

app.patch('/groups/:instanceId/:groupId/settings', async (req, res) => {
    const { instanceId, groupId } = req.params;
    const { setting, announcement, locked } = req.body || {};

    const operations = [];

    if (setting) {
        const normalizedSetting = setting.toLowerCase();
        if (!['announcement', 'not_announcement', 'locked', 'unlocked'].includes(normalizedSetting)) {
            return res.status(400).json({ success: false, error: 'Setting inválido' });
        }
        operations.push(normalizedSetting);
    }

    if (typeof announcement === 'boolean') {
        operations.push(announcement ? 'announcement' : 'not_announcement');
    }

    if (typeof locked === 'boolean') {
        operations.push(locked ? 'locked' : 'unlocked');
    }

    if (!operations.length) {
        return res.status(400).json({ success: false, error: 'Nenhuma alteração informada' });
    }

    try {
        const { instance, metadata, groupJid } = await ensureAdminPrivileges(instanceId, groupId);
        const applied = [];

        for (const op of operations) {
            await instance.sock.groupSettingUpdate(groupJid, op);
            applied.push(op);

            if (op === 'announcement') {
                metadata.announce = 'true';
            } else if (op === 'not_announcement') {
                metadata.announce = 'false';
            } else if (op === 'locked') {
                metadata.restrict = 'true';
            } else if (op === 'unlocked') {
                metadata.restrict = 'false';
            }
        }

        metadata.lastSynced = Date.now();
        ensureGroupCache(instance).set(groupJid, metadata);

        res.json({
            success: true,
            instanceId,
            groupId: groupJid,
            applied,
            group: serializeGroupMetadata(metadata, instance)
        });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

app.post('/groups/:instanceId/:groupId/leave', async (req, res) => {
    const { instanceId, groupId } = req.params;

    try {
        const { instance, metadata, groupJid } = await getGroupMetadataFromCache(instanceId, groupId);
        await instance.sock.groupLeave(groupJid);

        ensureGroupCache(instance).delete(groupJid);
        metadata.leftAt = new Date().toISOString();

        res.json({
            success: true,
            instanceId,
            groupId: groupJid,
            message: 'Instância removida do grupo com sucesso'
        });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

app.get('/groups/:instanceId/:groupId/invite-code', async (req, res) => {
    const { instanceId, groupId } = req.params;

    try {
        const { instance, metadata, groupJid } = await ensureAdminPrivileges(instanceId, groupId);
        const code = await instance.sock.groupInviteCode(groupJid);

        metadata.inviteCode = code;
        metadata.lastSynced = Date.now();
        ensureGroupCache(instance).set(groupJid, metadata);

        res.json({
            success: true,
            instanceId,
            groupId: groupJid,
            code,
            group: serializeGroupMetadata(metadata, instance)
        });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({ success: false, error: error.message });
    }
});

app.post('/groups/:instanceId/:groupId/revoke-invite', async (req, res) => {
    const { instanceId, groupId } = req.params;

    try {
        const { instance, metadata, groupJid } = await ensureAdminPrivileges(instanceId, groupId);
        const newCode = await instance.sock.groupRevokeInvite(groupJid);

        metadata.inviteCode = newCode;
        metadata.lastSynced = Date.now();
        ensureGroupCache(instance).set(groupJid, metadata);

        res.json({
            success: true,
            instanceId,
            groupId: groupJid,
            code: newCode,
            group: serializeGroupMetadata(metadata, instance)
        });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({ success: false, error: error.message });
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