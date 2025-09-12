const EventEmitter = require('events');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const events = new EventEmitter();

// Open connection to existing database
const dbPath = path.join(__dirname, '..', 'whatsflow.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Erro ao conectar ao banco:', err.message);
    } else {
        console.log('📦 Banco conectado em', dbPath);
    }
});

function notifyDisconnection(instanceId, reason) {
    db.run('UPDATE instances SET connected = 0 WHERE id = ?', [instanceId], (err) => {
        if (err) {
            console.error('⚠️ Erro ao atualizar instância desconectada:', err.message);
        }
    });
    events.emit('whatsapp:disconnected', { instanceId, reason });
}

function importChatsBatch(instanceId, chats, user, batchNumber, totalBatches) {
    if (!Array.isArray(chats)) return;
    const stmt = db.prepare(`INSERT OR REPLACE INTO chats (id, contact_phone, contact_name, instance_id, last_message, last_message_time, unread_count, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const chat of chats) {
        const phone = (chat.id || '').split('@')[0];
        const name = chat.name || chat.subject || phone;
        stmt.run(
            chat.id,
            phone,
            name,
            instanceId,
            chat.lastMessage?.message || '',
            chat.lastMessage?.timestamp || new Date().toISOString(),
            chat.unreadCount || 0,
            new Date().toISOString()
        );
    }
    stmt.finalize();
    events.emit('chats:import', { instanceId, batchNumber, totalBatches });
}

function notifyConnected(instanceId, user, connectedAt) {
    const name = user?.name || instanceId;
    const userId = user?.id || null;
    db.run(`INSERT OR REPLACE INTO instances (id, name, connected, contacts_count, messages_today, created_at, user_name, user_id)
            VALUES (?, ?, 1, COALESCE((SELECT contacts_count FROM instances WHERE id = ?), 0), COALESCE((SELECT messages_today FROM instances WHERE id = ?), 0), COALESCE((SELECT created_at FROM instances WHERE id = ?), ?), ?, ?)`,
        [instanceId, name, instanceId, instanceId, instanceId, connectedAt, user?.name || null, userId],
        (err) => {
            if (err) {
                console.error('⚠️ Erro ao salvar instância conectada:', err.message);
            }
        }
    );
    events.emit('whatsapp:connected', { instanceId, user, connectedAt });
}

function handleIncomingMessage(data) {
    const { instanceId, from, message, pushName, contactName, timestamp, messageId, messageType } = data;
    const phone = from.split('@')[0];
    db.run(`INSERT OR REPLACE INTO messages (id, contact_name, phone, message, direction, instance_id, message_type, whatsapp_id, created_at)
            VALUES (?, ?, ?, ?, 'in', ?, ?, ?, ?)`,
        [messageId, contactName || phone, phone, message, instanceId, messageType, messageId, timestamp],
        (err) => {
            if (err) {
                console.error('⚠️ Erro ao salvar mensagem:', err.message);
            }
        }
    );
    events.emit('messages:receive', data);
}

module.exports = {
    events,
    notifyDisconnection,
    importChatsBatch,
    notifyConnected,
    handleIncomingMessage
};
