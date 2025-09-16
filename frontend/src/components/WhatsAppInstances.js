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
      
      // Iniciar conexão
      const response = await axios.post(`${API}/whatsapp/instances/${instance.id}/connect`);
      
      if (response.data.success) {
        // Iniciar polling para buscar QR Code
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
          // Conexão estabelecida
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

  const closeQRModal = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
    setShowQRModal(false);
    setQrCode(null);
    setSelectedInstance(null);
  };

  if (loading) {
    return <div className="loading">Carregando instâncias WhatsApp...</div>;
  }

  return (
    <div className="whatsapp-instances">
      <div className="instances-header">
        <h2>📱 Instâncias WhatsApp</h2>
        <button 
          onClick={() => setShowCreateModal(true)} 
          className="create-instance-btn"
        >
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

            {instance.connected && instance.user && (
              <div className="connected-user">
                <div className="user-avatar">
                  {instance.user.name ? instance.user.name.charAt(0).toUpperCase() : '📱'}
                </div>
                <div className="user-details">
                  <div className="user-name">{instance.user.name || 'WhatsApp User'}</div>
                  <div className="user-phone">{instance.user.id}</div>
                </div>
              </div>
            )}

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
                <button
                  onClick={() => connectInstance(instance)}
                  className="connect-btn"
                >
                  🔗 Conectar
                </button>
              ) : (
                <button
                  onClick={() => disconnectInstance(instance)}
                  className="disconnect-btn"
                >
                  ⏸️ Desconectar
                </button>
              )}
              <button
                onClick={() => deleteInstance(instance)}
                className="delete-instance-btn"
              >
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
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="create-first-btn"
            >
              🚀 Criar Primeira Instância
            </button>
          </div>
        )}
      </div>

      {/* Modal Criar Instância */}
      {showCreateModal && (
        <CreateInstanceModal 
          onClose={() => setShowCreateModal(false)}
          onCreate={createInstance}
        />
      )}

      {/* Modal QR Code */}
      {showQRModal && (
        <QRModal
          instance={selectedInstance}
          qrCode={qrCode}
          onClose={closeQRModal}
        />
      )}
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
            <button type="button" onClick={onClose} className="cancel-btn">
              ❌ Cancelar
            </button>
            <button 
              type="submit" 
              disabled={!instanceName.trim() || creating}
              className="create-btn"
            >
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
                <div className="connecting-indicator">
                  🔄 Aguardando conexão...
                </div>
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
            <button onClick={onClose} className="close-qr-btn">
              🚫 Cancelar Conexão
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};