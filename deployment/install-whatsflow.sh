#!/bin/bash

# WhatsFlow - Instalador Automático
# GitHub: https://github.com/jocilejr/testes
# Versão: 1.0.0

set -e

echo "🚀 WhatsFlow - Instalador Automático"
echo "===================================="
echo "📦 Repositório: https://github.com/jocilejr/testes"
echo ""

# Verificar se não está executando como root
if [ "$EUID" -eq 0 ]; then
    echo "❌ NÃO execute como root. Use um usuário normal com sudo."
    exit 1
fi

# Verificar sistema
if ! command -v apt &> /dev/null; then
    echo "❌ Este instalador é para Ubuntu/Debian com APT."
    exit 1
fi

# Solicitar informações
read -p "🌐 Digite seu domínio (ex: whatsflow.seusite.com): " DOMAIN
read -p "📧 Digite seu email para SSL: " EMAIL

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "❌ Domínio e email são obrigatórios!"
    exit 1
fi

echo ""
echo "🔧 Instalando WhatsFlow para: $DOMAIN"
echo "📧 SSL será configurado para: $EMAIL"
echo ""
read -p "🚀 Pressione ENTER para continuar ou Ctrl+C para cancelar..."

# ==========================================
# FASE 1: INSTALAR DEPENDÊNCIAS
# ==========================================
echo ""
echo "📦 FASE 1: Instalando dependências do sistema..."

sudo apt update
sudo apt upgrade -y
sudo apt install -y curl wget git nginx certbot python3-certbot-nginx build-essential

# Node.js 20
echo "📦 Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Python
sudo apt install -y python3 python3-pip python3-venv

# MongoDB
echo "📦 Instalando MongoDB..."
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt update
sudo apt install -y mongodb-org

# Iniciar serviços
sudo systemctl start mongod
sudo systemctl enable mongod

# PM2
sudo npm install -g pm2

echo "✅ FASE 1 concluída!"

# ==========================================
# FASE 2: BAIXAR PROJETO DO GITHUB
# ==========================================
echo ""
echo "📁 FASE 2: Baixando projeto do GitHub..."

# Criar diretório
sudo mkdir -p /var/www/whatsflow
sudo chown $USER:$USER /var/www/whatsflow
cd /var/www/whatsflow

# Clonar repositório
echo "📥 Clonando repositório..."
git clone https://github.com/jocilejr/testes.git .

# Se não tiver os arquivos, criar estrutura básica
if [ ! -f "backend/server.py" ]; then
    echo "📝 Criando arquivos base do projeto..."
    
    mkdir -p backend frontend/src whatsapp-service
    
    # Backend básico
    cat > backend/requirements.txt << 'EOF'
fastapi==0.104.1
uvicorn==0.24.0
motor==3.3.2
python-dotenv==1.0.0
pydantic==2.5.0
python-multipart==0.0.6
httpx==0.25.2
EOF

    # WhatsApp Service básico
    cat > whatsapp-service/package.json << 'EOF'
{
  "name": "whatsapp-service",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "@whiskeysockets/baileys": "^6.5.0",
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "axios": "^1.6.0",
    "fs-extra": "^11.1.1"
  }
}
EOF

    # Frontend básico
    cat > frontend/package.json << 'EOF'
{
  "name": "whatsflow-frontend",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "5.0.1",
    "axios": "^1.6.0"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build"
  }
}
EOF
fi

echo "✅ FASE 2 concluída!"

# ==========================================
# FASE 3: CONFIGURAR AMBIENTE
# ==========================================
echo ""
echo "⚙️ FASE 3: Configurando ambiente..."

# Backend .env
cat > backend/.env << EOF
MONGO_URL=mongodb://localhost:27017/whatsflow
DB_NAME=whatsflow
CORS_ORIGINS=https://$DOMAIN,http://localhost:3000
EOF

# Frontend .env
cat > frontend/.env << EOF
REACT_APP_BACKEND_URL=https://$DOMAIN
EOF

# Instalar dependências Backend
if [ -d "backend" ]; then
    echo "🐍 Configurando Backend..."
    cd backend
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    deactivate
    cd ..
fi

# Instalar dependências WhatsApp Service
if [ -d "whatsapp-service" ]; then
    echo "📱 Configurando WhatsApp Service..."
    cd whatsapp-service
    npm install
    cd ..
fi

# Instalar dependências Frontend
if [ -d "frontend" ]; then
    echo "⚛️ Configurando Frontend..."
    cd frontend
    npm install
    cd ..
fi

echo "✅ FASE 3 concluída!"

# ==========================================
# FASE 4: CONFIGURAR NGINX
# ==========================================
echo ""
echo "🌐 FASE 4: Configurando Nginx..."

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

sudo ln -sf /etc/nginx/sites-available/whatsflow /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# Configurar SSL
echo "🔒 Configurando SSL..."
sudo certbot --nginx -d $DOMAIN --email $EMAIL --agree-tos --non-interactive

echo "✅ FASE 4 concluída!"

# ==========================================
# FASE 5: CONFIGURAR PM2
# ==========================================
echo ""
echo "⚙️ FASE 5: Configurando PM2..."

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

# Iniciar serviços
echo "🚀 Iniciando serviços..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo "✅ FASE 5 concluída!"

# ==========================================
# INSTALAÇÃO CONCLUÍDA
# ==========================================
echo ""
echo "🎉 WHATSFLOW INSTALADO COM SUCESSO!"
echo "=================================="
echo ""
echo "🌐 Acesse: https://$DOMAIN"
echo ""
echo "✅ Serviços rodando:"
echo "   • Backend: http://localhost:8001"
echo "   • Frontend: http://localhost:3000"  
echo "   • WhatsApp: http://localhost:3001"
echo ""
echo "🔧 Comandos úteis:"
echo "   • Status: pm2 status"
echo "   • Logs: pm2 logs"
echo "   • Reiniciar: pm2 restart all"
echo ""
echo "📱 Para conectar WhatsApp:"
echo "   1. Acesse https://$DOMAIN"
echo "   2. Vá em 'Mensagens'"
echo "   3. Escaneie QR Code ou use modo demo"
echo ""
echo "📦 Projeto GitHub: https://github.com/jocilejr/testes"
echo ""
echo "🚀 WhatsFlow funcionando!"