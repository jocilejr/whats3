import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const resolveServiceUrl = () => {
  if (process.env.REACT_APP_API_BASE_URL) {
    return process.env.REACT_APP_API_BASE_URL;
  }

  if (typeof window !== 'undefined') {
    if (window.API_BASE_URL) {
      return window.API_BASE_URL;
    }

    return `http://${window.location.hostname}:3002`;
  }

  return 'http://localhost:3002';
};

const SERVICE_URL = resolveServiceUrl();

const parseParticipantsInput = (value) => {
  if (!value) {
    return [];
  }

  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const formatParticipant = (participant) => {
  if (!participant) {
    return '';
  }

  if (participant.includes('@')) {
    return participant;
  }

  return `${participant}@s.whatsapp.net`;
};

const getParticipantLabel = (participant) => {
  if (!participant) {
    return '';
  }

  if (participant.phone) {
    return participant.phone;
  }

  if (participant.jid && participant.jid.includes('@')) {
    return participant.jid.replace('@s.whatsapp.net', '');
  }

  return participant.jid || participant.id || '';
};

const GroupsManager = () => {
  const [instances, setInstances] = useState([]);
  const [instancesLoading, setInstancesLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groups, setGroups] = useState([]);
  const [selectedInstance, setSelectedInstance] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createSubject, setCreateSubject] = useState('');
  const [createParticipants, setCreateParticipants] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [announcementOnly, setAnnouncementOnly] = useState(false);
  const [restrictedInfo, setRestrictedInfo] = useState(false);
  const [settingsUpdating, setSettingsUpdating] = useState(false);
  const [addParticipantsInput, setAddParticipantsInput] = useState('');
  const [removeParticipant, setRemoveParticipant] = useState('');
  const [promoteParticipant, setPromoteParticipant] = useState('');
  const [demoteParticipant, setDemoteParticipant] = useState('');
  const [participantsUpdating, setParticipantsUpdating] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  const isAdmin = useMemo(
    () => Boolean(selectedGroup?.permissions?.isAdmin),
    [selectedGroup]
  );

  const handleError = (error, fallbackMessage) => {
    const message = error?.response?.data?.error || error.message || fallbackMessage;
    setFeedback({ type: 'error', message });
  };

  const fetchInstances = async () => {
    setInstancesLoading(true);
    try {
      const { data } = await axios.get(`${SERVICE_URL}/status`);
      const parsed = Object.entries(data || {}).map(([id, details]) => ({
        id,
        ...(details || {})
      }));
      setInstances(parsed);

      if (!selectedInstance && parsed.length > 0) {
        setSelectedInstance(parsed[0].id);
      }
    } catch (error) {
      handleError(error, 'Não foi possível carregar as instâncias');
    } finally {
      setInstancesLoading(false);
    }
  };

  const fetchGroups = async (instanceId, options = {}) => {
    if (!instanceId) {
      setGroups([]);
      setSelectedGroupId('');
      setSelectedGroup(null);
      return;
    }

    setGroupsLoading(true);
    try {
      const params = {};
      if (options.refresh) {
        params.refresh = 'true';
      }

      const { data } = await axios.get(`${SERVICE_URL}/groups/${instanceId}`, { params });
      const receivedGroups = data?.groups || [];
      setGroups(receivedGroups);

      if (receivedGroups.length === 0) {
        setSelectedGroupId('');
        setSelectedGroup(null);
      } else if (!selectedGroupId || !receivedGroups.some((group) => (group.jid || group.id) === selectedGroupId)) {
        const firstId = receivedGroups[0].jid || receivedGroups[0].id;
        setSelectedGroupId(firstId);
      }

      if (data?.cache?.source === 'fallback') {
        setFeedback({
          type: 'warning',
          message: 'Grupos carregados via fallback. Algumas ações podem exigir atualização manual.'
        });
      }
    } catch (error) {
      handleError(error, 'Erro ao carregar grupos');
      setGroups([]);
      setSelectedGroupId('');
      setSelectedGroup(null);
    } finally {
      setGroupsLoading(false);
    }
  };

  const refreshAfterAction = async (groupId) => {
    if (!selectedInstance) {
      return;
    }
    await fetchGroups(selectedInstance, { refresh: true });
    if (groupId) {
      setSelectedGroupId(groupId);
    }
  };

  const handleCreateGroup = async (event) => {
    event.preventDefault();
    if (!selectedInstance) {
      setFeedback({ type: 'error', message: 'Selecione uma instância antes de criar grupos' });
      return;
    }

    const participantsList = parseParticipantsInput(createParticipants);

    setCreatingGroup(true);
    try {
      const { data } = await axios.post(`${SERVICE_URL}/groups/${selectedInstance}`, {
        subject: createSubject.trim(),
        participants: participantsList.map(formatParticipant)
      });

      setFeedback({
        type: 'success',
        message: `Grupo "${data?.group?.name || createSubject}" criado com sucesso`
      });

      setCreateSubject('');
      setCreateParticipants('');
      setShowCreateForm(false);
      await refreshAfterAction(data?.group?.jid || data?.groupId);
    } catch (error) {
      handleError(error, 'Erro ao criar grupo');
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleUpdateSubject = async () => {
    if (!selectedInstance || !selectedGroup) {
      return;
    }

    if (!subjectInput.trim()) {
      setFeedback({ type: 'error', message: 'Informe um assunto válido' });
      return;
    }

    try {
      await axios.patch(`${SERVICE_URL}/groups/${selectedInstance}/${selectedGroup.jid}/subject`, {
        subject: subjectInput.trim()
      });

      setFeedback({ type: 'success', message: 'Assunto atualizado com sucesso' });
      await refreshAfterAction(selectedGroup.jid);
    } catch (error) {
      handleError(error, 'Erro ao atualizar assunto');
    }
  };

  const handleUpdateDescription = async () => {
    if (!selectedInstance || !selectedGroup) {
      return;
    }

    try {
      await axios.patch(`${SERVICE_URL}/groups/${selectedInstance}/${selectedGroup.jid}/description`, {
        description: descriptionInput
      });
      setFeedback({ type: 'success', message: 'Descrição atualizada' });
      await refreshAfterAction(selectedGroup.jid);
    } catch (error) {
      handleError(error, 'Erro ao atualizar descrição');
    }
  };

  const handleSettingChange = async (type, value) => {
    if (!selectedInstance || !selectedGroup) {
      return;
    }

    setSettingsUpdating(true);
    try {
      const payload = type === 'announcement' ? { announcement: value } : { locked: value };
      await axios.patch(`${SERVICE_URL}/groups/${selectedInstance}/${selectedGroup.jid}/settings`, payload);
      setFeedback({ type: 'success', message: 'Configurações atualizadas' });
      await refreshAfterAction(selectedGroup.jid);
    } catch (error) {
      handleError(error, 'Erro ao atualizar configurações');
      // Revert state on error
      if (type === 'announcement') {
        setAnnouncementOnly(Boolean(selectedGroup?.settings?.announcement));
      } else {
        setRestrictedInfo(Boolean(selectedGroup?.settings?.locked));
      }
    } finally {
      setSettingsUpdating(false);
    }
  };

  const handleParticipantsAction = async (action, list) => {
    if (!selectedInstance || !selectedGroup) {
      return;
    }

    if (!list.length) {
      setFeedback({ type: 'error', message: 'Informe ao menos um participante' });
      return;
    }

    setParticipantsUpdating(true);
    try {
      await axios.post(`${SERVICE_URL}/groups/${selectedInstance}/${selectedGroup.jid}/participants`, {
        action,
        participants: list
      });

      const actionLabel = {
        add: 'adicionados',
        remove: 'removidos',
        promote: 'promovidos',
        demote: 'rebaixados'
      }[action];

      setFeedback({ type: 'success', message: `Participantes ${actionLabel} com sucesso` });

      setAddParticipantsInput('');
      setRemoveParticipant('');
      setPromoteParticipant('');
      setDemoteParticipant('');

      await refreshAfterAction(selectedGroup.jid);
    } catch (error) {
      handleError(error, 'Erro ao atualizar participantes');
    } finally {
      setParticipantsUpdating(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!selectedInstance || !selectedGroup) {
      return;
    }

    if (!window.confirm('Tem certeza que deseja sair deste grupo?')) {
      return;
    }

    try {
      await axios.post(`${SERVICE_URL}/groups/${selectedInstance}/${selectedGroup.jid}/leave`);
      setFeedback({ type: 'success', message: 'Instância removida do grupo' });
      await refreshAfterAction(null);
    } catch (error) {
      handleError(error, 'Erro ao sair do grupo');
    }
  };

  const handleFetchInviteCode = async () => {
    if (!selectedInstance || !selectedGroup) {
      return;
    }

    setInviteLoading(true);
    try {
      const { data } = await axios.get(`${SERVICE_URL}/groups/${selectedInstance}/${selectedGroup.jid}/invite-code`);
      setInviteCode(data?.code || '');
      setFeedback({ type: 'success', message: 'Código de convite atualizado' });
    } catch (error) {
      handleError(error, 'Erro ao obter código de convite');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRevokeInvite = async () => {
    if (!selectedInstance || !selectedGroup) {
      return;
    }

    setInviteLoading(true);
    try {
      const { data } = await axios.post(`${SERVICE_URL}/groups/${selectedInstance}/${selectedGroup.jid}/revoke-invite`);
      setInviteCode(data?.code || '');
      setFeedback({ type: 'success', message: 'Convite revogado. Novo código gerado.' });
    } catch (error) {
      handleError(error, 'Erro ao revogar convite');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteCode);
      setFeedback({ type: 'success', message: 'Código copiado para a área de transferência' });
    } catch (error) {
      handleError(error, 'Não foi possível copiar o código');
    }
  };

  useEffect(() => {
    fetchInstances();
  }, []);

  useEffect(() => {
    fetchGroups(selectedInstance);
  }, [selectedInstance]);

  useEffect(() => {
    if (!selectedGroupId) {
      setSelectedGroup(null);
      return;
    }

    const group = groups.find((item) => (item.jid || item.id) === selectedGroupId);
    setSelectedGroup(group || null);
  }, [groups, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroup) {
      setSubjectInput('');
      setDescriptionInput('');
      setAnnouncementOnly(false);
      setRestrictedInfo(false);
      setInviteCode('');
      return;
    }

    setSubjectInput(selectedGroup.name || '');
    setDescriptionInput(selectedGroup.description || '');
    setAnnouncementOnly(Boolean(selectedGroup?.settings?.announcement));
    setRestrictedInfo(Boolean(selectedGroup?.settings?.locked));
    setInviteCode(selectedGroup?.inviteCode || '');
  }, [selectedGroup]);

  return (
    <div className="groups-manager">
      <div className="groups-header">
        <div>
          <h2>🧑‍🤝‍🧑 Gerenciamento de Grupos</h2>
          <p>Crie e administre grupos WhatsApp diretamente pelo WhatsFlow</p>
        </div>
        <div className="groups-header-actions">
          <button
            className="refresh-btn"
            onClick={() => fetchGroups(selectedInstance, { refresh: true })}
            disabled={groupsLoading || !selectedInstance}
          >
            🔄 Atualizar Grupos
          </button>
          <button
            className="create-group-btn"
            onClick={() => setShowCreateForm((prev) => !prev)}
            disabled={!selectedInstance}
          >
            {showCreateForm ? '➖ Fechar' : '➕ Novo Grupo'}
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`groups-feedback ${feedback.type}`}>
          {feedback.message}
        </div>
      )}

      <div className="groups-layout">
        <aside className="groups-sidebar">
          <div className="sidebar-section">
            <label>Instância conectada</label>
            {instancesLoading ? (
              <div className="groups-loading">Carregando instâncias...</div>
            ) : (
              <select
                value={selectedInstance}
                onChange={(event) => setSelectedInstance(event.target.value)}
              >
                <option value="">Selecione uma instância</option>
                {instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.id} {instance.connected ? '✅' : instance.connecting ? '⏳' : '⚠️'}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="sidebar-section">
            <div className="section-title">
              <h3>Grupos</h3>
              <span className="badge">{groups.length}</span>
            </div>

            {groupsLoading ? (
              <div className="groups-loading">Carregando grupos...</div>
            ) : groups.length === 0 ? (
              <div className="groups-empty">
                {selectedInstance
                  ? 'Nenhum grupo encontrado. Crie um novo grupo ou sincronize novamente.'
                  : 'Selecione uma instância para visualizar os grupos.'}
              </div>
            ) : (
              <div className="groups-list">
                {groups.map((group) => {
                  const groupKey = group.jid || group.id;
                  const isActive = groupKey === selectedGroupId;
                  return (
                    <button
                      key={groupKey}
                      className={`group-card ${isActive ? 'active' : ''}`}
                      onClick={() => setSelectedGroupId(groupKey)}
                    >
                      <div className="group-name">{group.name}</div>
                      <div className="group-meta">
                        <span>👤 {group.participantCount || 0}</span>
                        {group.permissions?.isAdmin ? <span className="badge success">Admin</span> : <span className="badge">Membro</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="groups-content">
          {showCreateForm && (
            <div className="group-section">
              <h3>➕ Criar novo grupo</h3>
              <form className="group-form" onSubmit={handleCreateGroup}>
                <div className="form-row">
                  <label>Nome do grupo</label>
                  <input
                    type="text"
                    value={createSubject}
                    onChange={(event) => setCreateSubject(event.target.value)}
                    placeholder="Nome do grupo"
                    required
                  />
                </div>
                <div className="form-row">
                  <label>Participantes iniciais</label>
                  <textarea
                    value={createParticipants}
                    onChange={(event) => setCreateParticipants(event.target.value)}
                    placeholder="Insira telefones separados por vírgula ou quebra de linha"
                    rows={3}
                  />
                  <small>Você pode deixar em branco e adicionar participantes depois.</small>
                </div>
                <div className="form-actions">
                  <button type="submit" className="primary" disabled={creatingGroup}>
                    {creatingGroup ? 'Criando...' : 'Criar grupo'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {!selectedGroup && !groupsLoading && (
            <div className="group-placeholder">
              <h3>Selecione um grupo para visualizar detalhes</h3>
              <p>Utilize a lista ao lado para escolher o grupo que deseja gerenciar.</p>
            </div>
          )}

          {selectedGroup && (
            <>
              <div className="group-section">
                <h3>📋 Informações do grupo</h3>
                <div className="group-info-grid">
                  <div>
                    <label>Nome</label>
                    <input
                      type="text"
                      value={subjectInput}
                      onChange={(event) => setSubjectInput(event.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                  <div>
                    <label>Descrição</label>
                    <textarea
                      value={descriptionInput}
                      onChange={(event) => setDescriptionInput(event.target.value)}
                      rows={3}
                      disabled={!isAdmin}
                    />
                  </div>
                </div>
                <div className="form-actions">
                  <button
                    className="primary"
                    onClick={handleUpdateSubject}
                    disabled={!isAdmin}
                  >
                    Atualizar assunto
                  </button>
                  <button
                    className="secondary"
                    onClick={handleUpdateDescription}
                    disabled={!isAdmin}
                  >
                    Atualizar descrição
                  </button>
                </div>

                <div className="group-details-grid">
                  <div>
                    <strong>JID:</strong> {selectedGroup.jid}
                  </div>
                  <div>
                    <strong>Participantes:</strong> {selectedGroup.participantCount || 0}
                  </div>
                  <div>
                    <strong>Permissão:</strong> {isAdmin ? 'Administrador' : 'Membro'}
                  </div>
                  {selectedGroup.createdAt && (
                    <div>
                      <strong>Criado em:</strong> {new Date(selectedGroup.createdAt).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              <div className="group-section">
                <h3>⚙️ Configurações</h3>
                <div className="settings-grid">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={announcementOnly}
                      onChange={(event) => {
                        const value = event.target.checked;
                        setAnnouncementOnly(value);
                        handleSettingChange('announcement', value);
                      }}
                      disabled={!isAdmin || settingsUpdating}
                    />
                    <span>Apenas administradores podem enviar mensagens</span>
                  </label>

                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={restrictedInfo}
                      onChange={(event) => {
                        const value = event.target.checked;
                        setRestrictedInfo(value);
                        handleSettingChange('locked', value);
                      }}
                      disabled={!isAdmin || settingsUpdating}
                    />
                    <span>Apenas administradores podem editar dados do grupo</span>
                  </label>
                </div>
              </div>

              <div className="group-section">
                <h3>👥 Participantes</h3>
                <div className="participants-grid">
                  {selectedGroup.participants && selectedGroup.participants.length > 0 ? (
                    selectedGroup.participants.map((participant) => (
                      <div key={participant.jid} className="participant-card">
                        <div className="participant-name">{participant.name || getParticipantLabel(participant)}</div>
                        <div className="participant-meta">
                          <span>{participant.jid}</span>
                          {participant.isAdmin && <span className="badge success">Admin</span>}
                          {participant.isMe && <span className="badge info">Você</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="groups-empty">Nenhum participante disponível</div>
                  )}
                </div>

                {isAdmin ? (
                  <div className="participants-actions">
                    <div>
                      <label>Adicionar participantes</label>
                      <textarea
                        rows={2}
                        placeholder="Ex: 5511999999999, 558199999999"
                        value={addParticipantsInput}
                        onChange={(event) => setAddParticipantsInput(event.target.value)}
                      />
                      <button
                        className="primary"
                        onClick={() => handleParticipantsAction('add', parseParticipantsInput(addParticipantsInput).map(formatParticipant))}
                        disabled={participantsUpdating}
                      >
                        Adicionar
                      </button>
                    </div>

                    <div className="participant-selector">
                      <label>Remover participante</label>
                      <select
                        value={removeParticipant}
                        onChange={(event) => setRemoveParticipant(event.target.value)}
                      >
                        <option value="">Selecione</option>
                        {selectedGroup.participants
                          ?.filter((participant) => !participant.isMe)
                          .map((participant) => (
                            <option key={`remove-${participant.jid}`} value={participant.jid}>
                              {participant.name || getParticipantLabel(participant)}
                            </option>
                          ))}
                      </select>
                      <button
                        className="danger"
                        onClick={() => handleParticipantsAction('remove', removeParticipant ? [removeParticipant] : [])}
                        disabled={!removeParticipant || participantsUpdating}
                      >
                        Remover
                      </button>
                    </div>

                    <div className="participant-selector">
                      <label>Promover para admin</label>
                      <select
                        value={promoteParticipant}
                        onChange={(event) => setPromoteParticipant(event.target.value)}
                      >
                        <option value="">Selecione</option>
                        {selectedGroup.participants
                          ?.filter((participant) => !participant.isAdmin)
                          .map((participant) => (
                            <option key={`promote-${participant.jid}`} value={participant.jid}>
                              {participant.name || getParticipantLabel(participant)}
                            </option>
                          ))}
                      </select>
                      <button
                        className="secondary"
                        onClick={() => handleParticipantsAction('promote', promoteParticipant ? [promoteParticipant] : [])}
                        disabled={!promoteParticipant || participantsUpdating}
                      >
                        Promover
                      </button>
                    </div>

                    <div className="participant-selector">
                      <label>Remover privilégios de admin</label>
                      <select
                        value={demoteParticipant}
                        onChange={(event) => setDemoteParticipant(event.target.value)}
                      >
                        <option value="">Selecione</option>
                        {selectedGroup.participants
                          ?.filter((participant) => participant.isAdmin && !participant.isSuperAdmin)
                          .map((participant) => (
                            <option key={`demote-${participant.jid}`} value={participant.jid}>
                              {participant.name || getParticipantLabel(participant)}
                            </option>
                          ))}
                      </select>
                      <button
                        className="secondary"
                        onClick={() => handleParticipantsAction('demote', demoteParticipant ? [demoteParticipant] : [])}
                        disabled={!demoteParticipant || participantsUpdating}
                      >
                        Rebaixar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="groups-empty">
                    Você precisa ser administrador do grupo para gerenciar participantes.
                  </div>
                )}
              </div>

              <div className="group-section">
                <h3>🔐 Convites</h3>
                {isAdmin ? (
                  <div className="invite-panel">
                    <div className="invite-code">
                      <label>Código atual</label>
                      <input type="text" value={inviteCode} readOnly placeholder="Nenhum código carregado" />
                    </div>
                    <div className="invite-actions">
                      <button onClick={handleFetchInviteCode} disabled={inviteLoading}>
                        {inviteLoading ? 'Carregando...' : 'Obter código'}
                      </button>
                      <button onClick={handleRevokeInvite} disabled={inviteLoading} className="danger">
                        Revogar convite
                      </button>
                      <button onClick={handleCopyInvite} disabled={!inviteCode} className="secondary">
                        Copiar código
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="groups-empty">
                    Apenas administradores podem visualizar ou alterar códigos de convite.
                  </div>
                )}
              </div>

              <div className="group-section">
                <h3>🚪 Sair do grupo</h3>
                <p>Remova a instância atual deste grupo. Esta ação pode ser revertida apenas mediante convite.</p>
                <button className="danger" onClick={handleLeaveGroup}>
                  Sair do grupo
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default GroupsManager;
