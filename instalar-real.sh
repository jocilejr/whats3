#!/bin/bash

# WhatsFlow Real - Instalador Ultra-Simples (v2.0)
# Sistema de Automação WhatsApp com Baileys + Python
# Instalação: bash instalar-real.sh

set -e

echo "🤖 WhatsFlow Real - Instalação Ultra-Simples (v2.0)"
echo "====================================================="
echo "✅ Python + Node.js 20+ para WhatsApp REAL"
echo "✅ Conexão via QR Code verdadeira"
echo "✅ Mensagens reais enviadas/recebidas"
echo "✅ Central de contatos automática"
echo "✅ Interface web completa"
echo

# Verificar Python
echo "🔍 Verificando Python..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 não encontrado!"
    echo "📦 Para instalar:"
    echo "   Ubuntu/Debian: sudo apt install python3"
    echo "   CentOS/RHEL: sudo yum install python3"
    echo "   macOS: brew install python3"
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo "✅ Python $PYTHON_VERSION encontrado"

echo "🔍 Verificando dependências Python (minio)..."
if ! python3 -c "import minio" >/dev/null 2>&1; then
    echo "❌ Biblioteca 'minio' não encontrada!"
    echo "   Instale executando: python3 -m pip install minio"
    echo "   Depois execute novamente este instalador."
    exit 1
fi
echo "✅ Biblioteca 'minio' disponível"

# Verificar Node.js
echo "🔍 Verificando Node.js..."
if ! command -v node &> /dev/null; then
    echo "⚠️ Node.js não encontrado!"
    echo "📦 Para usar WhatsApp REAL, instale Node.js 20 ou superior:"
    echo "   Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "   CentOS/RHEL: curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo yum install nodejs npm"
    echo "   macOS: brew install node"
    echo
    echo "🔧 Ou continuar com versão simplificada (sem WhatsApp real)?"
    read -p "Digite 's' para continuar simplificado ou 'n' para sair: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        echo "👍 Instale Node.js e execute novamente para funcionalidade completa!"
        exit 1
    fi
    
    echo "⚠️ Iniciando em modo demonstração (Node.js 20+ não disponível)"
    echo "🚀 Executando WhatsFlow Pure (modo demo)..."
    if [ -f "whatsflow-pure.py" ]; then
        python3 whatsflow-pure.py
    else
        echo "❌ whatsflow-pure.py não encontrado!"
        echo "   Execute apenas: python3 whatsflow-real.py"
        echo "   (Funcionará em modo demo)"
    fi
    exit 0
else
    NODE_VERSION=$(node --version)
    NPM_VERSION=$(npm --version)
    echo "✅ Node.js $NODE_VERSION encontrado (requisito mínimo: 20.x)"
    echo "✅ NPM $NPM_VERSION encontrado"
fi

# Verificar arquivo principal
if [ ! -f "whatsflow-real.py" ]; then
    echo "❌ whatsflow-real.py não encontrado!"
    echo "   Coloque o arquivo na pasta atual e tente novamente."
    exit 1
fi

# Tornar executável
chmod +x whatsflow-real.py

# Parar processos anteriores se existirem
echo "🧹 Limpando processos anteriores..."
pkill -f "whatsflow-real.py" 2>/dev/null || true
pkill -f "baileys_service" 2>/dev/null || true
sleep 2

echo "🚀 Iniciando WhatsFlow Real..."
echo "   Interface: http://localhost:8889"
echo "   WhatsApp Service: Será iniciado automaticamente"
echo "   Status: Conexão WhatsApp REAL ativada"

echo
echo "📋 Como usar:"
echo "   1. Abra http://localhost:8889 no navegador"
echo "   2. Vá na aba 'Instâncias'"
echo "   3. Crie uma instância e clique 'Conectar Real'"
echo "   4. Escaneie o QR Code com seu WhatsApp"
echo "   5. Use as abas 'Contatos' e 'Mensagens'"

echo
echo "⏳ Iniciando servidor..."
echo "   Para parar: Ctrl+C"
echo

# Verificar se já existe Baileys configurado
if [ -d "baileys_service" ]; then
    echo "✅ Baileys já configurado"
    cd baileys_service
    echo "📦 Verificando dependências..."
    npm install node-fetch@2.6.7 > /dev/null 2>&1 || true
    cd ..
fi

# Iniciar WhatsFlow Real
python3 whatsflow-real.py
