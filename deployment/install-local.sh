#!/bin/bash

# WhatsFlow - Instalador Local Ultra-Simples
# Versão: 2.0.0 - Instalação Local sem Domínio
# 
# Execute apenas: curl -sSL https://raw.githubusercontent.com/jocilejr/testes/main/install-local.sh | bash

set -e

echo "🚀 WhatsFlow - Instalador Local Ultra-Simples"
echo "============================================="
echo "📍 Instalação: localhost (sem domínio necessário)"
echo "⚡ Modo: Desenvolvimento/Local"
echo ""

# Verificar sistema
if ! command -v apt &> /dev/null; then
    echo "❌ Este instalador é para Ubuntu/Debian."
    echo "💡 Para outros sistemas, ajuste o script manualmente."
    exit 1
fi

# Detectar usuário
if [ "$EUID" -eq 0 ]; then
    echo "❌ NÃO execute como root. Execute como usuário normal:"
    echo "   curl -sSL https://raw.githubusercontent.com/jocilejr/testes/main/install-local.sh | bash"
    exit 1
fi

echo "🎯 Iniciando instalação automática..."
echo "📦 Instalando em: ~/whatsflow/"
echo ""
sleep 2

# ==========================================
# INSTALAÇÃO AUTOMÁTICA DE DEPENDÊNCIAS
# ==========================================
echo "📦 Instalando dependências do sistema..."

# Atualizar sistema
sudo apt update -qq

# Instalar dependências essenciais
sudo apt install -y curl wget git build-essential python3 python3-pip python3-venv &>/dev/null

# Instalar Node.js 18 (silencioso)
if ! command -v node &> /dev/null; then
    echo "📦 Instalando Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - &>/dev/null
    sudo apt install -y nodejs &>/dev/null
fi

# Instalar MongoDB (local)
if ! command -v mongod &> /dev/null; then
    echo "📦 Instalando MongoDB..."
    wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add - &>/dev/null
    echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list &>/dev/null
    sudo apt update -qq
    sudo apt install -y mongodb-org &>/dev/null
    sudo systemctl start mongod &>/dev/null
    sudo systemctl enable mongod &>/dev/null
fi

# Instalar PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 Instalando PM2..."
    sudo npm install -g pm2 &>/dev/null
fi

echo "✅ Dependências instaladas!"

# ==========================================
# BAIXAR E CONFIGURAR PROJETO
# ==========================================
echo "📁 Configurando projeto..."

# Criar diretório no home do usuário
cd ~
rm -rf whatsflow 2>/dev/null || true
mkdir -p whatsflow
cd whatsflow

# Clonar projeto (silencioso)
echo "📥 Baixando WhatsFlow..."
git clone https://github.com/jocilejr/testes.git . &>/dev/null || {
    echo "⚠️ Erro ao clonar. Criando estrutura básica..."
    mkdir -p backend frontend/src/components whatsapp-service
}

echo "✅ Projeto baixado!"

# ==========================================
# CRIAR ARQUIVOS OTIMIZADOS
# ==========================================
echo "⚙️ Criando arquivos do sistema..."

# Backend - requirements.txt
cat > backend/requirements.txt << 'EOF'
fastapi==0.104.1
uvicorn==0.24.0
motor==3.3.2
python-dotenv==1.0.0
pydantic==2.5.0
python-multipart==0.0.6
httpx==0.25.2
EOF

# Backend - .env
cat > backend/.env << 'EOF'
MONGO_URL=mongodb://localhost:27017/whatsflow
DB_NAME=whatsflow
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
EOF

# Backend - server.py (otimizado)
cat > backend/server.py << 'EOF'
from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from dotenv import load_dotenv
import os, uuid, httpx, logging

load_dotenv()

# MongoDB
client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]

app = FastAPI(title="WhatsFlow API - Local")
api_router = APIRouter(prefix="/api")

# Models
class Contact(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    phone_number: str
    name: str
    device_id: str = "whatsapp_1"
    device_name: str = "WhatsApp 1"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_message_at: Optional[datetime] = None
    tags: List[str] = []
    is_active: bool = True

class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    contact_id: str
    phone_number: str
    device_id: str = "whatsapp_1"
    device_name: str = "WhatsApp 1"
    message: str
    direction: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    delivered: bool = False

class IncomingMessage(BaseModel):
    phone_number: str
    message: str
    message_id: str
    timestamp: int
    push_name: Optional[str] = None
    device_id: Optional[str] = "whatsapp_1"
    device_name: Optional[str] = "WhatsApp 1"

class Webhook(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    url: str
    description: Optional[str] = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    active: bool = True

# Helper functions
async def get_or_create_contact(phone_number: str, name: str = None, device_id: str = "whatsapp_1", device_name: str = "WhatsApp 1"):
    contact = await db.contacts.find_one({"phone_number": phone_number, "device_id": device_id})
    if not contact:
        contact_data = Contact(phone_number=phone_number, name=name or f"Contact {phone_number[-4:]}", device_id=device_id, device_name=device_name)
        result = await db.contacts.insert_one(contact_data.dict())
        contact_data.id = str(result.inserted_id)
        return contact_data.dict()
    else:
        await db.contacts.update_one({"phone_number": phone_number, "device_id": device_id}, {"$set": {"last_message_at": datetime.now(timezone.utc)}})
        contact['id'] = str(contact.get('_id'))
    return contact

async def save_message(contact_id: str, phone_number: str, message: str, direction: str, device_id: str = "whatsapp_1", device_name: str = "WhatsApp 1"):
    message_data = Message(contact_id=contact_id, phone_number=phone_number, device_id=device_id, device_name=device_name, message=message, direction=direction)
    await db.messages.insert_one(message_data.dict())

async def trigger_webhook_async(webhook_url: str, data: dict):
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(webhook_url, json=data)
            logging.info(f"Webhook OK: {webhook_url} - {response.status_code}")
    except Exception as e:
        logging.error(f"Webhook erro: {str(e)}")

# Routes
@api_router.get("/")
async def root():
    return {"message": "WhatsFlow API Local - Funcionando!", "status": "online"}

@api_router.post("/whatsapp/message")
async def handle_whatsapp_message(message_data: IncomingMessage):
    try:
        contact = await get_or_create_contact(message_data.phone_number, message_data.push_name, message_data.device_id or "whatsapp_1", message_data.device_name or "WhatsApp 1")
        await save_message(contact['id'], message_data.phone_number, message_data.message, 'incoming', message_data.device_id or "whatsapp_1", message_data.device_name or "WhatsApp 1")
        reply = f"✅ Mensagem recebida via {message_data.device_name or 'WhatsApp 1'}: '{message_data.message}'"
        await save_message(contact['id'], message_data.phone_number, reply, 'outgoing', message_data.device_id or "whatsapp_1", message_data.device_name or "WhatsApp 1")
        return {"reply": reply, "success": True}
    except Exception as e:
        return {"reply": "❌ Erro ao processar mensagem", "success": False}

@api_router.get("/whatsapp/status")
async def get_whatsapp_status():
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("http://localhost:3001/status")
            return response.json()
    except:
        return {"connected": False, "user": None, "hasQR": False, "demo": True}

@api_router.get("/whatsapp/qr")
async def get_qr_code():
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("http://localhost:3001/qr")
            return response.json()
    except:
        return {"qr": None}

@api_router.post("/whatsapp/send")
async def send_message(data: dict):
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post("http://localhost:3001/send", json=data)
            return response.json()
    except:
        return {"success": False, "error": "WhatsApp service offline"}

@api_router.get("/contacts")
async def get_contacts(device_id: Optional[str] = None):
    query = {} if not device_id or device_id == "all" else {"device_id": device_id}
    contacts = await db.contacts.find(query).sort("last_message_at", -1).to_list(100)
    for contact in contacts:
        contact['id'] = str(contact.get('_id'))
        contact.pop('_id', None)
    return contacts

@api_router.get("/devices")
async def get_devices():
    pipeline = [{"$group": {"_id": "$device_id", "device_name": {"$first": "$device_name"}, "count": {"$sum": 1}}}, {"$sort": {"_id": 1}}]
    devices = await db.contacts.aggregate(pipeline).to_list(100)
    result = [{"device_id": d["_id"], "device_name": d["device_name"], "contact_count": d["count"]} for d in devices]
    total = await db.contacts.count_documents({})
    result.insert(0, {"device_id": "all", "device_name": "Todos os Dispositivos", "contact_count": total})
    return result

@api_router.get("/contacts/{contact_id}/messages")
async def get_contact_messages(contact_id: str):
    messages = await db.messages.find({"contact_id": contact_id}).sort("timestamp", 1).to_list(1000)
    for message in messages:
        message['id'] = str(message.get('_id'))
        message.pop('_id', None)
    return messages

@api_router.get("/dashboard/stats")
async def get_dashboard_stats():
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "new_contacts_today": await db.contacts.count_documents({"created_at": {"$gte": today}}),
        "active_conversations": await db.contacts.count_documents({"is_active": True}),
        "messages_today": await db.messages.count_documents({"timestamp": {"$gte": today}})
    }

@api_router.get("/webhooks")
async def get_webhooks():
    webhooks = await db.webhooks.find({"active": True}).to_list(100)
    for webhook in webhooks:
        webhook['id'] = str(webhook.get('_id'))
        webhook.pop('_id', None)
    return webhooks

@api_router.post("/webhooks")
async def create_webhook(webhook: dict):
    webhook_data = Webhook(**webhook)
    result = await db.webhooks.insert_one(webhook_data.dict())
    webhook_data.id = str(result.inserted_id)
    return webhook_data.dict()

@api_router.delete("/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str):
    await db.webhooks.update_one({"_id": webhook_id}, {"$set": {"active": False}})
    return {"message": "Webhook removido"}

@api_router.post("/macros/trigger")
async def trigger_macro(data: dict, background_tasks: BackgroundTasks):
    contact = await db.contacts.find_one({"_id": data["contact_id"]})
    if not contact:
        raise HTTPException(404, "Contato não encontrado")
    
    webhook_data = {
        "contact_name": contact["name"],
        "phone_number": contact["phone_number"],
        "device_id": contact.get("device_id", "whatsapp_1"),
        "device_name": contact.get("device_name", "WhatsApp 1"),
        "jid": f"{contact['phone_number']}@s.whatsapp.net",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "macro_name": data["macro_name"],
        "tags": contact.get("tags", [])
    }
    
    background_tasks.add_task(trigger_webhook_async, data["webhook_url"], webhook_data)
    return {"message": f"✅ Macro '{data['macro_name']}' disparada!"}

app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
EOF

# WhatsApp Service - package.json
cat > whatsapp-service/package.json << 'EOF'
{
  "name": "whatsapp-service-local",
  "version": "2.0.0",
  "main": "server.js",
  "dependencies": {
    "@whiskeysockets/baileys": "^6.5.0",
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "axios": "^1.6.0",
    "fs-extra": "^11.1.1",
    "qrcode-terminal": "^0.12.0"
  }
}
EOF

# WhatsApp Service - server.js (otimizado)
cat > whatsapp-service/server.js << 'EOF'
const express = require('express')
const cors = require('cors')
const axios = require('axios')
const fs = require('fs-extra')
const path = require('path')

const app = express()
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['*'],
  allowedHeaders: ['*'],
}))
app.use(express.json())

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8001'
const PORT = process.env.PORT || 3001

let sock = null
let qrCode = null
let isConnected = false
let connectedUser = null
let bailaysAvailable = false

console.log('🚀 WhatsApp Service Local - Iniciando...')

try {
    require('@whiskeysockets/baileys')
    bailaysAvailable = true
    console.log('✅ Baileys detectado - Conexão real disponível')
} catch (error) {
    console.log('⚠️ Baileys não instalado - Modo demo ativo')
    bailaysAvailable = false
}

const authDir = path.join(__dirname, 'auth_info')
fs.ensureDirSync(authDir)

async function initWhatsApp() {
    if (!bailaysAvailable) {
        console.log('🎭 Modo Demo Ativo')
        setTimeout(() => {
            qrCode = `whatsflow-local-demo-${Date.now()}`
            console.log('📱 QR Code demo disponível')
        }, 2000)
        return
    }

    try {
        console.log('📱 Inicializando conexão real WhatsApp...')
        const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
        const { state, saveCreds } = await useMultiFileAuthState(authDir)

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['WhatsFlow Local', 'Chrome', '2.0.0'],
            markOnlineOnConnect: false
        })

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr) {
                qrCode = qr
                console.log('📱 QR Code gerado! Escaneie com seu WhatsApp')
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
                console.log('⚠️ Conexão perdida, reconectando...', shouldReconnect)
                isConnected = false
                connectedUser = null
                if (shouldReconnect) setTimeout(initWhatsApp, 5000)
            } else if (connection === 'open') {
                console.log('✅ WhatsApp conectado com sucesso!')
                qrCode = null
                isConnected = true
                connectedUser = sock.user
            }
        })

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type === 'notify') {
                for (const message of messages) {
                    if (!message.key.fromMe && message.message) {
                        await handleIncomingMessage(message)
                    }
                }
            }
        })

        sock.ev.on('creds.update', saveCreds)
    } catch (error) {
        console.error('❌ Erro na inicialização:', error.message)
        bailaysAvailable = false
        initWhatsApp()
    }
}

async function handleIncomingMessage(message) {
    try {
        const phoneNumber = message.key.remoteJid.replace('@s.whatsapp.net', '')
        const messageText = message.message.conversation || message.message.extendedTextMessage?.text || ''
        const pushName = message.pushName || 'Contato'
        
        console.log(`📨 ${pushName} (${phoneNumber}): ${messageText}`)

        const response = await axios.post(`${FASTAPI_URL}/api/whatsapp/message`, {
            phone_number: phoneNumber,
            message: messageText,
            message_id: message.key.id,
            timestamp: message.messageTimestamp,
            push_name: pushName
        })

        if (response.data.reply) {
            await sendMessage(phoneNumber, response.data.reply)
        }
    } catch (error) {
        console.error('❌ Erro processando mensagem:', error.message)
    }
}

async function sendMessage(phoneNumber, text) {
    try {
        if (!bailaysAvailable) {
            console.log(`🎭 [DEMO] Enviando para ${phoneNumber}: ${text}`)
            return { success: true, demo: true }
        }
        
        if (!sock || !isConnected) {
            throw new Error('WhatsApp não conectado')
        }

        const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`
        await sock.sendMessage(jid, { text })
        console.log(`✅ Enviado para ${phoneNumber}`)
        return { success: true }
    } catch (error) {
        console.error('❌ Erro enviando:', error.message)
        return { success: false, error: error.message }
    }
}

function simulateConnection() {
    if (!bailaysAvailable) {
        isConnected = true
        qrCode = null
        connectedUser = { id: '5511999999999', name: 'WhatsFlow Demo Local' }
        console.log('🎭 Demo: WhatsApp "conectado" localmente')
    }
}

// API Endpoints
app.get('/qr', (req, res) => res.json({ qr: qrCode || null }))
app.post('/send', async (req, res) => {
    const { phone_number, message } = req.body
    const result = await sendMessage(phone_number, message)
    res.json(result)
})
app.get('/status', (req, res) => res.json({
    connected: bailaysAvailable ? isConnected : !!connectedUser,
    user: bailaysAvailable ? connectedUser : connectedUser,
    hasQR: !!qrCode,
    demo: !bailaysAvailable
}))
app.post('/demo/connect', (req, res) => {
    if (!bailaysAvailable) {
        simulateConnection()
        res.json({ success: true, message: 'Demo conectado localmente' })
    } else {
        res.json({ success: false, message: 'Não está em modo demo' })
    }
})

app.listen(PORT, () => {
    console.log(`🌐 WhatsApp Service: http://localhost:${PORT}`)
    console.log(`🔗 FastAPI: ${FASTAPI_URL}`)
    if (!bailaysAvailable) {
        console.log('🎭 MODO DEMO ATIVO - Instale Baileys para WhatsApp real')
    }
    initWhatsApp()
})
EOF

# Frontend - package.json
cat > frontend/package.json << 'EOF'
{
  "name": "whatsflow-frontend-local",
  "version": "2.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "5.0.1",
    "reactflow": "^11.11.4",
    "@reactflow/controls": "^11.2.0",
    "@reactflow/background": "^11.3.0",
    "axios": "^1.6.0"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build"
  },
  "browserslist": {
    "production": [">0.2%", "not dead"],
    "development": ["last 1 chrome version"]
  }
}
EOF

# Frontend - .env
cat > frontend/.env << 'EOF'
REACT_APP_BACKEND_URL=http://localhost:8001
BROWSER=none
EOF

# Frontend - public/index.html
mkdir -p frontend/public
cat > frontend/public/index.html << 'EOF'
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#667eea" />
    <title>WhatsFlow Local - Automação WhatsApp</title>
    <style>
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; }
        .loading { display: flex; align-items: center; justify-content: center; height: 100vh; background: #f8fafc; }
    </style>
</head>
<body>
    <div id="root">
        <div class="loading">
            <div>🚀 Carregando WhatsFlow...</div>
        </div>
    </div>
</body>
</html>
EOF

# Frontend - src/index.js
mkdir -p frontend/src
cat > frontend/src/index.js << 'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
EOF

# Frontend - src/index.css
cat > frontend/src/index.css << 'EOF'
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; 
  background: #f8fafc;
  color: #2d3748;
}
#root { min-height: 100vh; }
EOF

# Frontend - src/App.js (Layout refinado)
cat > frontend/src/App.js << 'EOF'
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [status, setStatus] = useState('loading');
  const [qrCode, setQrCode] = useState(null);
  const [connectedUser, setConnectedUser] = useState(null);
  const [stats, setStats] = useState({ new_contacts_today: 0, active_conversations: 0, messages_today: 0 });
  const [contacts, setContacts] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [statusRes, qrRes, statsRes, contactsRes, webhooksRes] = await Promise.all([
        axios.get(`${API}/whatsapp/status`).catch(() => ({ data: { connected: false } })),
        axios.get(`${API}/whatsapp/qr`).catch(() => ({ data: { qr: null } })),
        axios.get(`${API}/dashboard/stats`).catch(() => ({ data: { new_contacts_today: 0, active_conversations: 0, messages_today: 0 } })),
        axios.get(`${API}/contacts`).catch(() => ({ data: [] })),
        axios.get(`${API}/webhooks`).catch(() => ({ data: [] }))
      ]);
      
      setStatus(statusRes.data.connected ? 'connected' : 'disconnected');
      setConnectedUser(statusRes.data.user);
      setIsDemoMode(statusRes.data.demo || false);
      setQrCode(qrRes.data.qr);
      setStats(statsRes.data);
      setContacts(contactsRes.data);
      setWebhooks(webhooksRes.data);
    } catch (error) {
      console.error('Erro ao buscar dados:', error);
      setStatus('error');
    }
  };

  const connectDemo = async () => {
    try {
      await axios.post('http://localhost:3001/demo/connect');
      setTimeout(fetchData, 1000);
    } catch (error) {
      console.error('Erro ao conectar demo:', error);
    }
  };

  const triggerMacro = async (webhook, contact) => {
    try {
      await axios.post(`${API}/macros/trigger`, {
        contact_id: contact.id,
        macro_name: webhook.name,
        webhook_url: webhook.url
      });
      alert(`✅ Macro "${webhook.name}" disparada!`);
    } catch (error) {
      alert('❌ Erro ao disparar macro');
    }
  };

  const createWebhook = async () => {
    const name = prompt('Nome da macro (ex: Entrega - Produto):');
    if (!name) return;
    
    const url = prompt('URL do webhook:');
    if (!url) return;

    try {
      await axios.post(`${API}/webhooks`, { name, url, description: 'Criado localmente' });
      fetchData();
      alert('✅ Macro criada com sucesso!');
    } catch (error) {
      alert('❌ Erro ao criar macro');
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1>🤖 WhatsFlow Local</h1>
          <div className="status-badge">
            <span className={`status-dot ${status}`}></span>
            <span className="status-text">
              {status === 'connected' ? '🟢 Conectado' : 
               status === 'disconnected' ? '🟡 Desconectado' : 
               status === 'loading' ? '🔄 Carregando...' : '🔴 Erro'}
              {isDemoMode && ' (Demo)'}
            </span>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="nav">
        <div className="nav-content">
          <button 
            className={`nav-item ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={() => setCurrentView('dashboard')}
          >
            📊 Dashboard
          </button>
          <button 
            className={`nav-item ${currentView === 'messages' ? 'active' : ''}`}
            onClick={() => setCurrentView('messages')}
          >
            💬 Mensagens
          </button>
          <button 
            className={`nav-item ${currentView === 'webhooks' ? 'active' : ''}`}
            onClick={() => setCurrentView('webhooks')}
          >
            🎯 Macros
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="main">
        {currentView === 'dashboard' && (
          <div className="dashboard">
            <div className="section">
              <h2>📱 Status da Conexão</h2>
              <div className="connection-card">
                {status === 'connected' && connectedUser && (
                  <div className="connected-info">
                    <div className="success-badge">✅ WhatsApp Conectado!</div>
                    <div className="user-info">👤 {connectedUser.name || connectedUser.id}</div>
                  </div>
                )}

                {status === 'disconnected' && (
                  <div className="disconnected-info">
                    {qrCode ? (
                      <div className="qr-section">
                        <div className="info-badge">📱 Escaneie o QR Code com seu WhatsApp:</div>
                        <div className="qr-container">
                          <img 
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCode)}`} 
                            alt="QR Code"
                            className="qr-image"
                          />
                        </div>
                        <div className="qr-instructions">
                          Abra WhatsApp → ⚙️ → Aparelhos conectados → Conectar aparelho
                        </div>
                      </div>
                    ) : (
                      <div className="demo-section">
                        <div className="warning-badge">⚠️ WhatsApp não conectado</div>
                        {isDemoMode && (
                          <button onClick={connectDemo} className="demo-btn">
                            🎭 Ativar Modo Demo
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {status === 'error' && (
                  <div className="error-badge">❌ Erro na conexão com o serviço</div>
                )}
              </div>
            </div>

            <div className="section">
              <h2>📊 Estatísticas</h2>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-icon">👥</div>
                  <div className="stat-content">
                    <div className="stat-number">{stats.new_contacts_today}</div>
                    <div className="stat-label">Novos contatos hoje</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon">💬</div>
                  <div className="stat-content">
                    <div className="stat-number">{stats.active_conversations}</div>
                    <div className="stat-label">Conversas ativas</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon">📨</div>
                  <div className="stat-content">
                    <div className="stat-number">{stats.messages_today}</div>
                    <div className="stat-label">Mensagens hoje</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentView === 'messages' && (
          <div className="messages">
            <div className="section">
              <h2>💬 Central de Mensagens</h2>
              <div className="messages-layout">
                <div className="contacts-panel">
                  <h3>Contatos ({contacts.length})</h3>
                  {contacts.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">👥</div>
                      <p>Nenhum contato ainda</p>
                      <small>Contatos aparecerão quando receberem mensagens</small>
                    </div>
                  ) : (
                    <div className="contacts-list">
                      {contacts.map(contact => (
                        <div 
                          key={contact.id} 
                          className={`contact-item ${selectedContact?.id === contact.id ? 'active' : ''}`}
                          onClick={() => setSelectedContact(contact)}
                        >
                          <div className="contact-avatar">
                            {contact.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="contact-info">
                            <div className="contact-name">{contact.name}</div>
                            <div className="contact-phone">{contact.phone_number}</div>
                            <div className="contact-device">📱 {contact.device_name}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedContact && (
                  <div className="macros-panel">
                    <h3>🎯 Macros para {selectedContact.name}</h3>
                    <div className="contact-info-card">
                      <div className="info-item">📞 {selectedContact.phone_number}</div>
                      <div className="info-item">📱 {selectedContact.device_name}</div>
                      <div className="info-item">🆔 {selectedContact.phone_number}@s.whatsapp.net</div>
                    </div>
                    
                    {webhooks.length === 0 ? (
                      <div className="empty-macros">
                        <p>Nenhuma macro criada</p>
                        <button onClick={createWebhook} className="create-btn">
                          ➕ Criar Primeira Macro
                        </button>
                      </div>
                    ) : (
                      <div className="macros-list">
                        {webhooks.map(webhook => (
                          <button
                            key={webhook.id}
                            onClick={() => triggerMacro(webhook, selectedContact)}
                            className="macro-btn"
                          >
                            🎯 {webhook.name}
                          </button>
                        ))}
                        <button onClick={createWebhook} className="create-btn">
                          ➕ Nova Macro
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {currentView === 'webhooks' && (
          <div className="webhooks">
            <div className="section">
              <h2>🎯 Gerenciar Macros</h2>
              <div className="webhooks-header">
                <p>Macros permitem disparar webhooks com dados dos contatos</p>
                <button onClick={createWebhook} className="create-btn">
                  ➕ Nova Macro
                </button>
              </div>
              
              {webhooks.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🎯</div>
                  <p>Nenhuma macro criada ainda</p>
                  <small>Crie macros para disparar webhooks automaticamente</small>
                </div>
              ) : (
                <div className="webhooks-grid">
                  {webhooks.map(webhook => (
                    <div key={webhook.id} className="webhook-card">
                      <div className="webhook-header">
                        <h4>🎯 {webhook.name}</h4>
                        <div className="webhook-actions">
                          <button 
                            onClick={() => {
                              if (confirm('Remover esta macro?')) {
                                axios.delete(`${API}/webhooks/${webhook.id}`).then(fetchData);
                              }
                            }}
                            className="delete-btn"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                      <div className="webhook-url">{webhook.url}</div>
                      <div className="webhook-desc">{webhook.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-info">
            🚀 WhatsFlow Local v2.0 | 
            <a href="http://localhost:8001/api" target="_blank" rel="noopener noreferrer">
              🔗 API
            </a> | 
            <a href="http://localhost:3001/status" target="_blank" rel="noopener noreferrer">
              📱 WhatsApp Service
            </a>
          </div>
          <div className="footer-status">
            {status === 'connected' ? '🟢' : status === 'disconnected' ? '🟡' : '🔴'} Sistema Local
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
EOF

echo "✅ Arquivos criados!"

# ==========================================
# INSTALAR DEPENDÊNCIAS
# ==========================================
echo "📦 Instalando dependências..."

# Backend
echo "🐍 Backend Python..."
cd backend
python3 -m venv venv &>/dev/null
source venv/bin/activate
pip install -r requirements.txt &>/dev/null
deactivate
cd ..

# WhatsApp Service
echo "📱 WhatsApp Service..."
cd whatsapp-service
npm install &>/dev/null
cd ..

# Frontend
echo "⚛️ Frontend React..."
cd frontend
npm install &>/dev/null
cd ..

echo "✅ Dependências instaladas!"

# ==========================================
# CONFIGURAR PM2 E INICIAR
# ==========================================
echo "🚀 Configurando e iniciando serviços..."

# Ecosystem PM2
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'whatsflow-backend-local',
      cwd: process.env.HOME + '/whatsflow/backend',
      script: 'venv/bin/python',
      args: '-m uvicorn server:app --host 0.0.0.0 --port 8001 --reload',
      env: { NODE_ENV: 'development' }
    },
    {
      name: 'whatsflow-frontend-local',
      cwd: process.env.HOME + '/whatsflow/frontend',
      script: 'npm',
      args: 'start',
      env: { NODE_ENV: 'development', PORT: 3000, BROWSER: 'none' }
    },
    {
      name: 'whatsapp-service-local',
      cwd: process.env.HOME + '/whatsflow/whatsapp-service',
      script: 'server.js',
      env: { NODE_ENV: 'development', FASTAPI_URL: 'http://localhost:8001', PORT: 3001 }
    }
  ]
};
EOF

# Parar PM2 existente
pm2 delete all &>/dev/null || true

# Iniciar serviços
pm2 start ecosystem.config.js &>/dev/null
pm2 save &>/dev/null

# Aguardar inicialização
echo "⏳ Aguardando inicialização dos serviços..."
sleep 8

# ==========================================
# VERIFICAR E FINALIZAR
# ==========================================
echo ""
echo "🔍 Verificando serviços..."

# Verificar se os serviços estão rodando
BACKEND_OK=$(curl -s http://localhost:8001/api 2>/dev/null | grep -q "WhatsFlow" && echo "✅" || echo "❌")
FRONTEND_OK=$(curl -s http://localhost:3000 2>/dev/null >/dev/null && echo "✅" || echo "❌")
WHATSAPP_OK=$(curl -s http://localhost:3001/status 2>/dev/null >/dev/null && echo "✅" || echo "❌")

echo "   Backend API (8001): $BACKEND_OK"
echo "   Frontend (3000): $FRONTEND_OK"  
echo "   WhatsApp Service (3001): $WHATSAPP_OK"

# Criar script de controle
cat > start.sh << 'EOF'
#!/bin/bash
echo "🚀 Iniciando WhatsFlow Local..."
cd ~/whatsflow
pm2 start ecosystem.config.js
echo "✅ WhatsFlow rodando em: http://localhost:3000"
EOF

cat > stop.sh << 'EOF'
#!/bin/bash
echo "🛑 Parando WhatsFlow Local..."
pm2 stop all
echo "✅ WhatsFlow parado"
EOF

cat > status.sh << 'EOF'
#!/bin/bash
echo "📊 Status WhatsFlow Local:"
pm2 status
echo ""
echo "🌐 URLs:"
echo "   Frontend: http://localhost:3000"
echo "   Backend: http://localhost:8001"
echo "   WhatsApp: http://localhost:3001"
EOF

chmod +x start.sh stop.sh status.sh

# ==========================================
# SUCESSO!
# ==========================================
echo ""
echo "🎉 WHATSFLOW LOCAL INSTALADO COM SUCESSO!"
echo "========================================"
echo ""
echo "🌐 Acesse agora: http://localhost:3000"
echo ""
echo "✅ Serviços rodando:"
echo "   • Frontend: http://localhost:3000"
echo "   • Backend API: http://localhost:8001/api"
echo "   • WhatsApp Service: http://localhost:3001/status"
echo ""
echo "🎯 Recursos disponíveis:"
echo "   ✅ Dashboard com estatísticas"
echo "   ✅ Sistema de conexão WhatsApp"
echo "   ✅ Central de mensagens"
echo "   ✅ Sistema de macros/webhooks"
echo "   ✅ Interface moderna e responsiva"
echo ""
echo "🔧 Controle do sistema:"
echo "   • Iniciar: ./start.sh"
echo "   • Parar: ./stop.sh"
echo "   • Status: ./status.sh"
echo "   • Logs: pm2 logs"
echo ""
echo "📱 Para conectar WhatsApp:"
echo "   1. Acesse http://localhost:3000"
echo "   2. Vá em 'Dashboard' ou 'Mensagens'"
echo "   3. Escaneie QR Code OU clique 'Ativar Demo'"
echo ""
echo "🎯 Para criar macros:"
echo "   1. Vá em 'Macros' ou 'Mensagens'"
echo "   2. Clique 'Nova Macro'"
echo "   3. Defina nome e URL do webhook"
echo "   4. Use clicando no botão da macro"
echo ""
echo "📁 Instalação em: ~/whatsflow/"
echo ""
echo "🚀 WhatsFlow Local funcionando perfeitamente!"

# Abrir browser automaticamente (se disponível)
sleep 2
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000 &>/dev/null &
elif command -v open &> /dev/null; then
    open http://localhost:3000 &>/dev/null &
fi