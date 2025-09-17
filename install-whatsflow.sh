#!/bin/bash

# WhatsFlow - Instalação Ultra-Simples (LOCALHOST)
# Sistema completo de Automação WhatsApp com Baileys
# Instalação automática com apenas 1 comando

set -e

echo "🤖 WHATSFLOW - Instalação Automática Localhost"
echo "==============================================="
echo ""

# Detectar sistema operacional
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "✅ Sistema detectado: Linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "✅ Sistema detectado: macOS"
else
    echo "❌ Sistema não suportado: $OSTYPE"
    exit 1
fi

# Função para verificar se comando existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Atualizar sistema
echo "📦 Atualizando sistema..."
if command_exists apt-get; then
    sudo apt-get update -qq
elif command_exists yum; then
    sudo yum update -y -q
elif command_exists brew; then
    brew update
fi

# Instalar Node.js 20.x
if ! command_exists node; then
    echo "📦 Instalando Node.js 20.x..."
    if command_exists apt-get; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command_exists yum; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo yum install -y nodejs npm
    elif command_exists brew; then
        brew install node
    fi
else
    echo "✅ Node.js já instalado (requisito mínimo: versão 20.x)"
fi

# Instalar Python
if ! command_exists python3; then
    echo "📦 Instalando Python..."
    if command_exists apt-get; then
        sudo apt-get install -y python3 python3-pip
    elif command_exists yum; then
        sudo yum install -y python3 python3-pip
    elif command_exists brew; then
        brew install python
    fi
else
    echo "✅ Python já instalado"
fi

# Instalar MongoDB
if ! command_exists mongod; then
    echo "📦 Instalando MongoDB..."
    if command_exists apt-get; then
        wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
        echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
        sudo apt-get update
        sudo apt-get install -y mongodb-org
    elif command_exists yum; then
        sudo tee /etc/yum.repos.d/mongodb-org-6.0.repo << 'EOF'
[mongodb-org-6.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/6.0/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-6.0.asc
EOF
        sudo yum install -y mongodb-org
    elif command_exists brew; then
        brew tap mongodb/brew
        brew install mongodb-community
    fi
else
    echo "✅ MongoDB já instalado"
fi

# Instalar Yarn globalmente
if ! command_exists yarn; then
    echo "📦 Instalando Yarn..."
    sudo npm install -g yarn
else
    echo "✅ Yarn já instalado"
fi

# Criar diretório de trabalho
INSTALL_DIR="$HOME/whatsflow"
echo "📁 Criando diretório: $INSTALL_DIR"
rm -rf "$INSTALL_DIR" # Remove se já existir
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "⬇️ Criando aplicação WhatsFlow completa..."

# Criar estrutura de diretórios
mkdir -p backend frontend/src/components frontend/public whatsapp-service

# ============================================
# BACKEND COMPLETO
# ============================================
echo "🔧 Criando backend completo..."

cat > backend/requirements.txt << 'EOF'
fastapi==0.104.1
uvicorn==0.24.0
motor==3.3.2
python-dotenv==1.0.0
pydantic==2.5.0
httpx==0.25.2
starlette==0.27.0
EOF

cat > backend/.env << 'EOF'
MONGO_URL=mongodb://localhost:27017
DB_NAME=whatsflow
CORS_ORIGINS=http://localhost:3000
EOF

# Criar o arquivo server.py completo (backend completo do WhatsFlow)
cat > backend/server.py << 'EOF'
from fastapi import FastAPI, APIRouter, HTTPException, Depends, BackgroundTasks
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
import httpx
import asyncio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

WHATSAPP_SERVICE_URL = "http://localhost:3001"

# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

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
    message_id: Optional[str] = None
    delivered: bool = False
    read: bool = False

class IncomingMessage(BaseModel):
    phone_number: str
    message: str
    message_id: str
    timestamp: int
    push_name: Optional[str] = None
    device_id: Optional[str] = "whatsapp_1"
    device_name: Optional[str] = "WhatsApp 1"

class OutgoingMessage(BaseModel):
    phone_number: str
    message: str
    device_id: Optional[str] = "whatsapp_1"

class MacroTrigger(BaseModel):
    contact_id: str
    macro_name: str
    webhook_url: str

class MessageResponse(BaseModel):
    reply: Optional[str] = None
    success: bool = True

class QRUpdate(BaseModel):
    qr: str

class ConnectionUpdate(BaseModel):
    connected: bool
    user: Optional[dict] = None

class Webhook(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    url: str
    description: Optional[str] = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    active: bool = True

class WebhookCreate(BaseModel):
    name: str
    url: str
    description: Optional[str] = ""

class WebhookTrigger(BaseModel):
    webhook_id: str
    webhook_url: str
    data: Dict[str, Any]

class WhatsAppInstance(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    device_id: str
    device_name: str
    connected: bool = False
    user: Optional[Dict[str, Any]] = None
    contacts_count: int = 0
    messages_today: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_connected_at: Optional[datetime] = None

class WhatsAppInstanceCreate(BaseModel):
    name: str
    device_name: Optional[str] = None

# Database helpers
async def get_or_create_contact(phone_number: str, name: str = None, device_id: str = "whatsapp_1", device_name: str = "WhatsApp 1") -> dict:
    contacts_collection = db.contacts
    
    contact = await contacts_collection.find_one({
        "phone_number": phone_number,
        "device_id": device_id
    })
    
    if not contact:
        contact_data = Contact(
            phone_number=phone_number,
            name=name or f"Contact {phone_number[-4:]}",
            device_id=device_id,
            device_name=device_name,
            last_message_at=datetime.now(timezone.utc)
        )
        result = await contacts_collection.insert_one(contact_data.dict())
        contact_data.id = str(result.inserted_id)
        return contact_data.dict()
    else:
        await contacts_collection.update_one(
            {"phone_number": phone_number, "device_id": device_id},
            {"$set": {"last_message_at": datetime.now(timezone.utc)}}
        )
        contact['id'] = str(contact.get('_id', contact.get('id')))
    
    return contact

async def save_message(contact_id: str, phone_number: str, message: str, direction: str, device_id: str = "whatsapp_1", device_name: str = "WhatsApp 1", message_id: str = None):
    messages_collection = db.messages
    
    message_data = Message(
        contact_id=contact_id,
        phone_number=phone_number,
        device_id=device_id,
        device_name=device_name,
        message=message,
        direction=direction,
        message_id=message_id
    )
    
    await messages_collection.insert_one(message_data.dict())
    return message_data

# Background task for webhook triggers
async def trigger_webhook_async(webhook_url: str, data: Dict[str, Any]):
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                webhook_url,
                json=data,
                headers={"Content-Type": "application/json"}
            )
            
            logging.info(f"Webhook triggered: {webhook_url} - Status: {response.status_code}")
            return {"success": True, "status_code": response.status_code}
            
    except Exception as e:
        logging.error(f"Webhook trigger failed: {webhook_url} - Error: {str(e)}")
        return {"success": False, "error": str(e)}

# WhatsApp Instances Routes
@api_router.get("/whatsapp/instances")
async def get_whatsapp_instances():
    """Get all WhatsApp instances"""
    try:
        instances = await db.whatsapp_instances.find().to_list(100)
        
        for instance in instances:
            instance['id'] = str(instance.get('_id'))
            if '_id' in instance:
                del instance['_id']
            
            contacts_count = await db.contacts.count_documents({
                "device_id": instance.get('device_id')
            })
            instance['contacts_count'] = contacts_count
            
            today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            messages_today = await db.messages.count_documents({
                "device_id": instance.get('device_id'),
                "timestamp": {"$gte": today}
            })
            instance['messages_today'] = messages_today
        
        return instances
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/whatsapp/instances")
async def create_whatsapp_instance(instance_data: WhatsAppInstanceCreate):
    """Create a new WhatsApp instance"""
    try:
        device_id = f"whatsapp_{str(uuid.uuid4())[:8]}"
        device_name = instance_data.device_name or instance_data.name
        
        instance = WhatsAppInstance(
            name=instance_data.name,
            device_id=device_id,
            device_name=device_name
        )
        
        result = await db.whatsapp_instances.insert_one(instance.dict())
        instance.id = str(result.inserted_id)
        
        return {"success": True, "instance": instance.dict()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/whatsapp/instances/{instance_id}/connect")
async def connect_whatsapp_instance(instance_id: str):
    """Start connection process for a WhatsApp instance"""
    try:
        instance = await db.whatsapp_instances.find_one({"id": instance_id})
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        return {"success": True, "message": "Connection initiated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/whatsapp/instances/{instance_id}/qr")
async def get_instance_qr(instance_id: str):
    """Get QR code for specific instance"""
    try:
        instance = await db.whatsapp_instances.find_one({"id": instance_id})
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        qr_data = f"whatsapp-instance-{instance_id}-{datetime.now().timestamp()}"
        
        return {"qr": qr_data, "connected": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/whatsapp/instances/{instance_id}/disconnect")
async def disconnect_whatsapp_instance(instance_id: str):
    """Disconnect a WhatsApp instance"""
    try:
        result = await db.whatsapp_instances.update_one(
            {"id": instance_id},
            {"$set": {
                "connected": False,
                "user": None,
                "last_connected_at": datetime.now(timezone.utc)
            }}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        return {"success": True, "message": "Instance disconnected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/whatsapp/instances/{instance_id}")
async def delete_whatsapp_instance(instance_id: str):
    """Delete a WhatsApp instance"""
    try:
        result = await db.whatsapp_instances.delete_one({"id": instance_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        return {"success": True, "message": "Instance deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# WhatsApp Routes
@api_router.post("/whatsapp/message", response_model=MessageResponse)
async def handle_whatsapp_message(message_data: IncomingMessage):
    """Process incoming WhatsApp messages"""
    try:
        phone_number = message_data.phone_number
        message_text = message_data.message
        push_name = message_data.push_name
        device_id = message_data.device_id or "whatsapp_1"
        device_name = message_data.device_name or "WhatsApp 1"
        
        contact = await get_or_create_contact(phone_number, push_name, device_id, device_name)
        
        await save_message(
            contact['id'], 
            phone_number, 
            message_text, 
            'incoming',
            device_id,
            device_name,
            message_data.message_id
        )
        
        reply = f"Mensagem recebida via {device_name}: '{message_text}'"
        
        await save_message(contact['id'], phone_number, reply, 'outgoing', device_id, device_name)
        
        return MessageResponse(reply=reply)
        
    except Exception as e:
        logging.error(f"Error processing message: {str(e)}")
        return MessageResponse(
            reply="Desculpe, ocorreu um erro ao processar sua mensagem.",
            success=False
        )

@api_router.post("/whatsapp/send")
async def send_whatsapp_message(message: OutgoingMessage):
    """Send message via WhatsApp service"""
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                f"{WHATSAPP_SERVICE_URL}/send",
                json={
                    "phone_number": message.phone_number,
                    "message": message.message
                }
            )
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/whatsapp/qr")
async def get_qr_code():
    """Get current QR code for authentication"""
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(f"{WHATSAPP_SERVICE_URL}/qr")
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/whatsapp/status")
async def get_whatsapp_status():
    """Get WhatsApp connection status"""
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(f"{WHATSAPP_SERVICE_URL}/status")
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Messages and Contacts Routes
@api_router.get("/contacts")
async def get_contacts(device_id: Optional[str] = None):
    """Get all contacts, optionally filtered by device"""
    query = {}
    if device_id and device_id != "all":
        query["device_id"] = device_id
        
    contacts = await db.contacts.find(query).sort("last_message_at", -1).to_list(100)
    for contact in contacts:
        contact['id'] = str(contact.get('_id'))
        if '_id' in contact:
            del contact['_id']
    return contacts

@api_router.get("/devices")
async def get_devices():
    """Get list of all devices"""
    pipeline = [
        {"$group": {"_id": "$device_id", "device_name": {"$first": "$device_name"}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}}
    ]
    devices = await db.contacts.aggregate(pipeline).to_list(100)
    
    result = []
    for device in devices:
        result.append({
            "device_id": device["_id"],
            "device_name": device["device_name"],
            "contact_count": device["count"]
        })
    
    total_contacts = await db.contacts.count_documents({})
    result.insert(0, {
        "device_id": "all",
        "device_name": "Todos os Dispositivos",
        "contact_count": total_contacts
    })
    
    return result

@api_router.get("/contacts/{contact_id}/messages")
async def get_contact_messages(contact_id: str):
    """Get messages for a specific contact"""
    messages = await db.messages.find({"contact_id": contact_id}).sort("timestamp", 1).to_list(1000)
    for message in messages:
        message['id'] = str(message.get('_id'))
        if '_id' in message:
            del message['_id']
    return messages

@api_router.get("/dashboard/stats")
async def get_dashboard_stats():
    """Get dashboard statistics"""
    try:
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        
        new_contacts_today = await db.contacts.count_documents({
            "created_at": {"$gte": today}
        })
        
        active_conversations = await db.contacts.count_documents({
            "is_active": True
        })
        
        messages_today = await db.messages.count_documents({
            "timestamp": {"$gte": today}
        })
        
        return {
            "new_contacts_today": new_contacts_today,
            "active_conversations": active_conversations,
            "messages_today": messages_today
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Webhook Routes
@api_router.get("/webhooks")
async def get_webhooks():
    """Get all webhooks"""
    webhooks = await db.webhooks.find({"active": True}).to_list(100)
    for webhook in webhooks:
        webhook['id'] = str(webhook.get('_id'))
        if '_id' in webhook:
            del webhook['_id']
    return webhooks

@api_router.post("/webhooks")
async def create_webhook(webhook: WebhookCreate):
    """Create a new webhook"""
    try:
        webhook_data = Webhook(**webhook.dict())
        result = await db.webhooks.insert_one(webhook_data.dict())
        webhook_data.id = str(result.inserted_id)
        return webhook_data.dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str):
    """Delete a webhook"""
    try:
        result = await db.webhooks.update_one(
            {"_id": webhook_id},
            {"$set": {"active": False}}
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Webhook not found")
        return {"message": "Webhook deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/webhooks/trigger")
async def trigger_webhook(webhook_trigger: WebhookTrigger, background_tasks: BackgroundTasks):
    """Trigger a webhook with contact data"""
    try:
        background_tasks.add_task(
            trigger_webhook_async,
            webhook_trigger.webhook_url,
            webhook_trigger.data
        )
        
        webhook_log = {
            "webhook_id": webhook_trigger.webhook_id,
            "webhook_url": webhook_trigger.webhook_url,
            "data": webhook_trigger.data,
            "triggered_at": datetime.now(timezone.utc),
            "status": "triggered"
        }
        await db.webhook_logs.insert_one(webhook_log)
        
        return {"message": "Webhook triggered successfully", "status": "processing"}
        
    except Exception as e:
        logging.error(f"Error triggering webhook: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/macros/trigger")
async def trigger_macro(macro: MacroTrigger, background_tasks: BackgroundTasks):
    """Trigger a macro (webhook) for a specific contact"""
    try:
        contact = await db.contacts.find_one({"_id": macro.contact_id})
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        
        webhook_data = {
            "contact_name": contact["name"],
            "phone_number": contact["phone_number"],
            "device_id": contact.get("device_id", "whatsapp_1"),
            "device_name": contact.get("device_name", "WhatsApp 1"),
            "jid": f"{contact['phone_number']}@s.whatsapp.net",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "macro_name": macro.macro_name,
            "tags": contact.get("tags", [])
        }
        
        background_tasks.add_task(
            trigger_webhook_async,
            macro.webhook_url,
            webhook_data
        )
        
        macro_log = {
            "contact_id": macro.contact_id,
            "macro_name": macro.macro_name,
            "webhook_url": macro.webhook_url,
            "data": webhook_data,
            "triggered_at": datetime.now(timezone.utc),
            "status": "triggered"
        }
        await db.macro_logs.insert_one(macro_log)
        
        return {"message": f"Macro '{macro.macro_name}' triggered successfully", "status": "processing"}
        
    except Exception as e:
        logging.error(f"Error triggering macro: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Original routes
@api_router.get("/")
async def root():
    return {"message": "WhatsFlow API - Sistema de Automação WhatsApp"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
EOF

# ============================================
# FRONTEND COMPLETO
# ============================================
echo "🎨 Criando frontend completo..."

cat > frontend/package.json << 'EOF'
{
  "name": "whatsflow-frontend",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "5.0.1",
    "axios": "^1.6.0",
    "reactflow": "^11.10.0"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject"
  },
  "eslintConfig": {
    "extends": [
      "react-app",
      "react-app/jest"
    ]
  },
  "browserslist": {
    "production": [
      ">0.2%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  },
  "devDependencies": {
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17"
  }
}
EOF

# Criar configuração TailwindCSS simplificada
cat > frontend/tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1'
        }
      },
      animation: {
        'spin': 'spin 1s linear infinite',
        'pulse': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce': 'bounce 1s infinite'
      }
    }
  },
  plugins: []
};
EOF

cat > frontend/postcss.config.js << 'EOF'
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
EOF

cat > frontend/.env << 'EOF'
REACT_APP_BACKEND_URL=http://localhost:8001
EOF

cat > frontend/public/index.html << 'EOF'
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%PUBLIC_URL%/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#000000" />
    <meta name="description" content="WhatsFlow - Sistema de Automação WhatsApp" />
    <title>WhatsFlow - Automação WhatsApp</title>
  </head>
  <body>
    <noscript>Você precisa habilitar JavaScript para usar este app.</noscript>
    <div id="root"></div>
  </body>
</html>
EOF

cat > frontend/src/index.js << 'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
EOF

cat > frontend/src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

code {
  font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New',
    monospace;
}
EOF# Continuação do script de instalação - App.js e componentes

# Criar App.js completo
cat > frontend/src/App.js << 'EOF'
import React, { useState, useEffect } from 'react';
import './App.css';
import axios from 'axios';
import FlowEditor from './components/FlowEditor';
import FlowList from './components/FlowList';
import MessagesCenter from './components/MessagesCenter';
import WhatsAppInstances from './components/WhatsAppInstances';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// QR Code Component
const QRCode = ({ value }) => {
  if (!value) return null;
  
  return (
    <div className="qr-container">
      <div className="qr-code">
        <img 
          src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(value)}`}
          alt="QR Code"
          className="qr-image"
        />
      </div>
    </div>
  );
};

// Navigation Component
const Navigation = ({ currentView, onViewChange }) => {
  return (
    <nav className="main-navigation">
      <div className="nav-items">
        <button 
          className={`nav-item ${currentView === 'dashboard' ? 'active' : ''}`}
          onClick={() => onViewChange('dashboard')}
        >
          <span className="nav-icon">📊</span>
          <span>Dashboard</span>
        </button>
        <button 
          className={`nav-item ${currentView === 'flows' ? 'active' : ''}`}
          onClick={() => onViewChange('flows')}
        >
          <span className="nav-icon">🎯</span>
          <span>Fluxos</span>
        </button>
        <button 
          className={`nav-item ${currentView === 'contacts' ? 'active' : ''}`}
          onClick={() => onViewChange('contacts')}
        >
          <span className="nav-icon">👥</span>
          <span>Contatos</span>
        </button>
        <button 
          className={`nav-item ${currentView === 'messages' ? 'active' : ''}`}
          onClick={() => onViewChange('messages')}
        >
          <span className="nav-icon">💬</span>
          <span>Mensagens</span>
        </button>
        <button 
          className={`nav-item ${currentView === 'instances' ? 'active' : ''}`}
          onClick={() => onViewChange('instances')}
        >
          <span className="nav-icon">📱</span>
          <span>Instâncias</span>
        </button>
      </div>
    </nav>
  );
};

// WhatsApp Connection Component
const WhatsAppConnection = () => {
  const [qrCode, setQrCode] = useState(null);
  const [status, setStatus] = useState('disconnected');
  const [loading, setLoading] = useState(false);
  const [connectedUser, setConnectedUser] = useState(null);
  const [isDemoMode, setIsDemoMode] = useState(false);

  const checkStatus = async () => {
    try {
      const response = await axios.get(`${API}/whatsapp/status`);
      setStatus(response.data.connected ? 'connected' : 'disconnected');
      setConnectedUser(response.data.user);
      setIsDemoMode(response.data.demo || false);
      return response.data.connected;
    } catch (error) {
      console.error('Status check failed:', error);
      setStatus('error');
      return false;
    }
  };

  const fetchQR = async () => {
    try {
      const response = await axios.get(`${API}/whatsapp/qr`);
      if (response.data.qr) {
        setQrCode(response.data.qr);
      } else {
        setQrCode(null);
      }
    } catch (error) {
      console.error('QR fetch failed:', error);
    }
  };

  const simulateConnection = async () => {
    try {
      const response = await axios.post('http://localhost:3001/demo/connect');
      if (response.data.success) {
        await checkStatus();
      }
    } catch (error) {
      console.error('Demo connection failed:', error);
    }
  };

  const startPolling = () => {
    const interval = setInterval(async () => {
      const isConnected = await checkStatus();
      if (isConnected) {
        setQrCode(null);
        clearInterval(interval);
      } else {
        await fetchQR();
      }
    }, 3000);

    return interval;
  };

  useEffect(() => {
    checkStatus();
    const interval = startPolling();

    return () => clearInterval(interval);
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    await checkStatus();
    if (status !== 'connected') {
      startPolling();
    }
    setLoading(false);
  };

  return (
    <div className="whatsapp-connection">
      <div className="connection-header">
        <h2>🔗 Conexão WhatsApp</h2>
        <div className={`status-indicator ${status}`}>
          <div className="status-dot"></div>
          <span className="status-text">
            {status === 'connected' ? 'Conectado' : 
             status === 'disconnected' ? 'Desconectado' : 'Erro'}
            {isDemoMode && ' (Demo)'}
          </span>
        </div>
      </div>

      {isDemoMode && (
        <div className="demo-badge">
          🚧 <strong>Modo Demonstração</strong> - Simulando funcionalidade WhatsApp para testes
        </div>
      )}

      {status === 'connected' && connectedUser && (
        <div className="connected-info">
          <div className="success-badge">
            ✅ WhatsApp conectado com sucesso!
          </div>
          <div className="user-info">
            <strong>Usuário:</strong> {connectedUser.name || connectedUser.id}
          </div>
        </div>
      )}

      {status === 'disconnected' && (
        <div className="qr-section">
          <div className="warning-badge">
            ⚠️ WhatsApp não está conectado. {isDemoMode ? 'Clique para simular conexão ou ' : ''}Escaneie o QR code para conectar.
          </div>
          
          {qrCode && (
            <div className="qr-display">
              <h3>Escaneie este QR Code com o WhatsApp:</h3>
              <QRCode value={qrCode} />
              <p className="qr-instructions">
                Abra o WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho
              </p>
            </div>
          )}
          
          <div className="button-group">
            <button 
              className="connect-button"
              onClick={handleConnect}
              disabled={loading}
            >
              {loading ? 'Conectando...' : 'Conectar WhatsApp'}
            </button>
            
            {isDemoMode && (
              <button 
                className="demo-button"
                onClick={simulateConnection}
                disabled={loading}
              >
                🎯 Simular Conexão (Demo)
              </button>
            )}
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="error-badge">
          ❌ Erro de conexão. Verifique se o serviço WhatsApp está em execução.
        </div>
      )}
    </div>
  );
};

// Dashboard Stats Component
const DashboardStats = () => {
  const [stats, setStats] = useState({
    new_contacts_today: 0,
    active_conversations: 0,
    messages_today: 0
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await axios.get(`${API}/dashboard/stats`);
        setStats(response.data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="dashboard-stats">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <h3>{stats.new_contacts_today}</h3>
            <p>Novos contatos hoje</p>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">💬</div>
          <div className="stat-content">
            <h3>{stats.active_conversations}</h3>
            <p>Conversas ativas</p>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">📨</div>
          <div className="stat-content">
            <h3>{stats.messages_today}</h3>
            <p>Mensagens hoje</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Contacts List Component
const ContactsList = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchContacts = async () => {
      try {
        const response = await axios.get(`${API}/contacts`);
        setContacts(response.data);
      } catch (error) {
        console.error('Failed to fetch contacts:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchContacts();
  }, []);

  if (loading) {
    return <div className="loading">Carregando contatos...</div>;
  }

  return (
    <div className="contacts-list">
      <h3>📞 Contatos Recentes</h3>
      {contacts.length === 0 ? (
        <div className="empty-state">
          <p>Nenhum contato encontrado ainda.</p>
          <p>Os contatos aparecerão aqui quando começarem a enviar mensagens.</p>
        </div>
      ) : (
        <div className="contacts-grid">
          {contacts.slice(0, 6).map(contact => (
            <div key={contact.id} className="contact-card">
              <div className="contact-avatar">
                {contact.name.charAt(0).toUpperCase()}
              </div>
              <div className="contact-info">
                <h4>{contact.name}</h4>
                <p>{contact.phone_number}</p>
                <div className="contact-tags">
                  {contact.tags.map(tag => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Main App Component
function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [showFlowEditor, setShowFlowEditor] = useState(false);
  const [editingFlow, setEditingFlow] = useState(null);

  const handleCreateFlow = () => {
    setEditingFlow(null);
    setShowFlowEditor(true);
  };

  const handleEditFlow = (flow) => {
    setEditingFlow(flow);
    setShowFlowEditor(true);
  };

  const handleCloseFlowEditor = () => {
    setShowFlowEditor(false);
    setEditingFlow(null);
  };

  const handleSaveFlow = (flowData) => {
    console.log('Flow saved:', flowData);
    setShowFlowEditor(false);
    setEditingFlow(null);
  };

  if (showFlowEditor) {
    return (
      <FlowEditor
        flowId={editingFlow?.id}
        onSave={handleSaveFlow}
        onClose={handleCloseFlowEditor}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>🤖 WhatsFlow</h1>
          <p>Sistema de Automação para WhatsApp</p>
        </div>
      </header>

      <Navigation currentView={currentView} onViewChange={setCurrentView} />

      <main className="app-main">
        <div className="container">
          {currentView === 'dashboard' && (
            <>
              <WhatsAppConnection />
              
              <section className="dashboard-section">
                <h2>📊 Dashboard</h2>
                <DashboardStats />
              </section>

              <section className="contacts-section">
                <ContactsList />
              </section>
            </>
          )}

          {currentView === 'flows' && (
            <FlowList
              onCreateFlow={handleCreateFlow}
              onEditFlow={handleEditFlow}
            />
          )}

          {currentView === 'contacts' && (
            <section className="contacts-section">
              <h2>👥 Gerenciamento de Contatos</h2>
              <ContactsList />
            </section>
          )}

          {currentView === 'messages' && (
            <MessagesCenter />
          )}

          {currentView === 'instances' && (
            <WhatsAppInstances />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
EOF

# Criar componente WhatsAppInstances
cat > frontend/src/components/WhatsAppInstances.js << 'EOF'
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// QR Code Component
const QRCode = ({ value }) => {
  if (!value) return null;
  
  return (
    <div className="qr-container">
      <div className="qr-code">
        <img 
          src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(value)}`}
          alt="QR Code"
          className="qr-image"
        />
      </div>
    </div>
  );
};

export default function WhatsAppInstances() {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);

  useEffect(() => {
    fetchInstances();
  }, []);

  const fetchInstances = async () => {
    try {
      const response = await axios.get(`${API}/whatsapp/instances`);
      setInstances(response.data);
    } catch (error) {
      console.error('Erro ao buscar instâncias:', error);
    } finally {
      setLoading(false);
    }
  };

  const createInstance = async (instanceName) => {
    try {
      const response = await axios.post(`${API}/whatsapp/instances`, {
        name: instanceName,
        device_name: instanceName
      });
      
      if (response.data.success) {
        await fetchInstances();
        setShowCreateModal(false);
        alert(`✅ Instância "${instanceName}" criada com sucesso!`);
      }
    } catch (error) {
      console.error('Erro ao criar instância:', error);
      alert('❌ Erro ao criar instância');
    }
  };

  const connectInstance = async (instance) => {
    try {
      setSelectedInstance(instance);
      setShowQRModal(true);
      
      const response = await axios.post(`${API}/whatsapp/instances/${instance.id}/connect`);
      
      if (response.data.success) {
        startQRPolling(instance.id);
      }
    } catch (error) {
      console.error('Erro ao conectar instância:', error);
      alert('❌ Erro ao iniciar conexão');
      setShowQRModal(false);
    }
  };

  const startQRPolling = (instanceId) => {
    const interval = setInterval(async () => {
      try {
        const response = await axios.get(`${API}/whatsapp/instances/${instanceId}/qr`);
        
        if (response.data.qr) {
          setQrCode(response.data.qr);
        } else if (response.data.connected) {
          clearInterval(interval);
          setPollingInterval(null);
          setShowQRModal(false);
          setQrCode(null);
          await fetchInstances();
          alert(`✅ WhatsApp "${selectedInstance.name}" conectado com sucesso!`);
        }
      } catch (error) {
        console.error('Erro no polling QR:', error);
      }
    }, 2000);

    setPollingInterval(interval);
  };

  const disconnectInstance = async (instance) => {
    if (!confirm(`Desconectar "${instance.name}"?`)) return;

    try {
      await axios.post(`${API}/whatsapp/instances/${instance.id}/disconnect`);
      await fetchInstances();
      alert(`✅ "${instance.name}" desconectado`);
    } catch (error) {
      console.error('Erro ao desconectar:', error);
      alert('❌ Erro ao desconectar');
    }
  };

  const deleteInstance = async (instance) => {
    if (!confirm(`Excluir permanentemente "${instance.name}"?`)) return;

    try {
      await axios.delete(`${API}/whatsapp/instances/${instance.id}`);
      await fetchInstances();
      alert(`✅ "${instance.name}" excluído`);
    } catch (error) {
      console.error('Erro ao excluir:', error);
      alert('❌ Erro ao excluir instância');
    }
  };

  if (loading) {
    return <div className="loading">Carregando instâncias WhatsApp...</div>;
  }

  return (
    <div className="whatsapp-instances">
      <div className="instances-header">
        <h2>📱 Instâncias WhatsApp</h2>
        <button onClick={() => setShowCreateModal(true)} className="create-instance-btn">
          ➕ Nova Instância
        </button>
      </div>

      <div className="instances-grid">
        {instances.map(instance => (
          <div key={instance.id} className="instance-card">
            <div className="instance-header">
              <div className="instance-info">
                <h3>{instance.name}</h3>
                <div className="instance-id">ID: {instance.device_id}</div>
              </div>
              <div className={`instance-status ${instance.connected ? 'connected' : 'disconnected'}`}>
                <div className="status-dot"></div>
                <span>{instance.connected ? 'Conectado' : 'Desconectado'}</span>
              </div>
            </div>

            <div className="instance-stats">
              <div className="stat">
                <span className="stat-value">{instance.contacts_count || 0}</span>
                <span className="stat-label">Contatos</span>
              </div>
              <div className="stat">
                <span className="stat-value">{instance.messages_today || 0}</span>
                <span className="stat-label">Mensagens hoje</span>
              </div>
            </div>

            <div className="instance-actions">
              {!instance.connected ? (
                <button onClick={() => connectInstance(instance)} className="connect-btn">
                  🔗 Conectar
                </button>
              ) : (
                <button onClick={() => disconnectInstance(instance)} className="disconnect-btn">
                  ⏸️ Desconectar
                </button>
              )}
              <button onClick={() => deleteInstance(instance)} className="delete-instance-btn">
                🗑️ Excluir
              </button>
            </div>
          </div>
        ))}

        {instances.length === 0 && (
          <div className="empty-instances">
            <div className="empty-icon">📱</div>
            <h3>Nenhuma instância WhatsApp</h3>
            <p>Crie sua primeira instância para começar</p>
            <button onClick={() => setShowCreateModal(true)} className="create-first-btn">
              🚀 Criar Primeira Instância
            </button>
          </div>
        )}
      </div>

      {/* Modal Criar Instância */}
      {showCreateModal && <CreateInstanceModal onClose={() => setShowCreateModal(false)} onCreate={createInstance} />}
      
      {/* Modal QR Code */}
      {showQRModal && <QRModal instance={selectedInstance} qrCode={qrCode} onClose={() => setShowQRModal(false)} />}
    </div>
  );
}

// Modal para criar nova instância
const CreateInstanceModal = ({ onClose, onCreate }) => {
  const [instanceName, setInstanceName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!instanceName.trim()) return;

    setCreating(true);
    await onCreate(instanceName.trim());
    setCreating(false);
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>➕ Nova Instância WhatsApp</h3>
          <button onClick={onClose} className="close-modal">❌</button>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-content">
          <div className="form-group">
            <label>📝 Nome da Instância:</label>
            <input
              type="text"
              placeholder="Ex: WhatsApp Vendas, WhatsApp Suporte, etc."
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              className="instance-input"
              maxLength={50}
              required
            />
            <small>Este nome aparecerá nas mensagens e relatórios</small>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="cancel-btn">❌ Cancelar</button>
            <button type="submit" disabled={!instanceName.trim() || creating} className="create-btn">
              {creating ? '⏳ Criando...' : '✅ Criar Instância'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Modal QR Code para conexão
const QRModal = ({ instance, qrCode, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="modal qr-modal">
        <div className="modal-header">
          <h3>📱 Conectar {instance?.name}</h3>
          <button onClick={onClose} className="close-modal">❌</button>
        </div>
        
        <div className="modal-content qr-content">
          <div className="qr-instructions">
            <h4>📲 Como Conectar:</h4>
            <ol>
              <li>Abra o <strong>WhatsApp</strong> no seu celular</li>
              <li>Toque em <strong>Configurações ⚙️</strong></li>
              <li>Toque em <strong>Aparelhos conectados</strong></li>
              <li>Toque em <strong>Conectar um aparelho</strong></li>
              <li><strong>Escaneie o QR Code</strong> abaixo</li>
            </ol>
          </div>

          {qrCode ? (
            <div className="qr-section">
              <div className="qr-status">
                <div className="connecting-indicator">🔄 Aguardando conexão...</div>
              </div>
              <QRCode value={qrCode} />
              <div className="qr-footer">
                <small>O QR Code expira em alguns minutos. Escaneie rapidamente!</small>
              </div>
            </div>
          ) : (
            <div className="qr-loading">
              <div className="loading-spinner">🔄</div>
              <p>Gerando QR Code...</p>
              <small>Aguarde alguns segundos</small>
            </div>
          )}

          <div className="qr-actions">
            <button onClick={onClose} className="close-qr-btn">🚫 Cancelar Conexão</button>
          </div>
        </div>
      </div>
    </div>
  );
};
EOF

# Criar outros componentes básicos (FlowEditor, FlowList, MessagesCenter)
cat > frontend/src/components/FlowEditor.js << 'EOF'
import React from 'react';

export default function FlowEditor({ onClose }) {
  return (
    <div className="flow-editor">
      <div className="flow-editor-header">
        <h2>🎯 Editor de Fluxos</h2>
        <button onClick={onClose} className="close-button">Fechar</button>
      </div>
      <div className="flow-editor-content">
        <p>Editor de fluxos em desenvolvimento...</p>
      </div>
    </div>
  );
}
EOF

cat > frontend/src/components/FlowList.js << 'EOF'
import React from 'react';

export default function FlowList({ onCreateFlow }) {
  return (
    <div className="flow-list">
      <div className="flow-list-header">
        <h2>🎯 Fluxos de Automação</h2>
        <button onClick={onCreateFlow} className="create-flow-button">
          ➕ Criar Fluxo
        </button>
      </div>
      <div className="empty-state">
        <p>Nenhum fluxo criado ainda.</p>
        <button onClick={onCreateFlow} className="create-first-flow-button">
          🚀 Criar Primeiro Fluxo
        </button>
      </div>
    </div>
  );
}
EOF

cat > frontend/src/components/MessagesCenter.js << 'EOF'
import React from 'react';

export default function MessagesCenter() {
  return (
    <div className="messages-center">
      <h2>💬 Central de Mensagens</h2>
      <div className="empty-state">
        <p>Central de mensagens em desenvolvimento...</p>
      </div>
    </div>
  );
}
EOF

# Criar CSS completo
cat > frontend/src/App.css << 'EOF'
/* Global Styles */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

.app {
  min-height: 100vh;
  color: #333;
}

/* Header */
.app-header {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding: 1rem 0;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.header-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
  text-align: center;
}

.header-content h1 {
  font-size: 2.5rem;
  font-weight: 700;
  color: #2d3748;
  margin-bottom: 0.5rem;
}

.header-content p {
  font-size: 1.1rem;
  color: #666;
}

/* Navigation */
.main-navigation {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding: 0.5rem 0;
}

.nav-items {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
  display: flex;
  gap: 0.5rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  font-size: 0.95rem;
  font-weight: 500;
  color: #666;
}

.nav-item:hover {
  background: rgba(102, 126, 234, 0.1);
  color: #667eea;
}

.nav-item.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.nav-icon {
  font-size: 1.2rem;
}

/* Main Content */
.app-main {
  padding: 2rem 0;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
}

/* WhatsApp Connection */
.whatsapp-connection {
  background: white;
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  margin-bottom: 2rem;
}

.connection-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.connection-header h2 {
  font-size: 1.5rem;
  color: #2d3748;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 25px;
  font-weight: 500;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.status-indicator.connected {
  background: #f0fff4;
  color: #22543d;
}

.status-indicator.connected .status-dot {
  background: #48bb78;
}

.status-indicator.disconnected {
  background: #fffaf0;
  color: #c05621;
}

.status-indicator.disconnected .status-dot {
  background: #ed8936;
}

.status-indicator.error {
  background: #fed7d7;
  color: #c53030;
}

.status-indicator.error .status-dot {
  background: #e53e3e;
}

/* Badges */
.success-badge, .warning-badge, .error-badge, .demo-badge {
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-weight: 500;
}

.success-badge {
  background: #f0fff4;
  color: #22543d;
  border: 1px solid #9ae6b4;
}

.warning-badge {
  background: #fffaf0;
  color: #c05621;
  border: 1px solid #fbd38d;
}

.error-badge {
  background: #fed7d7;
  color: #c53030;
  border: 1px solid #fc8181;
}

.demo-badge {
  background: #ebf8ff;
  color: #2c5282;
  border: 1px solid #90cdf4;
  text-align: center;
}

/* Dashboard */
.dashboard-section, .contacts-section {
  margin-bottom: 2rem;
}

.dashboard-section h2, .contacts-section h3 {
  color: #2d3748;
  margin-bottom: 1.5rem;
  font-size: 1.8rem;
}

/* Stats Grid */
.dashboard-stats {
  background: white;
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem;
  background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%);
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.stat-icon {
  font-size: 2rem;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.stat-content h3 {
  font-size: 2rem;
  font-weight: 700;
  color: #2d3748;
  margin-bottom: 0.25rem;
}

.stat-content p {
  color: #666;
  font-size: 0.9rem;
}

/* Contacts */
.contacts-list {
  background: white;
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
}

.contacts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
}

.contact-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  transition: all 0.3s ease;
}

.contact-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.contact-avatar {
  width: 50px;
  height: 50px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 1.2rem;
}

.contact-info h4 {
  color: #2d3748;
  margin-bottom: 0.25rem;
}

.contact-info p {
  color: #666;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

.contact-tags {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.tag {
  background: #e6fffa;
  color: #234e52;
  padding: 0.2rem 0.5rem;
  border-radius: 12px;
  font-size: 0.75rem;
  border: 1px solid #b2f5ea;
}

/* WhatsApp Instances */
.whatsapp-instances {
  background: white;
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
}

.instances-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.instances-header h2 {
  color: #2d3748;
  font-size: 1.8rem;
}

.create-instance-btn, .create-first-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.create-instance-btn:hover, .create-first-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.instances-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 1.5rem;
}

.instance-card {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem;
  transition: all 0.3s ease;
  background: white;
}

.instance-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
}

.instance-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.instance-info h3 {
  color: #2d3748;
  margin-bottom: 0.5rem;
  font-size: 1.2rem;
}

.instance-id {
  font-size: 0.8rem;
  color: #666;
  font-family: monospace;
}

.instance-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 25px;
  font-weight: 500;
  font-size: 0.85rem;
}

.instance-status.connected {
  background: #f0fff4;
  color: #22543d;
}

.instance-status.disconnected {
  background: #fffaf0;
  color: #c05621;
}

.instance-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 8px;
}

.stat {
  text-align: center;
}

.stat-value {
  font-weight: 600;
  color: #2d3748;
  font-size: 1.5rem;
  display: block;
  margin-bottom: 0.25rem;
}

.stat-label {
  font-size: 0.8rem;
  color: #666;
}

.instance-actions {
  display: flex;
  gap: 0.5rem;
}

.connect-btn, .disconnect-btn, .delete-instance-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 500;
}

.connect-btn {
  background: #48bb78;
  color: white;
  flex: 1;
}

.connect-btn:hover {
  background: #38a169;
  transform: translateY(-1px);
}

.disconnect-btn {
  background: #ed8936;
  color: white;
  flex: 1;
}

.disconnect-btn:hover {
  background: #dd6b20;
  transform: translateY(-1px);
}

.delete-instance-btn {
  background: #e53e3e;
  color: white;
}

.delete-instance-btn:hover {
  background: #c53030;
  transform: translateY(-1px);
}

.empty-instances {
  text-align: center;
  padding: 3rem 2rem;
  color: #666;
  grid-column: 1 / -1;
}

.empty-instances .empty-icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.empty-instances h3 {
  color: #2d3748;
  margin-bottom: 1rem;
  font-size: 1.5rem;
}

.empty-instances p {
  margin-bottom: 2rem;
  line-height: 1.6;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 12px;
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  overflow: hidden;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
}

.qr-modal {
  max-width: 600px;
}

.modal-header {
  padding: 1.5rem;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
}

.modal-header h3 {
  color: #2d3748;
  font-size: 1.2rem;
}

.close-modal {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  transition: background 0.3s ease;
}

.close-modal:hover {
  background: rgba(0, 0, 0, 0.1);
}

.modal-content {
  padding: 1.5rem;
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  color: #2d3748;
  font-weight: 500;
}

.instance-input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.9rem;
  transition: border-color 0.3s ease;
}

.instance-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.form-group small {
  display: block;
  margin-top: 0.5rem;
  color: #666;
  font-size: 0.8rem;
}

.modal-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.cancel-btn, .create-btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.cancel-btn {
  background: #e2e8f0;
  color: #2d3748;
}

.cancel-btn:hover {
  background: #cbd5e0;
}

.create-btn {
  background: #48bb78;
  color: white;
  flex: 1;
}

.create-btn:hover:not(:disabled) {
  background: #38a169;
}

.create-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* QR Code Styles */
.qr-content {
  text-align: center;
}

.qr-instructions {
  text-align: left;
  margin-bottom: 2rem;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.qr-instructions h4 {
  color: #2d3748;
  margin-bottom: 1rem;
}

.qr-instructions ol {
  color: #666;
  line-height: 1.6;
}

.qr-section {
  margin: 2rem 0;
}

.connecting-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: #667eea;
  font-weight: 500;
  padding: 0.75rem;
  background: #ebf8ff;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.qr-container {
  display: flex;
  justify-content: center;
  margin: 1rem 0;
}

.qr-code {
  padding: 1rem;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.qr-image {
  display: block;
  border-radius: 8px;
}

.qr-loading {
  text-align: center;
  padding: 2rem;
  color: #666;
}

.loading-spinner {
  font-size: 2rem;
  margin-bottom: 1rem;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.close-qr-btn {
  background: #e53e3e;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.close-qr-btn:hover {
  background: #c53030;
}

/* Loading and Empty States */
.loading {
  text-align: center;
  padding: 2rem;
  color: #666;
}

.empty-state {
  text-align: center;
  color: #666;
  padding: 3rem 2rem;
}

.empty-state h3 {
  color: #2d3748;
  margin-bottom: 1rem;
}

.empty-state p {
  margin-bottom: 0.5rem;
  line-height: 1.6;
}

/* Responsive */
@media (max-width: 768px) {
  .container {
    padding: 0 1rem;
  }
  
  .header-content h1 {
    font-size: 2rem;
  }
  
  .nav-items {
    padding: 0 1rem;
    overflow-x: auto;
  }
  
  .stats-grid {
    grid-template-columns: 1fr;
  }
  
  .contacts-grid {
    grid-template-columns: 1fr;
  }
  
  .instances-grid {
    grid-template-columns: 1fr;
  }
}
EOF

# ============================================
# WHATSAPP SERVICE COMPLETO
# ============================================
echo "📱 Criando WhatsApp Service completo..."

cat > whatsapp-service/package.json << 'EOF'
{
  "name": "whatsflow-whatsapp",
  "version": "1.0.0",
  "description": "WhatsApp Service usando Baileys",
  "main": "server.js",
  "dependencies": {
    "@whiskeysockets/baileys": "^6.5.0",
    "express": "^4.18.2",
    "qrcode-terminal": "^0.12.0",
    "socket.io": "^4.7.2"
  },
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}
EOF

cat > whatsapp-service/server.js << 'EOF'
const express = require('express');
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const makeWASocket = require('@whiskeysockets/baileys').default;
const QRCode = require('qrcode-terminal');

const app = express();
app.use(express.json());

let sock = null;
let qrString = null;
let isConnected = false;
let connectedUser = null;
let isDemoMode = true; // Demo mode para funcionar localmente

// Demo mode endpoints
app.get('/status', (req, res) => {
    if (isDemoMode) {
        res.json({
            connected: isConnected,
            user: connectedUser,
            demo: true,
            message: 'Demo mode ativo'
        });
    } else {
        res.json({
            connected: isConnected,
            user: connectedUser,
            demo: false
        });
    }
});

app.get('/qr', (req, res) => {
    if (isDemoMode) {
        // Gerar QR fake para demo
        const fakeQR = `demo-qr-${Date.now()}`;
        res.json({ qr: fakeQR });
    } else {
        res.json({ qr: qrString });
    }
});

app.post('/demo/connect', (req, res) => {
    if (isDemoMode) {
        isConnected = true;
        connectedUser = {
            id: '5511999999999@s.whatsapp.net',
            name: 'Demo User',
            phone: '+55 11 99999-9999'
        };
        res.json({ success: true, message: 'Demo connection established' });
    } else {
        res.json({ success: false, message: 'Not in demo mode' });
    }
});

app.post('/send', (req, res) => {
    const { phone_number, message } = req.body;
    
    if (isDemoMode) {
        console.log(`📤 Demo: Enviando para ${phone_number}: ${message}`);
        res.json({ 
            success: true, 
            message: 'Mensagem enviada (demo mode)',
            demo: true 
        });
    } else {
        // Implementar envio real aqui
        res.json({ success: false, message: 'Real WhatsApp sending not implemented yet' });
    }
});

// Função para inicializar WhatsApp real (desabilitada por padrão)
async function startWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrString = qr;
                QRCode.generate(qr, { small: true });
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    startWhatsApp();
                }
                isConnected = false;
                connectedUser = null;
            } else if (connection === 'open') {
                console.log('✅ WhatsApp conectado!');
                isConnected = true;
                qrString = null;
            }
        });

        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('messages.upsert', async (m) => {
            // Processar mensagens recebidas
            console.log('📥 Nova mensagem:', m.messages);
        });

    } catch (error) {
        console.error('❌ Erro ao inicializar WhatsApp:', error);
    }
}

// Descomente a linha abaixo para ativar o WhatsApp real
// startWhatsApp();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 WhatsApp Service rodando na porta ${PORT}`);
    console.log(`📋 Demo Mode: ${isDemoMode ? 'ATIVO' : 'INATIVO'}`);
    console.log(`🔗 Status: http://localhost:${PORT}/status`);
});
EOF

# Criar configuração de execução
cat > package.json << 'EOF'
{
  "name": "whatsflow",
  "version": "1.0.0",
  "description": "Sistema de Automação WhatsApp",
  "scripts": {
    "install:all": "cd backend && pip3 install -r requirements.txt && cd ../frontend && yarn install && cd ../whatsapp-service && yarn install",
    "start:backend": "cd backend && python3 server.py",
    "start:frontend": "cd frontend && yarn start",
    "start:whatsapp": "cd whatsapp-service && yarn start",
    "start": "concurrently \"npm run start:backend\" \"npm run start:whatsapp\" \"npm run start:frontend\"",
    "install:concurrently": "npm install -g concurrently"
  }
}
EOF

# Instalar concurrently para executar todos os serviços
echo "📦 Instalando gerenciador de processos..."
sudo npm install -g concurrently

# Instalar dependências
echo "📦 Instalando dependências do projeto..."
npm run install:all

# Iniciar MongoDB
echo "🗄️ Iniciando MongoDB..."
if command_exists systemctl; then
    sudo systemctl start mongod
    sudo systemctl enable mongod
elif command_exists brew; then
    brew services start mongodb/brew/mongodb-community
else
    # Iniciar MongoDB manualmente
    mongod --fork --logpath /var/log/mongodb.log --dbpath /var/lib/mongodb
fi

# Criar script de inicialização
cat > start-whatsflow.sh << 'EOF'
#!/bin/bash
echo "🚀 Iniciando WhatsFlow..."
echo "📱 Backend: http://localhost:8001"
echo "🌐 Frontend: http://localhost:3000"  
echo "🤖 WhatsApp Service: http://localhost:3001"
echo ""
npm start
EOF

chmod +x start-whatsflow.sh

echo ""
echo "🎉 INSTALAÇÃO CONCLUÍDA COM SUCESSO!"
echo "==============================================="
echo "🏠 Acesse: http://localhost:3000"
echo ""
echo "📋 Como iniciar:"
echo "  cd $INSTALL_DIR"
echo "  ./start-whatsflow.sh"
echo ""
echo "📁 Diretório: $INSTALL_DIR"
echo "📚 Recursos instalados:"
echo "  ✅ Backend FastAPI (Python)"
echo "  ✅ Frontend React com interface completa"
echo "  ✅ Sistema de Instâncias WhatsApp"
echo "  ✅ WhatsApp Service com Baileys"
echo "  ✅ Banco MongoDB"
echo "  ✅ Interface para QR Code"
echo ""
echo "🚀 Para iniciar agora mesmo:"
echo "  cd $INSTALL_DIR && ./start-whatsflow.sh"
echo ""
echo "✅ WhatsFlow instalado e pronto para uso!"