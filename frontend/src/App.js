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

const navigationItems = [
  { key: 'dashboard', label: 'Visão Geral', icon: '📊', hint: 'Resumo em tempo real' },
  { key: 'flows', label: 'Fluxos', icon: '🎯', hint: 'Automação e jornadas' },
  { key: 'contacts', label: 'Contatos', icon: '👥', hint: 'Segmentação e tags' },
  { key: 'messages', label: 'Mensagens', icon: '💬', hint: 'Chat unificado' },
  { key: 'instances', label: 'Instâncias', icon: '📱', hint: 'Conexões WhatsApp' },
  { key: 'settings', label: 'Configurações', icon: '⚙️', hint: 'Preferências do sistema' }
];

const viewDetails = {
  dashboard: {
    title: 'Visão Geral',
    description: 'Acompanhe a saúde das conexões e os indicadores mais importantes do seu atendimento.'
  },
  flows: {
    title: 'Fluxos de Automação',
    description: 'Organize jornadas inteligentes e personalize cada etapa da conversa.'
  },
  contacts: {
    title: 'Gerenciamento de Contatos',
    description: 'Visualize, segmente e mantenha os contatos sempre atualizados.'
  },
  messages: {
    title: 'Central de Mensagens',
    description: 'Converse em tempo real com seus contatos e acione automações com um clique.'
  },
  instances: {
    title: 'Instâncias do WhatsApp',
    description: 'Monitore cada dispositivo e controle o status das conexões.'
  },
  settings: {
    title: 'Configurações do Sistema',
    description: 'Ajuste integrações, preferências e detalhes operacionais do WhatsFlow.'
  }
};

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

const Navigation = ({ currentView, onViewChange }) => (
  <nav className="main-navigation">
    <div className="nav-items">
      {navigationItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`nav-item ${currentView === item.key ? 'active' : ''}`}
          onClick={() => onViewChange(item.key)}
        >
          <span className="nav-icon">{item.icon}</span>
          <div className="nav-text">
            <span className="nav-label">{item.label}</span>
            {item.hint && <span className="nav-hint">{item.hint}</span>}
          </div>
        </button>
      ))}
    </div>
  </nav>
);

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

  return (
    <div className="whatsapp-connection">
      <div className="connection-header">
        <div>
          <h2>🔗 Conexão WhatsApp</h2>
          <p className="connection-subtitle">
            Gere o QR Code e conecte o seu dispositivo para liberar o atendimento.
          </p>
        </div>
        <div className={`status-indicator ${status}`}>
          <div className="status-dot"></div>
          <span className="status-text">
            {status === 'connected' ? 'Conectado'
              : status === 'disconnected' ? 'Desconectado' : 'Erro'}
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

function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [showFlowEditor, setShowFlowEditor] = useState(false);
  const [editingFlow, setEditingFlow] = useState(null);
  const [baileysHealthy, setBaileysHealthy] = useState(false);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (!response.ok) throw new Error();
        setBaileysHealthy(true);
      } catch {
        alert(`Serviço indisponível em ${API_BASE_URL}`);
        setBaileysHealthy(false);
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

  const currentViewMeta = viewDetails[currentView] || viewDetails.dashboard;

  return (
    <div className="app">
      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="brand">
              <span className="brand-logo">🤖</span>
              <div className="brand-text">
                <span className="brand-name">WhatsFlow</span>
                <span className="brand-subtitle">Automation Suite</span>
              </div>
            </div>
            <span className="brand-badge">Real</span>
          </div>

          <Navigation currentView={currentView} onViewChange={setCurrentView} />

          <div className="sidebar-footer">
            <div className={`service-status ${baileysHealthy ? 'online' : 'offline'}`}>
              <span className="status-dot" />
              <div className="status-content">
                <span className="status-title">Baileys</span>
                <span className="status-description">
                  {baileysHealthy ? 'Conectado' : 'Aguardando serviço'}
                </span>
              </div>
            </div>
            <div className="runtime-hint">
              <span className="runtime-label">Execução</span>
              <span className="runtime-value">whatsflow-real.py</span>
            </div>
          </div>
        </aside>

        <main className="content">
          <div className="content-inner">
            <header className="content-header">
              <div className="view-meta">
                <span className="breadcrumbs">Início · {currentViewMeta.title}</span>
                <h1>{currentViewMeta.title}</h1>
                {currentViewMeta.description && (
                  <p className="view-description">{currentViewMeta.description}</p>
                )}
              </div>

              <div className="user-card">
                <div className="user-avatar">WF</div>
                <div className="user-details">
                  <span className="user-name">WhatsFlow</span>
                  <span className="user-role">Administrador</span>
                </div>
              </div>
            </header>

            <div className="view-container">
              {currentView === 'dashboard' && (
                <div className="view-stack">
                  <WhatsAppConnection />
                  <DashboardStats />
                  <ContactsList />
                </div>
              )}

              {currentView === 'flows' && (
                <div className="view-stack">
                  <FlowList
                    onCreateFlow={handleCreateFlow}
                    onEditFlow={handleEditFlow}
                  />
                </div>
              )}

              {currentView === 'contacts' && (
                <div className="view-stack">
                  <ContactsList />
                </div>
              )}

              {currentView === 'messages' && (
                <div className="view-stack">
                  <MessagesCenter baileysHealthy={baileysHealthy} />
                </div>
              )}

              {currentView === 'instances' && (
                <div className="view-stack">
                  <WhatsAppInstances />
                </div>
              )}

              {currentView === 'settings' && (
                <div className="view-stack">
                  <Settings />
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
