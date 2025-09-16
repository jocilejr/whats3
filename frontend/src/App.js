import React, { useState, useEffect } from 'react';
import './App.css';
import axios from 'axios';
import FlowEditor from './components/FlowEditor';
import FlowList from './components/FlowList';
import MessagesCenter from './components/MessagesCenter';
import Settings from './components/Settings';
import WhatsAppInstances from './components/WhatsAppInstances';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;
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

const NAV_ITEMS = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'flows', icon: '🎯', label: 'Fluxos' },
  { id: 'contacts', icon: '👥', label: 'Contatos' },
  { id: 'messages', icon: '💬', label: 'Mensagens' },
  { id: 'instances', icon: '📱', label: 'Instâncias' },
  { id: 'settings', icon: '⚙️', label: 'Configurações' }
];

// Navigation Component
const Navigation = ({ currentView, onViewChange }) => {
  return (
    <nav className="app-nav">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`nav-button ${currentView === item.id ? 'active' : ''}`}
          onClick={() => onViewChange(item.id)}
        >
          <span className="nav-button-icon">{item.icon}</span>
          <span className="nav-button-label">{item.label}</span>
        </button>
      ))}
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
      const response = await axios.post(`${API_BASE_URL}/demo/connect`);
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

  const statusLabel =
    status === 'connected'
      ? 'Conectado'
      : status === 'disconnected'
        ? 'Desconectado'
        : 'Erro';

  return (
    <div className="card whatsapp-card">
      <div className="card-header">
        <div>
          <h2>🔗 Conexão WhatsApp</h2>
          <p className="card-subtitle">
            Monitore suas instâncias em tempo real e mantenha a automação ativa.
          </p>
        </div>
        <div className={`status-indicator ${status}`}>
          <div className="status-dot" />
          <span className="status-text">{statusLabel}</span>
          {isDemoMode && <span className="status-tag">Demo</span>}
        </div>
      </div>

      {isDemoMode && (
        <div className="demo-badge">
          🚧 <strong>Modo Demonstração</strong> - Simulando funcionalidade WhatsApp para testes
        </div>
      )}

      {status === 'connected' && connectedUser && (
        <div className="connection-success">
          <div className="success-badge">✅ WhatsApp conectado com sucesso!</div>
          <div className="user-info">
            <strong>Usuário:</strong> {connectedUser.name || connectedUser.id}
          </div>
        </div>
      )}

      {status === 'disconnected' && (
        <div className="connection-body">
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
              type="button"
            >
              {loading ? 'Conectando...' : 'Conectar WhatsApp'}
            </button>

            {isDemoMode && (
              <button
                className="demo-button"
                onClick={simulateConnection}
                disabled={loading}
                type="button"
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
    const interval = setInterval(fetchStats, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);
  return (
    <div className="card stats-card">
      <div className="card-header">
        <h2>📊 Estatísticas do Sistema</h2>
      </div>
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
const ContactsList = ({
  title = '📞 Contatos Recentes',
  description = 'Os contatos aparecerão aqui assim que começarem a enviar mensagens.'
}) => {
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
    return (
      <div className="card contacts-card">
        <div className="loading">Carregando contatos...</div>
      </div>
    );
  }

  return (
    <div className="card contacts-card">
      <div className="card-header">
        <div>
          <h3>{title}</h3>
          <p className="card-subtitle">{description}</p>
        </div>
      </div>

      {contacts.length === 0 ? (
        <div className="empty-state">
          <p>Nenhum contato encontrado ainda.</p>
          <p>Os contatos aparecerão aqui quando começarem a enviar mensagens.</p>
        </div>
      ) : (
        <div className="contacts-grid">
          {contacts.slice(0, 6).map((contact) => (
            <div key={contact.id} className="contact-card">
              <div className="contact-avatar">
                {contact.name.charAt(0).toUpperCase()}
              </div>
              <div className="contact-info">
                <h4>{contact.name}</h4>
                <p>{contact.phone_number}</p>
                <div className="contact-tags">
                  {contact.tags.map((tag) => (
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
  const [baileysHealthy, setBaileysHealthy] = useState(false);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/health`);
        if (!r.ok) throw new Error();
        setBaileysHealthy(true);
      } catch {
        alert(`Serviço indisponível em ${API_BASE_URL}`);
      }
    };
    checkHealth();
  }, []);

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
    // Here we would save to backend
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
    <div className="app professional-app">
      <div className="app-surface">
        <div className="app-container">
          <header className="app-hero">
            <h1>🚀 WhatsFlow Professional</h1>
            <p>Sistema avançado de automação WhatsApp com tempo real e múltiplas instâncias.</p>
            <div className="hero-badge">
              ✅ Conexão estável • Webhooks • Fluxos inteligentes
            </div>
          </header>

          <Navigation currentView={currentView} onViewChange={setCurrentView} />

          <main className="app-content">
            {currentView === 'dashboard' && (
              <div className="view-grid">
                <WhatsAppConnection />
                <DashboardStats />
                <ContactsList />
              </div>
            )}

            {currentView === 'flows' && (
              <section className="view-section">
                <FlowList
                  onCreateFlow={handleCreateFlow}
                  onEditFlow={handleEditFlow}
                />
              </section>
            )}

            {currentView === 'contacts' && (
              <section className="view-section">
                <ContactsList
                  title="👥 Gerenciamento de Contatos"
                  description="Acompanhe seus contatos sincronizados e etiquetas aplicadas."
                />
              </section>
            )}

            {currentView === 'messages' && (
              <section className="view-section">
                <MessagesCenter baileysHealthy={baileysHealthy} />
              </section>
            )}

            {currentView === 'instances' && (
              <section className="view-section">
                <WhatsAppInstances />
              </section>
            )}

            {currentView === 'settings' && (
              <section className="view-section">
                <Settings />
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;