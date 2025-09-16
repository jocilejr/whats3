import React, { useState } from 'react';
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

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      await axios.post(`${API}/settings/minio`, formData);
      setStatus({
        type: 'success',
        message: 'Credenciais salvas com sucesso!'
      });
    } catch (error) {
      const message =
        error.response?.data?.message ||
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
    <div className="settings">
      <h2>⚙️ Configurações</h2>

      <div className="settings-layout">
        <aside className="settings-sidebar">
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'credentials' ? 'active' : ''}`}
            onClick={() => setActiveSection('credentials')}
          >
            🔐 Credenciais
          </button>

          {activeSection === 'credentials' && (
            <div className="settings-subnav">
              <button
                type="button"
                className={`settings-subnav-item ${activeSubSection === 'minio' ? 'active' : ''}`}
                onClick={() => setActiveSubSection('minio')}
              >
                📦 Credenciais Minio
              </button>
            </div>
          )}
        </aside>

        <section className="settings-content">
          {activeSection === 'credentials' && activeSubSection === 'minio' && (
            <div className="settings-card">
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
                    required
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
                    required
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
                    required
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
                    required
                  />
                </div>

                <button type="submit" className="save-button" disabled={loading}>
                  {loading ? 'Salvando...' : 'Salvar'}
                </button>
              </form>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default Settings;
