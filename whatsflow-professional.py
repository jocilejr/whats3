#!/usr/bin/env python3
"""
WhatsFlow Professional - Sistema Completo com WebSocket
Sistema de Automação WhatsApp com interface profissional
"""

import json
import sqlite3
import uuid
from datetime import datetime, timezone
import os
import subprocess
import sys
import threading
import time
import signal
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse
import urllib.request
import logging
from typing import Set, Dict, Any

# Try to import websockets, fallback gracefully if not available
try:
    import asyncio
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    print("⚠️ WebSocket não disponível - executando sem tempo real")

# Configurações
DB_FILE = "whatsflow.db"
PORT = 8889
WEBSOCKET_PORT = 8890

# Try to discover a reachable Baileys service. The environment variable takes
# precedence, but we also try common local addresses.
DEFAULT_BAILEYS_URLS = [
    os.environ.get("API_BASE_URL"),
    "http://78.46.250.112:3002",
    "http://127.0.0.1:3002",
    "http://localhost:3002",
]


def resolve_baileys_url() -> str:
    """Return the first reachable Baileys service URL."""
    for url in [u for u in DEFAULT_BAILEYS_URLS if u]:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=3) as response:
                if response.status == 200:
                    print(f"✅ Baileys service disponível em {url}")
                    return url
                else:
                    print(
                        f"⚠️ Baileys service respondeu com status {response.status} ({url}/health)"
                    )
        except Exception as e:
            print(f"⚠️ Falha ao acessar Baileys em {url}/health: {e}")
    print("❌ Baileys service não acessível em nenhuma URL. Usando http://localhost:3002")
    return "http://localhost:3002"


API_BASE_URL = resolve_baileys_url()

# WebSocket clients management
websocket_clients: Set[websockets.WebSocketServerProtocol] = set()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# HTML da aplicação será carregado de arquivo separado
def load_html_content():
    """Carrega o conteúdo HTML da interface profissional"""
    try:
        with open('/app/whatsflow-professional.html', 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return "<h1>Interface em desenvolvimento...</h1>"

# Database setup
def init_db():
    """Initialize SQLite database with WAL mode for better concurrency"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Enable WAL mode for better concurrent access
    cursor.execute("PRAGMA journal_mode = WAL")
    cursor.execute("PRAGMA synchronous = NORMAL")
    cursor.execute("PRAGMA cache_size = 1000")
    cursor.execute("PRAGMA temp_store = MEMORY")
    cursor.execute("PRAGMA mmap_size = 268435456")  # 256MB
    
    # Instances table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS instances (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            connected INTEGER DEFAULT 0,
            user_name TEXT,
            user_id TEXT,
            contacts_count INTEGER DEFAULT 0,
            messages_today INTEGER DEFAULT 0,
            created_at TEXT
        )
    """)
    
    # Contacts table (updated with instance_id)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            instance_id TEXT DEFAULT 'default',
            avatar_url TEXT,
            created_at TEXT
        )
    """)
    
    # Messages table (updated with instance support)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            contact_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            message TEXT NOT NULL,
            direction TEXT NOT NULL,
            instance_id TEXT DEFAULT 'default',
            message_type TEXT DEFAULT 'text',
            whatsapp_id TEXT,
            created_at TEXT
        )
    """)
    
    # Webhooks table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS webhooks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            created_at TEXT
        )
    """)
    
    # Chats table (for conversation management)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            contact_phone TEXT NOT NULL,
            contact_name TEXT NOT NULL,
            instance_id TEXT NOT NULL,
            last_message TEXT,
            last_message_time TEXT,
            unread_count INTEGER DEFAULT 0,
            created_at TEXT
        )
    """)
    
    # Flows table (new for automation flows)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS flows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            nodes TEXT NOT NULL,
            edges TEXT NOT NULL,
            active INTEGER DEFAULT 0,
            instance_id TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    
    conn.commit()
    conn.close()
    print("✅ Banco de dados inicializado com WebSocket support")

# WebSocket Server
async def websocket_handler(websocket, path):
    """Handle WebSocket connections"""
    websocket_clients.add(websocket)
    logger.info(f"📱 Cliente WebSocket conectado. Total: {len(websocket_clients)}")
    
    try:
        await websocket.wait_closed()
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        websocket_clients.discard(websocket)
        logger.info(f"📱 Cliente WebSocket desconectado. Total: {len(websocket_clients)}")

async def broadcast_message(message_data: Dict[str, Any]):
    """Broadcast message to all connected WebSocket clients"""
    if not websocket_clients:
        return
    
    message = json.dumps(message_data)
    disconnected_clients = set()
    
    for client in websocket_clients:
        try:
            await client.send(message)
        except websockets.exceptions.ConnectionClosed:
            disconnected_clients.add(client)
        except Exception as e:
            logger.error(f"❌ Erro ao enviar mensagem WebSocket: {e}")
            disconnected_clients.add(client)
    
    # Remove disconnected clients
    for client in disconnected_clients:
        websocket_clients.discard(client)

def start_websocket_server():
    """Start WebSocket server in a separate thread"""
    def run_websocket():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        start_server = websockets.serve(
            websocket_handler, 
            "localhost", 
            WEBSOCKET_PORT,
            ping_interval=30,
            ping_timeout=10
        )
        
        logger.info(f"🔌 WebSocket server iniciado na porta {WEBSOCKET_PORT}")
        loop.run_until_complete(start_server)
        loop.run_forever()
    
    websocket_thread = threading.Thread(target=run_websocket, daemon=True)
    websocket_thread.start()
    return websocket_thread

# HTTP Request Handler será implementado em arquivo separado para melhor organização
class WhatsFlowHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default HTTP logging
        pass
    
    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(load_html_content().encode())
            
        elif self.path.startswith('/api/'):
            self.handle_api_request()
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self):
        if self.path.startswith('/api/'):
            self.handle_api_request()
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_DELETE(self):
        if self.path.startswith('/api/'):
            self.handle_api_request()
        else:
            self.send_response(404)
            self.end_headers()
    
    def handle_api_request(self):
        """Handle API requests with WebSocket integration"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length) if content_length > 0 else b''
            
            if self.path == '/api/instances' and self.command == 'GET':
                self.handle_get_instances()
            elif self.path == '/api/instances' and self.command == 'POST':
                self.handle_create_instance(post_data)
            elif self.path.startswith('/api/instances/') and self.command == 'DELETE':
                instance_id = self.path.split('/')[-1]
                self.handle_delete_instance(instance_id)
            elif self.path.startswith('/api/instances/') and self.path.endswith('/connect'):
                instance_id = self.path.split('/')[-2]
                self.handle_connect_instance(instance_id)
            elif self.path.startswith('/api/whatsapp/status'):
                parts = self.path.split('/')
                instance_id = parts[-1] if len(parts) > 4 else None
                self.handle_whatsapp_status(instance_id)
            elif self.path.startswith('/api/whatsapp/qr'):
                parts = self.path.split('/')
                instance_id = parts[-1] if len(parts) > 4 else None
                self.handle_whatsapp_qr(instance_id)
            elif self.path == '/api/stats':
                self.handle_get_stats()
            elif self.path == '/api/contacts':
                self.handle_get_contacts()
            elif self.path == '/api/chats':
                self.handle_get_chats()
            elif self.path == '/api/messages':
                self.handle_get_messages()
            elif self.path.startswith('/api/messages/send/'):
                instance_id = self.path.split('/')[-1]
                self.handle_send_message(instance_id, post_data)
            elif self.path == '/api/messages/receive':
                self.handle_receive_message(post_data)
            elif self.path == '/api/chats/import':
                self.handle_import_chats(post_data)
            elif self.path == '/api/whatsapp/connected':
                self.handle_whatsapp_connected(post_data)
            elif self.path == '/api/whatsapp/disconnected':
                self.handle_whatsapp_disconnected(post_data)
            elif self.path == '/api/webhooks/send':
                self.handle_send_webhook(post_data)
            elif self.path == '/api/flows':
                if self.command == 'GET':
                    self.handle_get_flows()
                elif self.command == 'POST':
                    self.handle_create_flow(post_data)
            else:
                self.send_response(404)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode())
                
        except Exception as e:
            logger.error(f"❌ Erro na API: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    # API Methods implementation...
    def handle_get_instances(self):
        """Get all instances"""
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT i.*, 
                   COUNT(DISTINCT c.id) as contacts_count,
                   COUNT(DISTINCT m.id) as messages_today
            FROM instances i
            LEFT JOIN contacts c ON i.id = c.instance_id
            LEFT JOIN messages m ON i.id = m.instance_id 
                AND date(m.created_at) = date('now')
            GROUP BY i.id
            ORDER BY i.created_at DESC
        """)
        
        instances = []
        for row in cursor.fetchall():
            instances.append({
                'id': row[0],
                'name': row[1],
                'connected': bool(row[2]),
                'user_name': row[3],
                'user_id': row[4],
                'contacts_count': row[7] or 0,
                'messages_today': row[8] or 0,
                'created_at': row[6]
            })
        
        conn.close()
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(instances).encode())

    def handle_create_instance(self, post_data):
        """Create new instance"""
        try:
            data = json.loads(post_data.decode())
            instance_id = str(uuid.uuid4())[:8]
            
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO instances (id, name, created_at)
                VALUES (?, ?, ?)
            """, (instance_id, data['name'], datetime.now(timezone.utc).isoformat()))
            
            conn.commit()
            conn.close()
            
            self.send_response(201)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'instance_id': instance_id,
                'message': f'Instância "{data["name"]}" criada com sucesso'
            }).encode())
            
        except Exception as e:
            logger.error(f"❌ Erro ao criar instância: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_delete_instance(self, instance_id):
        """Delete instance"""
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM instances WHERE id = ?", (instance_id,))
        cursor.execute("DELETE FROM contacts WHERE instance_id = ?", (instance_id,))
        cursor.execute("DELETE FROM messages WHERE instance_id = ?", (instance_id,))
        cursor.execute("DELETE FROM chats WHERE instance_id = ?", (instance_id,))
        
        conn.commit()
        conn.close()
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({'success': True}).encode())

    def handle_connect_instance(self, instance_id):
        """Connect instance to WhatsApp"""
        try:
            # Forward request to Baileys service
            import urllib.request
            
            req = urllib.request.Request(
                f'{API_BASE_URL}/connect/{instance_id}',
                method='POST'
            )
            
            try:
                with urllib.request.urlopen(req) as response:
                    result = json.loads(response.read().decode())
                    
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                    
            except urllib.error.URLError:
                self.send_response(503)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': 'Baileys service não disponível'
                }).encode())
                
        except Exception as e:
            logger.error(f"❌ Erro ao conectar instância: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_whatsapp_status(self, instance_id=None):
        """Get WhatsApp connection status"""
        try:
            url = f'{API_BASE_URL}/status'
            if instance_id:
                url += f'/{instance_id}'
            
            import urllib.request
            req = urllib.request.Request(url)
            
            try:
                with urllib.request.urlopen(req) as response:
                    result = json.loads(response.read().decode())
                    
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                    
            except urllib.error.URLError:
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'connected': False,
                    'connecting': False,
                    'user': None
                }).encode())
                
        except Exception as e:
            logger.error(f"❌ Erro ao verificar status: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def handle_whatsapp_qr(self, instance_id=None):
        """Get QR code for WhatsApp connection"""
        try:
            url = f'{API_BASE_URL}/qr'
            if instance_id:
                url += f'/{instance_id}'
            
            import urllib.request
            req = urllib.request.Request(url)
            
            try:
                with urllib.request.urlopen(req) as response:
                    result = json.loads(response.read().decode())
                    
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                    
            except urllib.error.URLError:
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'qr': None,
                    'connected': False
                }).encode())
                
        except Exception as e:
            logger.error(f"❌ Erro ao obter QR code: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def handle_get_stats(self):
        """Get system statistics"""
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Get contacts count
        cursor.execute("SELECT COUNT(*) FROM contacts")
        contacts_count = cursor.fetchone()[0]
        
        # Get messages count
        cursor.execute("SELECT COUNT(*) FROM messages")
        messages_count = cursor.fetchone()[0]
        
        # Get conversations count
        cursor.execute("SELECT COUNT(DISTINCT contact_phone, instance_id) FROM messages")
        conversations_count = cursor.fetchone()[0]
        
        # Get instances count
        cursor.execute("SELECT COUNT(*) FROM instances")
        instances_count = cursor.fetchone()[0]
        
        conn.close()
        
        stats = {
            'contacts_count': contacts_count,
            'messages_count': messages_count,
            'conversations_count': conversations_count,
            'instances_count': instances_count
        }
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(stats).encode())

    def handle_get_contacts(self):
        """Get all contacts"""
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM contacts 
            ORDER BY created_at DESC
        """)
        
        contacts = []
        for row in cursor.fetchall():
            contacts.append({
                'id': row[0],
                'name': row[1],
                'phone': row[2],
                'instance_id': row[3],
                'avatar_url': row[4],
                'created_at': row[5]
            })
        
        conn.close()
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(contacts).encode())

    def handle_get_chats(self):
        """Get chats/conversations"""
        query_params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        instance_id = query_params.get('instance_id', [None])[0]
        
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        if instance_id:
            cursor.execute("""
                SELECT * FROM chats 
                WHERE instance_id = ?
                ORDER BY last_message_time DESC, created_at DESC
            """, (instance_id,))
        else:
            cursor.execute("""
                SELECT * FROM chats 
                ORDER BY last_message_time DESC, created_at DESC
            """)
        
        chats = []
        for row in cursor.fetchall():
            chats.append({
                'id': row[0],
                'contact_phone': row[1],
                'contact_name': row[2],
                'instance_id': row[3],
                'last_message': row[4],
                'last_message_time': row[5],
                'unread_count': row[6],
                'created_at': row[7]
            })
        
        conn.close()
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(chats).encode())

    def handle_get_messages(self):
        """Get messages for a conversation"""
        query_params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        phone = query_params.get('phone', [None])[0]
        instance_id = query_params.get('instance_id', [None])[0]
        
        if not phone or not instance_id:
            self.send_response(400)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Phone and instance_id required'}).encode())
            return
        
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM messages 
            WHERE phone = ? AND instance_id = ?
            ORDER BY created_at ASC
        """, (phone, instance_id))
        
        messages = []
        for row in cursor.fetchall():
            messages.append({
                'id': row[0],
                'contact_name': row[1],
                'phone': row[2],
                'message': row[3],
                'direction': row[4],
                'instance_id': row[5],
                'message_type': row[6],
                'whatsapp_id': row[7],
                'created_at': row[8]
            })
        
        conn.close()
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(messages).encode())

    def handle_send_message(self, instance_id, post_data):
        """Send message via WhatsApp"""
        try:
            data = json.loads(post_data.decode())
            
            # Forward to Baileys service
            import urllib.request
            
            send_data = json.dumps({
                'to': data['to'],
                'message': data['message'],
                'instanceId': instance_id
            }).encode()
            
            req = urllib.request.Request(
                f'{API_BASE_URL}/send',
                data=send_data,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            
            try:
                with urllib.request.urlopen(req) as response:
                    result = json.loads(response.read().decode())
                    
                    # Save message to database
                    conn = sqlite3.connect(DB_FILE)
                    cursor = conn.cursor()
                    
                    message_id = str(uuid.uuid4())
                    cursor.execute("""
                        INSERT INTO messages (id, contact_name, phone, message, direction, instance_id, created_at)
                        VALUES (?, ?, ?, ?, 'outgoing', ?, ?)
                    """, (message_id, data['to'], data['to'], data['message'], instance_id, 
                          datetime.now(timezone.utc).isoformat()))
                    
                    # Update or create chat
                    cursor.execute("""
                        INSERT OR REPLACE INTO chats (id, contact_phone, contact_name, instance_id, last_message, last_message_time, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (f"{data['to']}_{instance_id}", data['to'], data['to'], instance_id, 
                          data['message'], datetime.now(timezone.utc).isoformat(), 
                          datetime.now(timezone.utc).isoformat()))
                    
                    conn.commit()
                    conn.close()
                    
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())
                    
            except urllib.error.URLError:
                self.send_response(503)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': 'Baileys service não disponível'
                }).encode())
                
        except Exception as e:
            logger.error(f"❌ Erro ao enviar mensagem: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_receive_message(self, post_data):
        """Handle incoming message from Baileys"""
        try:
            data = json.loads(post_data.decode())
            
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            
            # Extract phone number and clean it
            phone = data['from'].split('@')[0]
            contact_name = phone  # Default to phone number
            
            # Try to get contact name from existing contacts
            cursor.execute("SELECT name FROM contacts WHERE phone = ?", (phone,))
            existing_contact = cursor.fetchone()
            if existing_contact and existing_contact[0] and existing_contact[0] != phone:
                contact_name = existing_contact[0]
            
            # Save message
            message_id = str(uuid.uuid4())
            cursor.execute("""
                INSERT INTO messages (id, contact_name, phone, message, direction, instance_id, message_type, whatsapp_id, created_at)
                VALUES (?, ?, ?, ?, 'incoming', ?, ?, ?, ?)
            """, (message_id, contact_name, phone, data['message'], data['instanceId'], 
                  data.get('messageType', 'text'), data.get('messageId'), data['timestamp']))
            
            # Create or update contact
            cursor.execute("""
                INSERT OR REPLACE INTO contacts (id, name, phone, instance_id, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (f"{phone}_{data['instanceId']}", contact_name, phone, data['instanceId'], 
                  datetime.now(timezone.utc).isoformat()))
            
            # Update or create chat
            cursor.execute("""
                INSERT OR REPLACE INTO chats (id, contact_phone, contact_name, instance_id, last_message, last_message_time, unread_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT unread_count FROM chats WHERE id = ?), 0) + 1, ?)
            """, (f"{phone}_{data['instanceId']}", phone, contact_name, data['instanceId'], 
                  data['message'], data['timestamp'], f"{phone}_{data['instanceId']}", 
                  datetime.now(timezone.utc).isoformat()))
            
            conn.commit()
            conn.close()
            
            # Broadcast via WebSocket
            asyncio.create_task(broadcast_message({
                'type': 'new_message',
                'message': {
                    'id': message_id,
                    'contact_name': contact_name,
                    'phone': phone,
                    'message': data['message'],
                    'direction': 'incoming',
                    'instance_id': data['instanceId'],
                    'created_at': data['timestamp']
                }
            }))
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
            
        except Exception as e:
            logger.error(f"❌ Erro ao processar mensagem recebida: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_import_chats(self, post_data):
        """Handle chat import from Baileys"""
        try:
            data = json.loads(post_data.decode())
            
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            
            for chat in data['chats']:
                if not chat.get('id'):
                    continue
                    
                phone = chat['id'].split('@')[0]
                name = chat.get('name', phone)
                
                # Use WhatsApp name if available, otherwise phone number
                if name and name != phone and not name.startswith('+'):
                    contact_name = name
                else:
                    contact_name = phone
                
                # Create or update contact with real WhatsApp name
                cursor.execute("""
                    INSERT OR REPLACE INTO contacts (id, name, phone, instance_id, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (f"{phone}_{data['instanceId']}", contact_name, phone, data['instanceId'], 
                      datetime.now(timezone.utc).isoformat()))
                
                # Create chat entry
                last_message = "Nova conversa importada"
                if 'lastMessage' in chat and chat['lastMessage']:
                    if 'message' in chat['lastMessage']:
                        last_message = chat['lastMessage']['message'][:100]
                
                cursor.execute("""
                    INSERT OR REPLACE INTO chats (id, contact_phone, contact_name, instance_id, last_message, last_message_time, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (f"{phone}_{data['instanceId']}", phone, contact_name, data['instanceId'], 
                      last_message, datetime.now(timezone.utc).isoformat(), 
                      datetime.now(timezone.utc).isoformat()))
            
            conn.commit()
            conn.close()
            
            # Broadcast contact update via WebSocket
            asyncio.create_task(broadcast_message({
                'type': 'contact_updated',
                'contact': {
                    'instance_id': data['instanceId'],
                    'batch': data.get('batchNumber', 1),
                    'total_batches': data.get('totalBatches', 1)
                }
            }))
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
            
        except Exception as e:
            logger.error(f"❌ Erro ao importar conversas: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_whatsapp_connected(self, post_data):
        """Handle WhatsApp connection notification"""
        try:
            data = json.loads(post_data.decode())
            
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE instances 
                SET connected = 1, user_name = ?, user_id = ?
                WHERE id = ?
            """, (data['user']['name'], data['user']['id'], data['instanceId']))
            
            conn.commit()
            conn.close()
            
            # Broadcast via WebSocket
            asyncio.create_task(broadcast_message({
                'type': 'instance_connected',
                'instanceId': data['instanceId'],
                'user': data['user']
            }))
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
            
        except Exception as e:
            logger.error(f"❌ Erro ao processar conexão: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_whatsapp_disconnected(self, post_data):
        """Handle WhatsApp disconnection notification"""
        try:
            data = json.loads(post_data.decode())
            
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE instances 
                SET connected = 0, user_name = NULL, user_id = NULL
                WHERE id = ?
            """, (data['instanceId'],))
            
            conn.commit()
            conn.close()
            
            # Broadcast via WebSocket
            asyncio.create_task(broadcast_message({
                'type': 'instance_disconnected',
                'instanceId': data['instanceId'],
                'reason': data.get('reason')
            }))
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
            
        except Exception as e:
            logger.error(f"❌ Erro ao processar desconexão: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_send_webhook(self, post_data):
        """Send webhook"""
        try:
            data = json.loads(post_data.decode())
            
            import urllib.request
            
            webhook_data = json.dumps(data['data']).encode()
            req = urllib.request.Request(
                data['url'],
                data=webhook_data,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            
            with urllib.request.urlopen(req) as response:
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True}).encode())
                
        except Exception as e:
            logger.error(f"❌ Erro ao enviar webhook: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_get_flows(self):
        """Get all flows"""
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM flows 
            ORDER BY created_at DESC
        """)
        
        flows = []
        for row in cursor.fetchall():
            flows.append({
                'id': row[0],
                'name': row[1],
                'description': row[2],
                'nodes': json.loads(row[3]) if row[3] else [],
                'edges': json.loads(row[4]) if row[4] else [],
                'active': bool(row[5]),
                'instance_id': row[6],
                'created_at': row[7],
                'updated_at': row[8]
            })
        
        conn.close()
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(flows).encode())

    def handle_create_flow(self, post_data):
        """Create new flow"""
        try:
            data = json.loads(post_data.decode())
            flow_id = str(uuid.uuid4())
            
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO flows (id, name, description, nodes, edges, active, instance_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (flow_id, data['name'], data.get('description', ''), 
                  json.dumps(data.get('nodes', [])), json.dumps(data.get('edges', [])),
                  data.get('active', False), data.get('instance_id'),
                  datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()))
            
            conn.commit()
            conn.close()
            
            self.send_response(201)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'flow_id': flow_id,
                'message': f'Fluxo "{data["name"]}" criado com sucesso'
            }).encode())
            
        except Exception as e:
            logger.error(f"❌ Erro ao criar fluxo: {e}")
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

# Baileys Service Manager (simplified version)
class BaileysManager:
    def __init__(self):
        self.process = None
        self.is_running = False

    def start_baileys(self):
        """Start Baileys service if available"""
        if check_service_health(API_BASE_URL):
            return True
        print("⚠️ Baileys service não encontrado - algumas funcionalidades podem não estar disponíveis")
        return False

def check_service_health(api_base_url: str) -> bool:
    """Check if the Baileys service is reachable."""
    url = f"{api_base_url}/health"
    try:
        import urllib.request
        with urllib.request.urlopen(url, timeout=3) as response:
            if response.status == 200:
                print(f"✅ Baileys service disponível em {api_base_url}")
                return True
            else:
                print(f"⚠️ Baileys service respondeu com status {response.status} ({url})")
                return False
    except Exception as e:
        print(f"❌ Não foi possível acessar Baileys em {url}: {e}")
        return False

def main():
    """Main function to start WhatsFlow Professional"""
    print("🚀 Iniciando WhatsFlow Professional...")
    
    # Initialize database
    init_db()
    
    # Start WebSocket server
    websocket_thread = start_websocket_server()
    
    # Start Baileys service manager
    baileys_manager = BaileysManager()
    baileys_manager.start_baileys()
    
    # Start HTTP server
    try:
        server = HTTPServer(('0.0.0.0', PORT), WhatsFlowHandler)
        print(f"✅ WhatsFlow Professional rodando em:")
        print(f"   📱 Interface: http://localhost:{PORT}")
        print(f"   🔌 WebSocket: ws://localhost:{WEBSOCKET_PORT}")
        print(f"   📡 Baileys: {API_BASE_URL}")
        print("\n🎉 Sistema pronto para uso!")
        print("   • WebSocket para atualizações em tempo real")
        print("   • Design profissional estilo WhatsApp Web")
        print("   • Nomes reais do WhatsApp")
        print("   • Interface otimizada para produção")
        
        server.serve_forever()
        
    except KeyboardInterrupt:
        print("\n🛑 Parando WhatsFlow Professional...")
        server.server_close()
        
    except Exception as e:
        print(f"❌ Erro ao iniciar servidor: {e}")

if __name__ == "__main__":
    main()