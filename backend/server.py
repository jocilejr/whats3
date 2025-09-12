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
    device_id: str = "whatsapp_1"  # Identificador do dispositivo
    device_name: str = "WhatsApp 1"  # Nome amigável do dispositivo
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_message_at: Optional[datetime] = None
    tags: List[str] = []
    is_active: bool = True

class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    contact_id: str
    phone_number: str
    device_id: str = "whatsapp_1"  # Identificador do dispositivo
    device_name: str = "WhatsApp 1"  # Nome amigável do dispositivo
    message: str
    direction: str  # 'incoming' or 'outgoing'
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
    
    # Buscar contato baseado em phone_number E device_id
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
        # Update last message time
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
            
            # Log webhook response
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
        
        # Update stats for each instance
        for instance in instances:
            instance['id'] = str(instance.get('_id'))
            if '_id' in instance:
                del instance['_id']
            
            # Count contacts for this device
            contacts_count = await db.contacts.count_documents({
                "device_id": instance.get('device_id')
            })
            instance['contacts_count'] = contacts_count
            
            # Count messages today for this device
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
        # Get instance from database
        instance = await db.whatsapp_instances.find_one({"id": instance_id})
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        # For now, just return success - actual QR generation would happen through whatsapp-service
        return {"success": True, "message": "Connection initiated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/whatsapp/instances/{instance_id}/qr")
async def get_instance_qr(instance_id: str):
    """Get QR code for specific instance"""
    try:
        # Get instance from database
        instance = await db.whatsapp_instances.find_one({"id": instance_id})
        if not instance:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        # For demo purposes, return a fake QR code
        # In production, this would communicate with whatsapp-service
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
        
        # Get or create contact
        contact = await get_or_create_contact(phone_number, push_name, device_id, device_name)
        
        # Save incoming message
        await save_message(
            contact['id'], 
            phone_number, 
            message_text, 
            'incoming',
            device_id,
            device_name,
            message_data.message_id
        )
        
        # Simple auto-reply for now
        reply = f"Mensagem recebida via {device_name}: '{message_text}'"
        
        # Save outgoing message
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

@api_router.post("/whatsapp/qr-update")
async def qr_update(qr_data: QRUpdate):
    """Receive QR code updates from WhatsApp service"""
    return {"status": "received"}

@api_router.post("/whatsapp/connection-update")
async def connection_update(conn_data: ConnectionUpdate):
    """Receive connection status updates from WhatsApp service"""
    return {"status": "received"}

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
    
    # Add "all" option
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
        
        # Count new contacts today
        new_contacts_today = await db.contacts.count_documents({
            "created_at": {"$gte": today}
        })
        
        # Count total active conversations
        active_conversations = await db.contacts.count_documents({
            "is_active": True
        })
        
        # Count messages today
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
        # Add background task to trigger webhook
        background_tasks.add_task(
            trigger_webhook_async,
            webhook_trigger.webhook_url,
            webhook_trigger.data
        )
        
        # Log webhook trigger
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
        # Get contact details
        contact = await db.contacts.find_one({"_id": macro.contact_id})
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
        
        # Prepare webhook data
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
        
        # Add background task to trigger webhook
        background_tasks.add_task(
            trigger_webhook_async,
            macro.webhook_url,
            webhook_data
        )
        
        # Log macro trigger
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

# Configure CORS using ALLOWED_ORIGINS env var (comma-separated)
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
if not allowed_origins:
    allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
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