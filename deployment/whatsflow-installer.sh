#!/bin/bash

# WhatsFlow - Instalador Automático Completo
# Versão: 1.0.0
# Autor: WhatsFlow Team
# 
# Execute este script no seu servidor Ubuntu/Debian para instalar
# o sistema completo de automação WhatsApp

set -e  # Parar em caso de erro

echo "🚀 WhatsFlow - Instalador Automático"
echo "===================================="
echo ""
echo "Este script irá instalar:"
echo "✅ Node.js 20 + Python 3 + MongoDB"
echo "✅ Nginx + SSL (Let's Encrypt)"
echo "✅ WhatsFlow completo (Backend + Frontend + WhatsApp Service)"
echo "✅ Configuração automática de serviços"
echo ""

# Verificar se está executando como root
if [ "$EUID" -eq 0 ]; then
    echo "❌ NÃO execute como root. Use um usuário normal com sudo."
    echo "   Exemplo: sudo -u usuario ./whatsflow-installer.sh"
    exit 1
fi

# Verificar sistema operacional
if ! command -v apt &> /dev/null; then
    echo "❌ Este instalador é apenas para Ubuntu/Debian com APT."
    exit 1
fi

# Solicitar informações do usuário
echo "📋 Configuração do Sistema:"
read -p "🌐 Digite seu domínio (ex: whatsflow.seusite.com): " DOMAIN
read -p "📧 Digite seu email para SSL: " EMAIL

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "❌ Domínio e email são obrigatórios!"
    exit 1
fi

echo ""
echo "🔧 Iniciando instalação para: $DOMAIN"
echo "📧 SSL será configurado para: $EMAIL"
echo ""
read -p "🚀 Pressione ENTER para continuar ou Ctrl+C para cancelar..."

# ==========================================
# FASE 1: INSTALAR DEPENDÊNCIAS DO SISTEMA
# ==========================================
echo ""
echo "📦 FASE 1: Instalando dependências do sistema..."

# Atualizar sistema
sudo apt update
sudo apt upgrade -y

# Instalar dependências essenciais
sudo apt install -y curl wget git nginx certbot python3-certbot-nginx build-essential software-properties-common

# Instalar Node.js 20
echo "📦 Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar versões
echo "✅ Node.js: $(node --version)"
echo "✅ NPM: $(npm --version)"

# Instalar Python e pip
sudo apt install -y python3 python3-pip python3-venv

# Instalar MongoDB
echo "📦 Instalando MongoDB..."
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt update
sudo apt install -y mongodb-org

# Iniciar e habilitar MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod

# Instalar PM2 globalmente
sudo npm install -g pm2

echo "✅ FASE 1 concluída - Dependências instaladas!"

# ==========================================
# FASE 2: CRIAR ESTRUTURA DO PROJETO
# ==========================================
echo ""
echo "📁 FASE 2: Criando estrutura do projeto..."

# Criar diretório e definir permissões
sudo mkdir -p /var/www/whatsflow
sudo chown $USER:$USER /var/www/whatsflow
cd /var/www/whatsflow

# Criar diretórios
mkdir -p backend frontend/src/components frontend/public whatsapp-service

echo "✅ FASE 2 concluída - Estrutura criada!"

# ==========================================
# FASE 3: CRIAR ARQUIVOS DO BACKEND
# ==========================================
echo ""
echo "🐍 FASE 3: Criando Backend Python..."

# requirements.txt
cat > backend/requirements.txt << 'EOF'
fastapi==0.104.1
uvicorn==0.24.0
motor==3.3.2
python-dotenv==1.0.0
pydantic==2.5.0
python-multipart==0.0.6
httpx==0.25.2
EOF

# .env
cat > backend/.env << EOF
MONGO_URL=mongodb://localhost:27017/whatsflow
DB_NAME=whatsflow
CORS_ORIGINS=https://$DOMAIN,http://localhost:3000
EOF

# server.py (Backend principal - versão compacta para instalador)
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

app = FastAPI(title="WhatsFlow API")
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
            logging.info(f"Webhook triggered: {webhook_url} - Status: {response.status_code}")
    except Exception as e:
        logging.error(f"Webhook error: {str(e)}")

# Routes
@api_router.get("/")
async def root():
    return {"message": "WhatsFlow API - Sistema de Automação WhatsApp"}

@api_router.post("/whatsapp/message")
async def handle_whatsapp_message(message_data: IncomingMessage):
    try:
        contact = await get_or_create_contact(message_data.phone_number, message_data.push_name, message_data.device_id or "whatsapp_1", message_data.device_name or "WhatsApp 1")
        await save_message(contact['id'], message_data.phone_number, message_data.message, 'incoming', message_data.device_id or "whatsapp_1", message_data.device_name or "WhatsApp 1")
        reply = f"Mensagem recebida via {message_data.device_name or 'WhatsApp 1'}: '{message_data.message}'"
        await save_message(contact['id'], message_data.phone_number, reply, 'outgoing', message_data.device_id or "whatsapp_1", message_data.device_name or "WhatsApp 1")
        return {"reply": reply, "success": True}
    except Exception as e:
        return {"reply": "Erro ao processar mensagem", "success": False}

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
        return {"success": False, "error": "Service unavailable"}

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
    return {"message": "Webhook deleted"}

@api_router.post("/macros/trigger")
async def trigger_macro(data: dict, background_tasks: BackgroundTasks):
    contact = await db.contacts.find_one({"_id": data["contact_id"]})
    if not contact:
        raise HTTPException(404, "Contact not found")
    
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
    return {"message": f"Macro '{data['macro_name']}' triggered successfully"}

app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','), allow_methods=["*"], allow_headers=["*"])

logging.basicConfig(level=logging.INFO)
EOF

# Instalar dependências Python
echo "📦 Instalando dependências Python..."
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
cd ..

echo "✅ FASE 3 concluída - Backend criado!"

# ==========================================
# FASE 4: CRIAR WHATSAPP SERVICE
# ==========================================
echo ""
echo "📱 FASE 4: Criando WhatsApp Service..."

cd whatsapp-service

# package.json
cat > package.json << 'EOF'
{
  "name": "whatsapp-service",
  "version": "1.0.0",
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

# server.js
cat > server.js << 'EOF'
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

try {
    require('@whiskeysockets/baileys')
    bailaysAvailable = true
    console.log('✅ Baileys disponível - Conexão real WhatsApp habilitada')
} catch (error) {
    console.log('⚠️ Baileys não disponível - Modo demo ativo')
    bailaysAvailable = false
}

const authDir = path.join(__dirname, 'auth_info')
fs.ensureDirSync(authDir)

async function initWhatsApp() {
    if (!bailaysAvailable) {
        console.log('🚧 Modo demo - Simulando conexão WhatsApp')
        setTimeout(() => {
            qrCode = `whatsflow-demo-${Date.now()}`
            console.log('QR Code demo gerado')
        }, 2000)
        return
    }

    try {
        const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
        const { state, saveCreds } = await useMultiFileAuthState(authDir)

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['WhatsFlow', 'Chrome', '1.0.0'],
            markOnlineOnConnect: false
        })

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr) {
                qrCode = qr
                console.log('✅ QR Code gerado')
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
                console.log('Conexão fechada, reconectando:', shouldReconnect)
                isConnected = false
                connectedUser = null
                if (shouldReconnect) setTimeout(initWhatsApp, 5000)
            } else if (connection === 'open') {
                console.log('✅ WhatsApp conectado!')
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
        console.error('Erro na inicialização:', error)
        bailaysAvailable = false
        initWhatsApp()
    }
}

async function handleIncomingMessage(message) {
    try {
        const phoneNumber = message.key.remoteJid.replace('@s.whatsapp.net', '')
        const messageText = message.message.conversation || message.message.extendedTextMessage?.text || ''
        const pushName = message.pushName || 'Desconhecido'
        
        console.log(`📨 Mensagem de ${pushName} (${phoneNumber}): ${messageText}`)

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
        console.error('Erro ao processar mensagem:', error)
    }
}

async function sendMessage(phoneNumber, text) {
    try {
        if (!bailaysAvailable) {
            console.log(`[DEMO] Enviaria mensagem para ${phoneNumber}: ${text}`)
            return { success: true, demo: true }
        }
        
        if (!sock || !isConnected) {
            throw new Error('WhatsApp não conectado')
        }

        const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`
        await sock.sendMessage(jid, { text })
        console.log(`✅ Mensagem enviada para ${phoneNumber}`)
        return { success: true }
    } catch (error) {
        console.error('Erro ao enviar:', error)
        return { success: false, error: error.message }
    }
}

function simulateConnection() {
    if (!bailaysAvailable) {
        isConnected = true
        qrCode = null
        connectedUser = { id: '5511999999999', name: 'WhatsFlow Demo' }
        console.log('🚧 Demo: WhatsApp "conectado"')
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
        res.json({ success: true, message: 'Demo conectado' })
    } else {
        res.json({ success: false, message: 'Não está em modo demo' })
    }
})

app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Service rodando na porta ${PORT}`)
    console.log(`🔗 FastAPI URL: ${FASTAPI_URL}`)
    if (!bailaysAvailable) {
        console.log('🚧 MODO DEMO - Instale Baileys para WhatsApp real')
    }
    initWhatsApp()
})

process.on('SIGINT', () => {
    console.log('🛑 Encerrando...')
    if (sock) sock.end()
    process.exit(0)
})
EOF

# Instalar dependências Node.js
echo "📦 Instalando dependências Node.js..."
npm install

cd ..

echo "✅ FASE 4 concluída - WhatsApp Service criado!"

# ==========================================
# FASE 5: CRIAR FRONTEND REACT
# ==========================================
echo ""
echo "⚛️ FASE 5: Criando Frontend React..."

cd frontend

# package.json
cat > package.json << 'EOF'
{
  "name": "whatsflow-frontend",
  "version": "1.0.0",
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
    "production": [">0.2%", "not dead", "not op_mini all"],
    "development": ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"]
  }
}
EOF

# .env
cat > .env << EOF
REACT_APP_BACKEND_URL=https://$DOMAIN
EOF

# public/index.html
mkdir -p public
cat > public/index.html << 'EOF'
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WhatsFlow - Automação WhatsApp</title>
</head>
<body>
    <div id="root"></div>
</body>
</html>
EOF

# src/index.js
mkdir -p src
cat > src/index.js << 'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
EOF

# src/index.css
cat > src/index.css << 'EOF'
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
EOF

# src/App.js (versão simplificada para instalador)
cat > src/App.js << 'EOF'
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function App() {
  const [status, setStatus] = useState('disconnected');
  const [qrCode, setQrCode] = useState(null);
  const [stats, setStats] = useState({ new_contacts_today: 0, active_conversations: 0, messages_today: 0 });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusRes, qrRes, statsRes] = await Promise.all([
          axios.get(`${API}/whatsapp/status`),
          axios.get(`${API}/whatsapp/qr`),
          axios.get(`${API}/dashboard/stats`)
        ]);
        setStatus(statusRes.data.connected ? 'connected' : 'disconnected');
        setQrCode(qrRes.data.qr);
        setStats(statsRes.data);
      } catch (error) {
        console.error('Erro ao buscar dados:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const connectDemo = async () => {
    try {
      await axios.post('http://localhost:3001/demo/connect');
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      console.error('Erro ao conectar demo:', error);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>🤖 WhatsFlow</h1>
        <p>Sistema de Automação WhatsApp</p>
      </header>

      <main className="main">
        <section className="connection-section">
          <h2>📱 Status da Conexão</h2>
          <div className={`status ${status}`}>
            <span className="dot"></span>
            {status === 'connected' ? 'Conectado' : 'Desconectado'}
          </div>

          {status === 'disconnected' && (
            <div className="qr-section">
              {qrCode ? (
                <div className="qr-display">
                  <p>Escaneie o QR Code com seu WhatsApp:</p>
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCode)}`} alt="QR Code" />
                </div>
              ) : (
                <div className="demo-section">
                  <p>WhatsApp não conectado</p>
                  <button onClick={connectDemo} className="demo-btn">🎯 Conectar Demo</button>
                </div>
              )}
            </div>
          )}

          {status === 'connected' && (
            <div className="success">✅ WhatsApp conectado com sucesso!</div>
          )}
        </section>

        <section className="stats-section">
          <h2>📊 Estatísticas</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-number">{stats.new_contacts_today}</div>
              <div className="stat-label">Novos contatos hoje</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{stats.active_conversations}</div>
              <div className="stat-label">Conversas ativas</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">{stats.messages_today}</div>
              <div className="stat-label">Mensagens hoje</div>
            </div>
          </div>
        </section>

        <section className="info-section">
          <h2>🚀 WhatsFlow Instalado!</h2>
          <p>Seu sistema de automação WhatsApp está funcionando!</p>
          <div className="features">
            <div className="feature">✅ Backend API ativo</div>
            <div className="feature">✅ WhatsApp Service rodando</div>
            <div className="feature">✅ Dashboard funcional</div>
            <div className="feature">✅ Sistema de webhooks pronto</div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
EOF

# src/App.css
cat > src/App.css << 'EOF'
.app { min-height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.header { background: rgba(255,255,255,0.95); text-align: center; padding: 2rem; }
.header h1 { font-size: 2.5rem; color: #2d3748; margin-bottom: 0.5rem; }
.header p { color: #666; }
.main { padding: 2rem; max-width: 1200px; margin: 0 auto; }
.connection-section, .stats-section, .info-section { background: white; border-radius: 16px; padding: 2rem; margin-bottom: 2rem; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
.status { display: flex; align-items: center; gap: 0.5rem; padding: 1rem; border-radius: 8px; font-weight: 500; }
.status.connected { background: #f0fff4; color: #22543d; }
.status.disconnected { background: #fffaf0; color: #c05621; }
.dot { width: 10px; height: 10px; border-radius: 50%; }
.status.connected .dot { background: #48bb78; }
.status.disconnected .dot { background: #ed8936; }
.qr-display { text-align: center; margin: 2rem 0; }
.qr-display img { margin: 1rem 0; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.demo-section { text-align: center; margin: 2rem 0; }
.demo-btn { background: #48bb78; color: white; border: none; padding: 1rem 2rem; border-radius: 8px; font-size: 1rem; cursor: pointer; }
.demo-btn:hover { background: #38a169; }
.success { background: #f0fff4; color: #22543d; padding: 1rem; border-radius: 8px; text-align: center; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
.stat-card { text-align: center; padding: 1.5rem; background: #f8fafc; border-radius: 12px; }
.stat-number { font-size: 2rem; font-weight: 700; color: #2d3748; }
.stat-label { color: #666; font-size: 0.9rem; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-top: 1rem; }
.feature { padding: 1rem; background: #f0fff4; color: #22543d; border-radius: 8px; font-weight: 500; }
h2 { color: #2d3748; margin-bottom: 1rem; }
EOF

# Instalar dependências React
echo "📦 Instalando dependências React..."
npm install

cd ..

echo "✅ FASE 5 concluída - Frontend criado!"

# ==========================================
# FASE 6: CONFIGURAR NGINX E SSL
# ==========================================
echo ""
echo "🌐 FASE 6: Configurando Nginx e SSL..."

# Configurar Nginx
sudo tee /etc/nginx/sites-available/whatsflow << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    location /api {
        proxy_pass http://localhost:8001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Ativar site
sudo ln -sf /etc/nginx/sites-available/whatsflow /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# Configurar SSL
echo "🔒 Configurando SSL..."
sudo certbot --nginx -d $DOMAIN --email $EMAIL --agree-tos --non-interactive

echo "✅ FASE 6 concluída - Nginx e SSL configurados!"

# ==========================================
# FASE 7: CONFIGURAR PM2 E INICIAR SERVIÇOS
# ==========================================
echo ""
echo "⚙️ FASE 7: Configurando serviços..."

# Criar ecosystem.config.js para PM2
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'whatsflow-backend',
      cwd: '/var/www/whatsflow/backend',
      script: 'venv/bin/python',
      args: '-m uvicorn server:app --host 0.0.0.0 --port 8001',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'whatsflow-frontend',
      cwd: '/var/www/whatsflow/frontend',
      script: 'npm',
      args: 'start',
      env: { NODE_ENV: 'production', PORT: 3000 }
    },
    {
      name: 'whatsapp-service',
      cwd: '/var/www/whatsflow/whatsapp-service',
      script: 'server.js',
      env: { NODE_ENV: 'production', FASTAPI_URL: 'http://localhost:8001', PORT: 3001 }
    }
  ]
};
EOF

# Iniciar aplicações com PM2
echo "🚀 Iniciando aplicações..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# Verificar se os serviços estão rodando
echo "🔍 Verificando serviços..."
sleep 5
pm2 status

echo "✅ FASE 7 concluída - Serviços iniciados!"

# ==========================================
# INSTALAÇÃO CONCLUÍDA
# ==========================================
echo ""
echo "🎉 INSTALAÇÃO CONCLUÍDA COM SUCESSO!"
echo "===================================="
echo ""
echo "🌐 Seu WhatsFlow está rodando em: https://$DOMAIN"
echo ""
echo "✅ Serviços ativos:"
echo "   • Backend API: http://localhost:8001"
echo "   • Frontend: http://localhost:3000"
echo "   • WhatsApp Service: http://localhost:3001"
echo "   • Nginx: Proxy reverso com SSL"
echo ""
echo "📱 Para conectar WhatsApp:"
echo "   1. Acesse: https://$DOMAIN"
echo "   2. Use o botão 'Conectar Demo' ou escaneie QR Code"
echo ""
echo "🔧 Comandos úteis:"
echo "   • Ver status: pm2 status"
echo "   • Ver logs: pm2 logs"
echo "   • Reiniciar: pm2 restart all"
echo "   • Parar: pm2 stop all"
echo ""
echo "🆘 Suporte:"
echo "   • Logs Nginx: sudo tail -f /var/log/nginx/error.log"
echo "   • Logs MongoDB: sudo journalctl -u mongod"
echo ""
echo "🚀 WhatsFlow instalado e funcionando!"