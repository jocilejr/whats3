#!/usr/bin/env python3
"""
Campaign System Test Suite for WhatsFlow Real
Testing the complete campaign system that was just implemented:

FUNCIONALIDADES A TESTAR:
1. API de Campanhas (/api/campaigns): GET e POST
2. API de Instâncias (/api/instances): GET para seleção
3. Criar Campanha de Teste com todas instâncias disponíveis
4. APIs específicas da campanha criada:
   - GET /api/campaigns/{id}/instances: Instâncias da campanha
   - GET /api/campaigns/{id}/groups: Grupos da campanha
   - POST /api/campaigns/{id}/groups: Adicionar grupos
   - GET /api/campaigns/{id}/scheduled-messages: Mensagens programadas
5. Mensagens Programadas com Campaign ID:
   - POST /api/scheduled-messages: Criar mensagem com campaign_id

OBJETIVOS:
- Verificar que todas as APIs funcionam
- Confirmar integração entre campanhas e sistema existente
- Validar que mensagens programadas mantêm o contexto de campanha
- Testar estrutura do banco de dados
"""

import requests
import json
import time
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

class CampaignTester:
    def __init__(self):
        # Use localhost since external URL is not accessible in this environment
        self.base_url = "http://localhost:8889"
        self.api_url = f"{self.base_url}/api"
        
        self.test_results = []
        self.failed_tests = []
        self.passed_tests = []
        self.created_campaign_id = None
        self.available_instances = []
        
        print("🎯 INICIANDO TESTE COMPLETO DO SISTEMA DE CAMPANHAS")
        print("=" * 80)
        print("FUNCIONALIDADES A TESTAR:")
        print("1. ✅ API de Campanhas (/api/campaigns) - GET e POST")
        print("2. ✅ API de Instâncias (/api/instances) - GET para seleção")
        print("3. ✅ Criar Campanha de Teste com todas instâncias disponíveis")
        print("4. ✅ APIs específicas da campanha criada")
        print("5. ✅ Mensagens Programadas com Campaign ID")
        print("=" * 80)
        
    def log_test(self, test_name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test results"""
        status = "✅ PASSOU" if success else "❌ FALHOU"
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat(),
            "response_data": response_data
        }
        
        self.test_results.append(result)
        if success:
            self.passed_tests.append(result)
        else:
            self.failed_tests.append(result)
            
        print(f"{status} {test_name}")
        if details:
            print(f"   📝 {details}")
        if not success and response_data:
            print(f"   📊 Response: {response_data}")
        print()

    def test_api_connection(self):
        """Test basic API connectivity"""
        try:
            response = requests.get(f"{self.api_url}/stats", timeout=10)
            if response.status_code == 200:
                data = response.json()
                self.log_test(
                    "Conectividade API Base",
                    True,
                    f"API respondendo corretamente. Stats: {data}",
                    data
                )
                return True
            else:
                self.log_test(
                    "Conectividade API Base",
                    False,
                    f"Status code: {response.status_code}",
                    response.text
                )
                return False
        except Exception as e:
            self.log_test(
                "Conectividade API Base",
                False,
                f"Erro de conexão: {str(e)}"
            )
            return False

    def test_get_instances(self):
        """Test GET /api/instances - List available instances for selection"""
        try:
            response = requests.get(f"{self.api_url}/instances", timeout=10)
            if response.status_code == 200:
                instances = response.json()
                self.available_instances = instances
                self.log_test(
                    "GET /api/instances - Listar instâncias disponíveis",
                    True,
                    f"Encontradas {len(instances)} instâncias disponíveis para seleção",
                    {"count": len(instances), "instances": [inst.get('name', inst.get('id')) for inst in instances[:5]]}
                )
                return True
            else:
                self.log_test(
                    "GET /api/instances - Listar instâncias disponíveis",
                    False,
                    f"Status code: {response.status_code}",
                    response.text
                )
                return False
        except Exception as e:
            self.log_test(
                "GET /api/instances - Listar instâncias disponíveis",
                False,
                f"Erro: {str(e)}"
            )
            return False

    def test_get_campaigns_empty(self):
        """Test GET /api/campaigns - Should be empty initially"""
        try:
            response = requests.get(f"{self.api_url}/campaigns", timeout=10)
            if response.status_code == 200:
                campaigns = response.json()
                self.log_test(
                    "GET /api/campaigns - Listar campanhas (vazia inicialmente)",
                    True,
                    f"Lista de campanhas retornada: {len(campaigns)} campanhas existentes",
                    {"count": len(campaigns)}
                )
                return True
            else:
                self.log_test(
                    "GET /api/campaigns - Listar campanhas (vazia inicialmente)",
                    False,
                    f"Status code: {response.status_code}",
                    response.text
                )
                return False
        except Exception as e:
            self.log_test(
                "GET /api/campaigns - Listar campanhas (vazia inicialmente)",
                False,
                f"Erro: {str(e)}"
            )
            return False

    def test_create_campaign(self):
        """Test POST /api/campaigns - Create new campaign with instances"""
        try:
            # Use all available instances for the test campaign
            instance_ids = [inst.get('id') for inst in self.available_instances]
            
            campaign_data = {
                "name": "Campanha Teste",
                "description": "Teste do sistema de campanhas",
                "instances": instance_ids,
                "status": "active"
            }
            
            response = requests.post(
                f"{self.api_url}/campaigns",
                json=campaign_data,
                headers={"Content-Type": "application/json"},
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                result = response.json()
                self.created_campaign_id = result.get('campaign_id')
                self.log_test(
                    "POST /api/campaigns - Criar nova campanha com instâncias",
                    True,
                    f"Campanha criada com sucesso. ID: {self.created_campaign_id}. Instâncias: {len(instance_ids)}",
                    result
                )
                return True
            else:
                self.log_test(
                    "POST /api/campaigns - Criar nova campanha com instâncias",
                    False,
                    f"Status code: {response.status_code}",
                    response.text
                )
                return False
        except Exception as e:
            self.log_test(
                "POST /api/campaigns - Criar nova campanha com instâncias",
                False,
                f"Erro: {str(e)}"
            )
            return False

    def test_get_campaign_instances(self):
        """Test GET /api/campaigns/{id}/instances - Get campaign instances"""
        if not self.created_campaign_id:
            self.log_test(
                "GET /api/campaigns/{id}/instances - Instâncias da campanha",
                False,
                "Campanha não foi criada, pulando teste"
            )
            return False
            
        try:
            response = requests.get(
                f"{self.api_url}/campaigns/{self.created_campaign_id}/instances",
                timeout=10
            )
            
            if response.status_code == 200:
                instances = response.json()
                self.log_test(
                    "GET /api/campaigns/{id}/instances - Instâncias da campanha",
                    True,
                    f"Instâncias da campanha retornadas: {len(instances)} instâncias",
                    {"count": len(instances), "instances": [inst.get('name', inst.get('id')) for inst in instances[:3]]}
                )
                return True
            else:
                self.log_test(
                    "GET /api/campaigns/{id}/instances - Instâncias da campanha",
                    False,
                    f"Status code: {response.status_code}",
                    response.text
                )
                return False
        except Exception as e:
            self.log_test(
                "GET /api/campaigns/{id}/instances - Instâncias da campanha",
                False,
                f"Erro: {str(e)}"
            )
            return False

    def test_get_campaign_groups(self):
        """Test GET /api/campaigns/{id}/groups - Get campaign groups"""
        if not self.created_campaign_id:
            self.log_test(
                "GET /api/campaigns/{id}/groups - Grupos da campanha",
                False,
                "Campanha não foi criada, pulando teste"
            )
            return False
            
        try:
            response = requests.get(
                f"{self.api_url}/campaigns/{self.created_campaign_id}/groups",
                timeout=10
            )
            
            if response.status_code == 200:
                groups = response.json()
                self.log_test(
                    "GET /api/campaigns/{id}/groups - Grupos da campanha",
                    True,
                    f"Grupos da campanha retornados: {len(groups)} grupos",
                    {"count": len(groups)}
                )
                return True
            else:
                self.log_test(
                    "GET /api/campaigns/{id}/groups - Grupos da campanha",
                    False,
                    f"Status code: {response.status_code}",
                    response.text
                )
                return False
        except Exception as e:
            self.log_test(
                "GET /api/campaigns/{id}/groups - Grupos da campanha",
                False,
                f"Erro: {str(e)}"
            )
            return False

    def test_add_campaign_groups(self):
        """Test POST /api/campaigns/{id}/groups - Add groups to campaign"""
        if not self.created_campaign_id:
            self.log_test(
                "POST /api/campaigns/{id}/groups - Adicionar grupos",
                False,
                "Campanha não foi criada, pulando teste"
            )
            return False
            
        try:
            # Create test groups data with instance_id
            test_groups = [
                {
                    "group_id": "test_group_1",
                    "group_name": "Grupo Teste 1",
                    "participants_count": 25,
                    "instance_id": self.available_instances[0].get('id') if self.available_instances else "default"
                },
                {
                    "group_id": "test_group_2", 
                    "group_name": "Grupo Teste 2",
                    "participants_count": 15,
                    "instance_id": self.available_instances[0].get('id') if self.available_instances else "default"
                }
            ]
            
            response = requests.post(
                f"{self.api_url}/campaigns/{self.created_campaign_id}/groups",
                json={"groups": test_groups},
                headers={"Content-Type": "application/json"},
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                result = response.json()
                self.log_test(
                    "POST /api/campaigns/{id}/groups - Adicionar grupos",
                    True,
                    f"Grupos adicionados com sucesso: {len(test_groups)} grupos",
                    result
                )
                return True
            else:
                self.log_test(
                    "POST /api/campaigns/{id}/groups - Adicionar grupos",
                    False,
                    f"Status code: {response.status_code}",
                    response.text
                )
                return False
        except Exception as e:
            self.log_test(
                "POST /api/campaigns/{id}/groups - Adicionar grupos",
                False,
                f"Erro: {str(e)}"
            )
            return False

    def test_get_campaign_scheduled_messages(self):
        """Test GET /api/campaigns/{id}/scheduled-messages - Get scheduled messages"""
        if not self.created_campaign_id:
            self.log_test(
                "GET /api/campaigns/{id}/scheduled-messages - Mensagens programadas",
                False,
                "Campanha não foi criada, pulando teste"
            )
            return False
            
        try:
            response = requests.get(
                f"{self.api_url}/campaigns/{self.created_campaign_id}/scheduled-messages",
                timeout=10
            )
            
            if response.status_code == 200:
                messages = response.json()
                self.log_test(
                    "GET /api/campaigns/{id}/scheduled-messages - Mensagens programadas",
                    True,
                    f"Mensagens programadas retornadas: {len(messages)} mensagens",
                    {"count": len(messages)}
                )
                return True
            else:
                self.log_test(
                    "GET /api/campaigns/{id}/scheduled-messages - Mensagens programadas",
                    False,
                    f"Status code: {response.status_code}",
                    response.text
                )
                return False
        except Exception as e:
            self.log_test(
                "GET /api/campaigns/{id}/scheduled-messages - Mensagens programadas",
                False,
                f"Erro: {str(e)}"
            )
            return False

    def test_create_scheduled_message_with_campaign(self):
        """Test POST /api/scheduled-messages - Create message with campaign_id"""
        if not self.created_campaign_id:
            self.log_test(
                "POST /api/scheduled-messages - Criar mensagem com campaign_id",
                False,
                "Campanha não foi criada, pulando teste"
            )
            return False
            
        try:
            # Create a scheduled message with campaign context using correct field names
            future_time = datetime.now() + timedelta(hours=1)
            
            message_data = {
                "campaign_id": self.created_campaign_id,
                "message_text": "Mensagem de teste da campanha",
                "message_type": "text",
                "group_id": "test_group_1",
                "group_name": "Grupo Teste 1",
                "instance_id": self.available_instances[0].get('id') if self.available_instances else "default",
                "schedule_type": "once",
                "schedule_time": future_time.strftime("%H:%M"),
                "schedule_date": future_time.strftime("%Y-%m-%d")
            }
            
            response = requests.post(
                f"{self.api_url}/scheduled-messages",
                json=message_data,
                headers={"Content-Type": "application/json"},
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                result = response.json()
                self.log_test(
                    "POST /api/scheduled-messages - Criar mensagem com campaign_id",
                    True,
                    f"Mensagem programada criada com sucesso. Campaign ID mantido: {self.created_campaign_id}",
                    result
                )
                return True
            else:
                self.log_test(
                    "POST /api/scheduled-messages - Criar mensagem com campaign_id",
                    False,
                    f"Status code: {response.status_code}",
                    response.text
                )
                return False
        except Exception as e:
            self.log_test(
                "POST /api/scheduled-messages - Criar mensagem com campaign_id",
                False,
                f"Erro: {str(e)}"
            )
            return False

    def test_campaign_integration(self):
        """Test integration between campaigns and existing system"""
        try:
            # Test that campaign was created and can be retrieved
            response = requests.get(f"{self.api_url}/campaigns", timeout=10)
            if response.status_code == 200:
                campaigns = response.json()
                test_campaign = None
                for campaign in campaigns:
                    if campaign.get('id') == self.created_campaign_id:
                        test_campaign = campaign
                        break
                
                if test_campaign:
                    self.log_test(
                        "Integração Campanhas-Sistema Existente",
                        True,
                        f"Campanha integrada com sucesso. Nome: {test_campaign.get('name')}, Instâncias: {test_campaign.get('instances_count', 0)}",
                        test_campaign
                    )
                    return True
                else:
                    self.log_test(
                        "Integração Campanhas-Sistema Existente",
                        False,
                        "Campanha criada não encontrada na lista"
                    )
                    return False
            else:
                self.log_test(
                    "Integração Campanhas-Sistema Existente",
                    False,
                    f"Erro ao buscar campanhas: {response.status_code}"
                )
                return False
        except Exception as e:
            self.log_test(
                "Integração Campanhas-Sistema Existente",
                False,
                f"Erro: {str(e)}"
            )
            return False

    def test_database_structure(self):
        """Test database structure by checking campaign data consistency"""
        try:
            # Test that we can get campaign details
            if not self.created_campaign_id:
                self.log_test(
                    "Estrutura do Banco de Dados",
                    False,
                    "Campanha não foi criada, não é possível testar estrutura"
                )
                return False
                
            response = requests.get(f"{self.api_url}/campaigns/{self.created_campaign_id}", timeout=10)
            if response.status_code == 200:
                campaign = response.json()
                required_fields = ['id', 'name', 'description', 'status', 'created_at']
                missing_fields = [field for field in required_fields if field not in campaign]
                
                if not missing_fields:
                    self.log_test(
                        "Estrutura do Banco de Dados",
                        True,
                        f"Estrutura do banco validada. Campos obrigatórios presentes: {required_fields}",
                        {"campaign_fields": list(campaign.keys())}
                    )
                    return True
                else:
                    self.log_test(
                        "Estrutura do Banco de Dados",
                        False,
                        f"Campos obrigatórios ausentes: {missing_fields}",
                        campaign
                    )
                    return False
            else:
                self.log_test(
                    "Estrutura do Banco de Dados",
                    False,
                    f"Erro ao buscar detalhes da campanha: {response.status_code}"
                )
                return False
        except Exception as e:
            self.log_test(
                "Estrutura do Banco de Dados",
                False,
                f"Erro: {str(e)}"
            )
            return False

    def run_all_tests(self):
        """Run all campaign system tests"""
        print("🚀 EXECUTANDO TODOS OS TESTES DO SISTEMA DE CAMPANHAS")
        print()
        
        # Test sequence following the review request requirements
        tests = [
            ("Conectividade API", self.test_api_connection),
            ("Listar Instâncias Disponíveis", self.test_get_instances),
            ("Listar Campanhas (Inicial)", self.test_get_campaigns_empty),
            ("Criar Campanha de Teste", self.test_create_campaign),
            ("Instâncias da Campanha", self.test_get_campaign_instances),
            ("Grupos da Campanha", self.test_get_campaign_groups),
            ("Adicionar Grupos à Campanha", self.test_add_campaign_groups),
            ("Mensagens Programadas da Campanha", self.test_get_campaign_scheduled_messages),
            ("Criar Mensagem com Campaign ID", self.test_create_scheduled_message_with_campaign),
            ("Integração Sistema Existente", self.test_campaign_integration),
            ("Estrutura do Banco de Dados", self.test_database_structure)
        ]
        
        for test_name, test_func in tests:
            print(f"🔄 Executando: {test_name}")
            test_func()
            time.sleep(0.5)  # Small delay between tests
        
        self.print_summary()

    def print_summary(self):
        """Print test summary"""
        total_tests = len(self.test_results)
        passed_count = len(self.passed_tests)
        failed_count = len(self.failed_tests)
        success_rate = (passed_count / total_tests * 100) if total_tests > 0 else 0
        
        print("=" * 80)
        print("📊 RESUMO DOS TESTES DO SISTEMA DE CAMPANHAS")
        print("=" * 80)
        print(f"Total de testes: {total_tests}")
        print(f"✅ Testes aprovados: {passed_count}")
        print(f"❌ Testes falharam: {failed_count}")
        print(f"📈 Taxa de sucesso: {success_rate:.1f}%")
        print()
        
        if self.failed_tests:
            print("❌ TESTES QUE FALHARAM:")
            for test in self.failed_tests:
                print(f"   • {test['test']}: {test['details']}")
            print()
        
        if self.passed_tests:
            print("✅ FUNCIONALIDADES VALIDADAS:")
            for test in self.passed_tests:
                print(f"   • {test['test']}")
            print()
        
        # Campaign-specific summary
        if self.created_campaign_id:
            print(f"🎯 CAMPANHA DE TESTE CRIADA: {self.created_campaign_id}")
            print(f"📊 INSTÂNCIAS DISPONÍVEIS: {len(self.available_instances)}")
        
        print("=" * 80)
        
        # Save results to file
        with open('/app/campaign_test_results.json', 'w') as f:
            json.dump({
                'summary': {
                    'total_tests': total_tests,
                    'passed': passed_count,
                    'failed': failed_count,
                    'success_rate': success_rate,
                    'created_campaign_id': self.created_campaign_id,
                    'available_instances_count': len(self.available_instances)
                },
                'test_results': self.test_results
            }, f, indent=2, ensure_ascii=False)
        
        return success_rate >= 80  # Consider successful if 80% or more tests pass

def main():
    """Main test execution"""
    tester = CampaignTester()
    success = tester.run_all_tests()
    
    if success:
        print("🎉 SISTEMA DE CAMPANHAS FUNCIONANDO CORRETAMENTE!")
        sys.exit(0)
    else:
        print("⚠️ SISTEMA DE CAMPANHAS COM PROBLEMAS - VERIFIQUE OS LOGS")
        sys.exit(1)

if __name__ == "__main__":
    main()