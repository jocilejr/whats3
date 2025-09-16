import React, { useState, useCallback } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  ConnectionLineType,
  Panel,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';

// Custom Node Components
const MessageNode = ({ data, isConnectable }) => {
  return (
    <div className="flow-node message-node">
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#667eea' }}
        isConnectable={isConnectable}
      />
      <div className="node-header">
        <span className="node-icon">💬</span>
        <span className="node-title">Mensagem</span>
      </div>
      <div className="node-content">
        <textarea
          placeholder="Digite sua mensagem..."
          value={data.message || ''}
          onChange={(e) => data.onChange?.(e.target.value)}
          className="message-input"
        />
        <div className="delay-section">
          <label>⏱️ Delay (segundos):</label>
          <input
            type="number"
            min="0"
            max="300"
            placeholder="0"
            value={data.delay || ''}
            onChange={(e) => data.onDelayChange?.(e.target.value)}
            className="delay-input"
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#667eea' }}
        isConnectable={isConnectable}
      />
    </div>
  );
};

const ConditionNode = ({ data, isConnectable }) => {
  return (
    <div className="flow-node condition-node">
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#ed8936' }}
        isConnectable={isConnectable}
      />
      <div className="node-header">
        <span className="node-icon">🔀</span>
        <span className="node-title">Condição</span>
      </div>
      <div className="node-content">
        <input
          type="text"
          placeholder="Palavra-chave ou condição..."
          value={data.condition || ''}
          onChange={(e) => data.onChange?.(e.target.value)}
          className="condition-input"
        />
        <div className="condition-options">
          <label>
            <input
              type="radio"
              name={`condition-type-${data.id}`}
              value="contains"
              checked={data.conditionType === 'contains'}
              onChange={(e) => data.onConditionTypeChange?.(e.target.value)}
            />
            Contém texto
          </label>
          <label>
            <input
              type="radio"
              name={`condition-type-${data.id}`}
              value="equals"
              checked={data.conditionType === 'equals'}
              onChange={(e) => data.onConditionTypeChange?.(e.target.value)}
            />
            Igual a
          </label>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        style={{ background: '#48bb78', left: '30%' }}
        isConnectable={isConnectable}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        style={{ background: '#e53e3e', left: '70%' }}
        isConnectable={isConnectable}
      />
      <div className="condition-labels">
        <span className="yes-label">✅ SIM</span>
        <span className="no-label">❌ NÃO</span>
      </div>
    </div>
  );
};

const TagNode = ({ data, isConnectable }) => {
  return (
    <div className="flow-node tag-node">
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#48bb78' }}
        isConnectable={isConnectable}
      />
      <div className="node-header">
        <span className="node-icon">🏷️</span>
        <span className="node-title">Etiqueta</span>
      </div>
      <div className="node-content">
        <input
          type="text"
          placeholder="Nome da etiqueta..."
          value={data.tag || ''}
          onChange={(e) => data.onChange?.(e.target.value)}
          className="tag-input"
        />
        <select 
          value={data.action || 'add'}
          onChange={(e) => data.onActionChange?.(e.target.value)}
          className="tag-action"
        >
          <option value="add">➕ Adicionar</option>
          <option value="remove">➖ Remover</option>
        </select>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#48bb78' }}
        isConnectable={isConnectable}
      />
    </div>
  );
};

const MediaNode = ({ data, isConnectable }) => {
  return (
    <div className="flow-node media-node">
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#9f7aea' }}
        isConnectable={isConnectable}
      />
      <div className="node-header">
        <span className="node-icon">📁</span>
        <span className="node-title">Mídia</span>
      </div>
      <div className="node-content">
        <select 
          value={data.mediaType || 'audio'}
          onChange={(e) => data.onTypeChange?.(e.target.value)}
          className="media-type"
        >
          <option value="audio">🎵 Áudio</option>
          <option value="image">🖼️ Imagem</option>
          <option value="video">🎥 Vídeo</option>
        </select>
        <input
          type="file"
          accept="audio/*,image/*,video/*"
          onChange={(e) => data.onFileChange?.(e.target.files[0])}
          className="media-file"
        />
        <div className="delay-section">
          <label>⏱️ Delay (segundos):</label>
          <input
            type="number"
            min="0"
            max="300"
            placeholder="0"
            value={data.delay || ''}
            onChange={(e) => data.onDelayChange?.(e.target.value)}
            className="delay-input"
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#9f7aea' }}
        isConnectable={isConnectable}
      />
    </div>
  );
};

const StartNode = ({ data, isConnectable }) => {
  return (
    <div className="flow-node start-node">
      <div className="node-header">
        <span className="node-icon">🚀</span>
        <span className="node-title">Início</span>
      </div>
      <div className="node-content">
        <p>Ponto de início do fluxo</p>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#38b2ac' }}
        isConnectable={isConnectable}
      />
    </div>
  );
};

const DelayNode = ({ data, isConnectable }) => {
  return (
    <div className="flow-node delay-node">
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#f6ad55' }}
        isConnectable={isConnectable}
      />
      <div className="node-header">
        <span className="node-icon">⏱️</span>
        <span className="node-title">Delay</span>
      </div>
      <div className="node-content">
        <div className="delay-config">
          <label>Aguardar por:</label>
          <div className="delay-inputs">
            <input
              type="number"
              min="0"
              max="3600"
              placeholder="5"
              value={data.delay || ''}
              onChange={(e) => data.onDelayChange?.(e.target.value)}
              className="delay-input"
            />
            <select 
              value={data.delayUnit || 'seconds'}
              onChange={(e) => data.onDelayUnitChange?.(e.target.value)}
              className="delay-unit"
            >
              <option value="seconds">Segundos</option>
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
            </select>
          </div>
        </div>
        <div className="delay-description">
          <small>Pausar o fluxo antes de continuar</small>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#f6ad55' }}
        isConnectable={isConnectable}
      />
    </div>
  );
};

// Node types
const nodeTypes = {
  messageNode: MessageNode,
  conditionNode: ConditionNode,
  tagNode: TagNode,
  mediaNode: MediaNode,
  startNode: StartNode,
  delayNode: DelayNode,
};

// Initial nodes and edges
const initialNodes = [
  {
    id: 'start',
    type: 'startNode',
    position: { x: 250, y: 50 },
    data: { label: 'Início' },
  },
];

const initialEdges = [];

export default function FlowEditor({ flowId, onSave, onClose }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [flowName, setFlowName] = useState('Novo Fluxo');
  const [selectedNodeType, setSelectedNodeType] = useState('messageNode');

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const updateNodeData = useCallback((nodeId, key, value) => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              [key]: value,
            },
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  const addNode = useCallback((type) => {
    const id = `${type}_${Date.now()}`;
    const newNode = {
      id,
      type,
      position: { x: Math.random() * 400 + 100, y: Math.random() * 400 + 100 },
      data: { 
        id: id,
        label: `Novo ${type}`,
        onChange: (value) => updateNodeData(id, 'message', value),
        onDelayChange: (value) => updateNodeData(id, 'delay', value),
        onDelayUnitChange: (value) => updateNodeData(id, 'delayUnit', value),
        onActionChange: (value) => updateNodeData(id, 'action', value),
        onTypeChange: (value) => updateNodeData(id, 'mediaType', value),
        onConditionTypeChange: (value) => updateNodeData(id, 'conditionType', value),
        onFileChange: (file) => updateNodeData(id, 'file', file),
      },
    };
    setNodes((nodes) => [...nodes, newNode]);
  }, [setNodes, updateNodeData]);

  const handleSave = async () => {
    const flowData = {
      name: flowName,
      nodes: nodes,
      edges: edges,
      created_at: new Date().toISOString(),
    };
    
    try {
      // Here we would save to backend
      console.log('Saving flow:', flowData);
      onSave?.(flowData);
      alert('Fluxo salvo com sucesso!');
    } catch (error) {
      console.error('Error saving flow:', error);
      alert('Erro ao salvar fluxo');
    }
  };

  return (
    <div className="flow-editor">
      <div className="flow-editor-header">
        <div className="flow-info">
          <input
            type="text"
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            className="flow-name-input"
            placeholder="Nome do fluxo"
          />
        </div>
        <div className="flow-actions">
          <button onClick={handleSave} className="save-button">
            💾 Salvar
          </button>
          <button onClick={onClose} className="close-button">
            ❌ Fechar
          </button>
        </div>
      </div>

      <div className="flow-editor-content">
        <div className="node-palette">
          <h3>Componentes</h3>
          <div className="palette-items">
            <button
              onClick={() => addNode('delayNode')}
              className="palette-item"
            >
              <span className="palette-icon">⏱️</span>
              <span>Delay</span>
            </button>
            <button
              onClick={() => addNode('messageNode')}
              className="palette-item"
            >
              <span className="palette-icon">💬</span>
              <span>Mensagem</span>
            </button>
            <button
              onClick={() => addNode('conditionNode')}
              className="palette-item"
            >
              <span className="palette-icon">🔀</span>
              <span>Condição</span>
            </button>
            <button
              onClick={() => addNode('tagNode')}
              className="palette-item"
            >
              <span className="palette-icon">🏷️</span>
              <span>Etiqueta</span>
            </button>
            <button
              onClick={() => addNode('mediaNode')}
              className="palette-item"
            >
              <span className="palette-icon">📁</span>
              <span>Mídia</span>
            </button>
          </div>
        </div>

        <div className="flow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            connectionLineType={ConnectionLineType.SmoothStep}
            fitView
          >
            <Controls />
            <MiniMap />
            <Background variant="dots" gap={12} size={1} />
            <Panel position="top-right">
              <div className="flow-stats">
                <div>Nós: {nodes.length}</div>
                <div>Conexões: {edges.length}</div>
              </div>
            </Panel>
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}