const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const { DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const makeWASocket = require('@whiskeysockets/baileys').default;
const qrTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
 codex/migrate-server-routes-to-node.js
require('dotenv').config({ path: path.join(__dirname, '.env') });


const app = express();

// Allow requests from any origin
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['*'],
    allowedHeaders: ['*']
}));
app.use(express.json());

// MongoDB connection
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'whatsflow';
const mongoClient = new MongoClient(mongoUrl, { useUnifiedTopology: true });
let db;
(async () => {
    try {
        await mongoClient.connect();
        db = mongoClient.db(dbName);
        console.log('🗄️ Connected to MongoDB');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err.message);
    }
})();

// API Router
const apiRouter = express.Router();
app.use('/api', apiRouter);

// Global state management
let instances = new Map(); // instanceId -> { sock, qr, connected, connecting, user }
let currentQR = null;
let qrUpdateInterval = null;

// Database helper functions
async function getOrCreateContact(phoneNumber, name = null, deviceId = 'whatsapp_1', deviceName = 'WhatsApp 1') {
    if (!db) return null;
    const contacts = db.collection('contacts');
    const contact = await contacts.findOne({ phone_number: phoneNumber, device_id: deviceId });
    if (contact) {
        await contacts.updateOne({ phone_number: phoneNumber, device_id: deviceId }, { $set: { last_message_at: new Date() } });
        contact.id = contact._id ? contact._id.toString() : contact.id;
        delete contact._id;
        return contact;
    }
    const contactData = {
        phone_number: phoneNumber,
        name: name || `Contact ${phoneNumber.slice(-4)}`,
        device_id: deviceId,
        device_name: deviceName,
        created_at: new Date(),
        last_message_at: new Date(),
        tags: [],
        is_active: true
    };
    const result = await contacts.insertOne(contactData);
    contactData.id = result.insertedId.toString();
    return contactData;
}

async function saveMessage({ contact_id, phone_number, message, direction, device_id = 'whatsapp_1', device_name = 'WhatsApp 1', message_id = null }) {
    if (!db) return;
    const messages = db.collection('messages');
    const messageData = {
        contact_id,
        phone_number,
        device_id,
        device_name,
        message,
        direction,
        timestamp: new Date(),
        message_id,
        delivered: false,
        read: false
    };
    await messages.insertOne(messageData);
    return messageData;
}

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

 codex/migrate-server-routes-to-node.js
                // Update database about disconnection
                try {
                    if (db) {
                        await db.collection('whatsapp_instances').updateOne(
                            { id: instanceId },
                            {
                                $set: {
                                    connected: false,
                                    user: null,
                                    last_connected_at: new Date(),
                                    reason: reason
                                }
                            },
                            { upsert: true }
                        );
                    }
                } catch (err) {
                    console.log('⚠️ Falha ao atualizar desconexão no banco:', err.message);

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
 codex/migrate-server-routes-to-node.js
                        // Placeholder for future chat import handling if needed

                    } catch (err) {
                        console.log('⚠️ Erro ao importar conversas:', err.message);
                    }
                }, 5000); // Wait 5 seconds after connection

 codex/migrate-server-routes-to-node.js
                // Update instance status in database
                try {
                    if (db) {
                        await db.collection('whatsapp_instances').updateOne(
                            { id: instanceId },
                            {
                                $set: {
                                    connected: true,
                                    user: instance.user,
                                    last_connected_at: new Date()
                                }
                            },
                            { upsert: true }
                        );

                    }
                } catch (err) {
                    console.log('⚠️ Erro ao atualizar status da instância:', err.message);
                }

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

 codex/migrate-server-routes-to-node.js
                    // Save contact and message directly to database
                    try {
                        const contact = await getOrCreateContact(
                            from.split('@')[0],
                            contactName,
                            instanceId,
                            instance.user?.name || 'WhatsApp'
                        );
                        await saveMessage({
                            contact_id: contact.id,
                            phone_number: from.split('@')[0],
                            message: messageText,
                            direction: 'incoming',
                            device_id: instanceId,
                            device_name: instance.user?.name || 'WhatsApp',
                            message_id: message.key.id
                        });
                    } catch (err) {
                        console.log('❌ Erro ao salvar mensagem no banco:', err.message);

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
                instance.sock.sendPresenceUpdate('available').catch(() => { });
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
    const { to, message, type = 'text' } = req.body;

    const instance = instances.get(instanceId);
    if (!instance || !instance.connected || !instance.sock) {
        return res.status(400).json({ error: 'Instância não conectada', instanceId: instanceId });
    }

    try {
        const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

        if (type === 'text') {
            await instance.sock.sendMessage(jid, { text: message });
        } else if (type === 'image' && req.body.imageData) {
            // Handle image sending (base64)
            const buffer = Buffer.from(req.body.imageData, 'base64');
            await instance.sock.sendMessage(jid, {
                image: buffer,
                caption: message || ''
            });
        }

        try {
            const contact = await getOrCreateContact(
                to,
                null,
                instanceId,
                instance.user?.name || 'WhatsApp'
            );
            await saveMessage({
                contact_id: contact.id,
                phone_number: to,
                message: message,
                direction: 'outgoing',
                device_id: instanceId,
                device_name: instance.user?.name || 'WhatsApp'
            });
        } catch (err) {
            console.log('⚠️ Erro ao salvar mensagem enviada:', err.message);
        }

        console.log(`📤 Mensagem enviada da instância ${instanceId} para ${to}`);
        res.json({ success: true, instanceId: instanceId });
    } catch (error) {
        console.error(`❌ Erro ao enviar mensagem da instância ${instanceId}:`, error);
        res.status(500).json({ error: error.message, instanceId: instanceId });
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

// -----------------------
// REST API Routes (previously in Python backend)
// -----------------------

// Contacts
apiRouter.get('/contacts', async (req, res) => {
    try {
        const contacts = await db.collection('contacts').find().toArray();
        const result = contacts.map(c => {
            c.id = c._id.toString();
            delete c._id;
            return c;
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get('/contacts/:contactId/messages', async (req, res) => {
    const { contactId } = req.params;
    try {
        const messages = await db.collection('messages').find({ contact_id: contactId }).sort({ timestamp: 1 }).toArray();
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// WhatsApp Instances
apiRouter.get('/whatsapp/instances', async (req, res) => {
    try {
        const instancesDb = await db.collection('whatsapp_instances').find().toArray();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const inst of instancesDb) {
            inst.id = inst.id || inst._id?.toString();
            if (inst._id) delete inst._id;
            inst.contacts_count = await db.collection('contacts').countDocuments({ device_id: inst.device_id });
            inst.messages_today = await db.collection('messages').countDocuments({ device_id: inst.device_id, timestamp: { $gte: today } });
        }
        res.json(instancesDb);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.post('/whatsapp/instances', async (req, res) => {
    try {
        const { name, device_name } = req.body;
        const device_id = `whatsapp_${Math.random().toString(36).substring(2, 10)}`;
        const instance = {
            id: undefined,
            name,
            device_id,
            device_name: device_name || name,
            connected: false,
            created_at: new Date()
        };
        const result = await db.collection('whatsapp_instances').insertOne(instance);
        instance.id = result.insertedId.toString();
        res.json({ success: true, instance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.post('/whatsapp/instances/:instanceId/disconnect', async (req, res) => {
    const { instanceId } = req.params;
    try {
        const result = await db.collection('whatsapp_instances').updateOne(
            { id: instanceId },
            { $set: { connected: false, user: null, last_connected_at: new Date() } }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.delete('/whatsapp/instances/:instanceId', async (req, res) => {
    const { instanceId } = req.params;
    try {
        const result = await db.collection('whatsapp_instances').deleteOne({ id: instanceId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Webhooks
apiRouter.get('/webhooks', async (req, res) => {
    try {
        const webhooks = await db.collection('webhooks').find({ active: true }).toArray();
        webhooks.forEach(w => { w.id = w._id.toString(); delete w._id; });
        res.json(webhooks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.post('/webhooks', async (req, res) => {
    try {
        const { name, url, description = '' } = req.body;
        const webhook = {
            name,
            url,
            description,
            created_at: new Date(),
            active: true
        };
        const result = await db.collection('webhooks').insertOne(webhook);
        webhook.id = result.insertedId.toString();
        res.json(webhook);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.delete('/webhooks/:webhookId', async (req, res) => {
    const { webhookId } = req.params;
    try {
        const result = await db.collection('webhooks').updateOne({ _id: new ObjectId(webhookId) }, { $set: { active: false } });
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Webhook not found' });
        }
        res.json({ message: 'Webhook deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.post('/webhooks/trigger', async (req, res) => {
    const { webhook_url, data } = req.body;
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        res.json({ message: 'Webhook triggered', status: response.status });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Service rodando na porta ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log('⏳ Aguardando comandos para conectar instâncias...');
});