import React, { useState, useEffect } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function FlowList({ onCreateFlow, onEditFlow }) {
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFlows();
  }, []);

  const fetchFlows = async () => {
    try {
      // For now, using mock data since we haven't implemented backend flows yet
      const mockFlows = [
        {
          id: '1',
          name: 'Boas-vindas',
          description: 'Fluxo de boas-vindas para novos contatos',
          nodes_count: 5,
          active: true,
          created_at: '2025-09-09T00:00:00Z',
          last_used: '2025-09-09T01:00:00Z'
        },
        {
          id: '2',
          name: 'Suporte Técnico',
          description: 'Fluxo para atendimento de suporte',
          nodes_count: 8,
          active: false,
          created_at: '2025-09-08T00:00:00Z',
          last_used: '2025-09-08T15:30:00Z'
        }
      ];
      setFlows(mockFlows);
    } catch (error) {
      console.error('Failed to fetch flows:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (flowId, currentStatus) => {
    try {
      // Here we would call the backend to toggle active status
      setFlows(flows.map(flow => 
        flow.id === flowId 
          ? { ...flow, active: !currentStatus }
          : flow
      ));
    } catch (error) {
      console.error('Failed to toggle flow status:', error);
    }
  };

  const handleDeleteFlow = async (flowId) => {
    if (window.confirm('Tem certeza que deseja excluir este fluxo?')) {
      try {
        // Here we would call the backend to delete
        setFlows(flows.filter(flow => flow.id !== flowId));
      } catch (error) {
        console.error('Failed to delete flow:', error);
      }
    }
  };

  if (loading) {
    return <div className="loading">Carregando fluxos...</div>;
  }

  return (
    <div className="flow-list">
      <div className="flow-list-header">
        <h2>🎯 Fluxos de Automação</h2>
        <button onClick={onCreateFlow} className="create-flow-button">
          ➕ Criar Novo Fluxo
        </button>
      </div>

      {flows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎯</div>
          <h3>Nenhum fluxo criado ainda</h3>
          <p>Crie seu primeiro fluxo de automação para começar!</p>
          <button onClick={onCreateFlow} className="create-first-flow-button">
            🚀 Criar Primeiro Fluxo
          </button>
        </div>
      ) : (
        <div className="flows-grid">
          {flows.map(flow => (
            <div key={flow.id} className="flow-card">
              <div className="flow-card-header">
                <div className="flow-info">
                  <h3>{flow.name}</h3>
                  <p>{flow.description}</p>
                </div>
                <div className={`flow-status ${flow.active ? 'active' : 'inactive'}`}>
                  {flow.active ? 'Ativo' : 'Inativo'}
                </div>
              </div>

              <div className="flow-stats">
                <div className="stat">
                  <span className="stat-label">Nós:</span>
                  <span className="stat-value">{flow.nodes_count}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Criado:</span>
                  <span className="stat-value">
                    {new Date(flow.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Último uso:</span>
                  <span className="stat-value">
                    {flow.last_used 
                      ? new Date(flow.last_used).toLocaleDateString('pt-BR')
                      : 'Nunca'
                    }
                  </span>
                </div>
              </div>

              <div className="flow-actions">
                <button
                  onClick={() => onEditFlow(flow)}
                  className="edit-button"
                >
                  ✏️ Editar
                </button>
                <button
                  onClick={() => handleToggleActive(flow.id, flow.active)}
                  className={`toggle-button ${flow.active ? 'deactivate' : 'activate'}`}
                >
                  {flow.active ? '⏸️ Desativar' : '▶️ Ativar'}
                </button>
                <button
                  onClick={() => handleDeleteFlow(flow.id)}
                  className="delete-button"
                >
                  🗑️ Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}