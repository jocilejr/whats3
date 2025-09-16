import React, { useEffect, useState } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Settings = () => {
  const [activeSection, setActiveSection] = useState('credentials');
  const [activeSubSection, setActiveSubSection] = useState('minio');
  const [formData, setFormData] = useState({
    accessKey: '',
    secretKey: '',
    bucket: '',
    url: ''
  });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await axios.get(`${API}/settings/minio`);
        const data = response.data || {};
        setFormData({
          accessKey: data.accessKey || '',
          secretKey: data.secretKey || '',
          bucket: data.bucket || '',
          url: data.url || ''
        });
      } catch (error) {
        console.error('Failed to load MinIO credentials:', error);
        const message =
          error.response?.data?.error ||
          error.response?.data?.message ||
          'Não foi possível carregar as credenciais salvas.';
        setStatus({
          type: 'error',
          message
        });
      } finally {
        setLoadingSettings(false);
      }
    };

    fetchSettings();
  }, []);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (status?.type === 'success') {
      setStatus(null);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const payload = {
        accessKey: formData.accessKey.trim(),
        secretKey: formData.secretKey.trim(),
        bucket: formData.bucket.trim(),
        url: formData.url.trim()
      };

      if (Object.values(payload).some((value) => !value)) {
        setStatus({
          type: 'error',
          message: 'Preencha todos os campos obrigatórios antes de salvar.'
        });
        return;
      }

      const response = await axios.post(`${API}/settings/minio`, payload);
      const responseData = response.data || {};

      setStatus({
        type: 'success',
        message:
          responseData.message || 'Credenciais salvas com sucesso!'
      });

      if (responseData.settings) {
        setFormData({
          accessKey: responseData.settings.accessKey ?? payload.accessKey,
          secretKey: responseData.settings.secretKey ?? payload.secretKey,
          bucket: responseData.settings.bucket ?? payload.bucket,
          url: responseData.settings.url ?? payload.url
        });
      }
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        'Não foi possível salvar as credenciais. Tente novamente.';
      setStatus({
        type: 'error',
        message
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card settings">
      <h2>⚙️ Configurações</h2>
      <div className="settings-tabs">
        <div
          className="settings-tablist"
          role="tablist"
          aria-label="Categorias de configurações"
        >
          <button
            type="button"
            role="tab"
            id="settings-tab-credentials"
            aria-selected={activeSection === 'credentials'}
            aria-controls="settings-panel-credentials"
            className={`settings-tab ${activeSection === 'credentials' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('credentials');
              setStatus(null);
            }}
          >
            🔐 Credenciais
          </button>
        </div>

        {activeSection === 'credentials' && (
          <>
            <div
              className="settings-subtablist"
              role="tablist"
              aria-label="Opções de credenciais"
            >
              <button
                type="button"
                role="tab"
                id="settings-subtab-minio"
                aria-selected={activeSubSection === 'minio'}
                aria-controls="settings-panel-minio"
                className={`settings-subtab ${activeSubSection === 'minio' ? 'active' : ''}`}
                onClick={() => setActiveSubSection('minio')}
              >
                📦 Credenciais Minio
              </button>
            </div>

            {activeSubSection === 'minio' && (
              <div
                className="settings-card settings-panel"
                role="tabpanel"
                id="settings-panel-minio"
                aria-labelledby="settings-subtab-minio"
              >
                <h3>📦 Credenciais Minio</h3>
                <p className="settings-description">
                  Configure as credenciais utilizadas para acessar o servidor Minio responsável
                  pelo armazenamento de arquivos e mídias.
                </p>

                {status && (
                  <div className={`settings-alert ${status.type}`}>
                    {status.message}
                  </div>
                )}

                {loadingSettings ? (
                  <p className="settings-description loading">Carregando credenciais...</p>
                ) : (
                  <form className="settings-form" onSubmit={handleSubmit}>
                    <div className="form-group">
                      <label htmlFor="accessKey">Access Key</label>
                      <input
                        id="accessKey"
                        name="accessKey"
                        type="text"
                        value={formData.accessKey}
                        onChange={handleInputChange}
                        placeholder="Ex: MINIOACCESSKEY"
                        autoComplete="off"
                        required
                        disabled={loading}
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="secretKey">Secret Key</label>
                      <input
                        id="secretKey"
                        name="secretKey"
                        type="password"
                        value={formData.secretKey}
                        onChange={handleInputChange}
                        placeholder="Ex: ************"
                        autoComplete="new-password"
                        required
                        disabled={loading}
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="bucket">Bucket</label>
                      <input
                        id="bucket"
                        name="bucket"
                        type="text"
                        value={formData.bucket}
                        onChange={handleInputChange}
                        placeholder="Ex: whatsapp-media"
                        autoComplete="off"
                        required
                        disabled={loading}
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="url">URL</label>
                      <input
                        id="url"
                        name="url"
                        type="url"
                        value={formData.url}
                        onChange={handleInputChange}
                        placeholder="Ex: https://minio.seudominio.com"
                        autoComplete="off"
                        required
                        disabled={loading}
                      />
                    </div>

                    <button
                      type="submit"
                      className="save-button"
                      disabled={loading}
                    >
                      {loading ? 'Salvando...' : 'Salvar'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Settings;
