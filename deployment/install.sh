#!/bin/bash

echo "🚀 WhatsFlow - Instalação Automatizada"
echo "======================================"

# Verificar se está executando como root
if [ "$EUID" -eq 0 ]; then
    echo "❌ Não execute como root. Use um usuário normal com sudo."
    exit 1
fi

# Configurar variáveis
DOMAIN=""
EMAIL=""

# Solicitar informações do usuário
read -p "📍 Digite seu domínio (ex: whatsflow.seusite.com): " DOMAIN
read -p "📧 Digite seu email para SSL: " EMAIL

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "❌ Domínio e email são obrigatórios!"
    exit 1
fi

echo "🔧 Iniciando instalação para $DOMAIN..."

# Atualizar sistema
echo "📦 Atualizando sistema..."
sudo apt update && sudo apt upgrade -y

# Instalar dependências
echo "📦 Instalando dependências..."
sudo apt install -y curl wget git nginx certbot python3-certbot-nginx build-essential

# Instalar Node.js 20
echo "📦 Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar Python e pip
echo "📦 Instalando Python..."
sudo apt install -y python3 python3-pip python3-venv

# Instalar MongoDB
echo "📦 Instalando MongoDB..."
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt update
sudo apt install -y mongodb-org

# Iniciar MongoDB
echo "🔧 Configurando MongoDB..."
sudo systemctl start mongod
sudo systemctl enable mongod

# Criar usuário MongoDB para WhatsFlow
mongo <<EOF
use whatsflow
db.createUser({
  user: "whatsflow",
  pwd: "$(openssl rand -base64 32)",
  roles: ["readWrite"]
})
EOF

# Criar diretório do projeto
echo "📁 Criando estrutura do projeto..."
sudo mkdir -p /var/www/whatsflow
sudo chown $USER:$USER /var/www/whatsflow
cd /var/www/whatsflow

# Configurar Nginx
echo "🌐 Configurando Nginx..."
sudo tee /etc/nginx/sites-available/whatsflow <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    # Frontend (React)
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

    # Backend API
    location /api {
        proxy_pass http://localhost:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Ativar site
sudo ln -sf /etc/nginx/sites-available/whatsflow /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Configurar SSL
echo "🔒 Configurando SSL..."
sudo certbot --nginx -d $DOMAIN --email $EMAIL --agree-tos --no-eff-email

# Criar serviços systemd
echo "⚙️ Criando serviços systemd..."

# Serviço Backend
sudo tee /etc/systemd/system/whatsflow-backend.service <<EOF
[Unit]
Description=WhatsFlow Backend
After=network.target mongod.service

[Service]
Type=simple
User=$USER
WorkingDirectory=/var/www/whatsflow/backend
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
ExecStart=/usr/bin/python3 -m uvicorn server:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Serviço Frontend
sudo tee /etc/systemd/system/whatsflow-frontend.service <<EOF
[Unit]
Description=WhatsFlow Frontend
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/var/www/whatsflow/frontend
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Serviço WhatsApp
sudo tee /etc/systemd/system/whatsapp-service.service <<EOF
[Unit]
Description=WhatsApp Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/var/www/whatsflow/whatsapp-service
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=FASTAPI_URL=http://localhost:8001
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Recarregar systemd
sudo systemctl daemon-reload

echo "✅ Instalação base concluída!"
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo "1. Copie os arquivos do projeto para /var/www/whatsflow/"
echo "2. Execute: cd /var/www/whatsflow && ./setup-project.sh"
echo "3. Acesse: https://$DOMAIN"
echo ""
echo "🔧 Comandos úteis:"
echo "- Logs backend: sudo journalctl -u whatsflow-backend -f"
echo "- Logs frontend: sudo journalctl -u whatsflow-frontend -f"
echo "- Logs WhatsApp: sudo journalctl -u whatsapp-service -f"