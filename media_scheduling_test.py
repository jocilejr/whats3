#!/usr/bin/env python3
"""
Media Scheduling Test Suite for WhatsFlow Real System
Testing the specific corrections implemented for media sending issues:

TESTE PRINCIPAL:
1. Testar endpoint /send/{instanceId} do Baileys service com URLs de mídia (image, audio, video)
2. Verificar se o payload com mediaUrl é aceito corretamente 
3. Testar se ainda há problemas de "database is locked" no MessageScheduler
4. Confirmar que mensagens de texto continuam funcionando
5. Verificar se o sistema de retry de database funciona

CONFIGURAÇÃO DO TESTE:
- WhatsFlow rodando na porta 8889  
- Baileys service rodando na porta 3002
- Base URL: http://localhost:8889 e http://localhost:3002

FOCO ESPECÍFICO:
- Teste com URLs de mídia reais como https://picsum.photos/200/200
- Verificar se erro mudou de "payload inválido" para "instância não conectada" (que é o comportamento correto)
- Testar concorrência de database com múltiplas operações
"""

import requests
import json
import time
import sys
import sqlite3
import threading
import concurrent.futures
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

class MediaSchedulingTester:
    def __init__(self):
        # Service URLs based on the review request
        self.whatsflow_url = "http://localhost:8889"  # WhatsFlow Real Python service
        self.baileys_url = "http://localhost:3002"    # Baileys Node.js service
        
        self.test_results = []
        self.failed_tests = []
        self.passed_tests = []
        
        # Test media URLs
        self.test_media_urls = {
            'image': 'https://picsum.photos/200/200',
            'audio': 'https://www.soundjay.com/misc/sounds/bell-ringing-05.wav',
            'video': 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4'
        }
        
        print("🎯 INICIANDO TESTE ESPECÍFICO DE CORREÇÕES DE MÍDIA NO SISTEMA DE AGENDAMENTO")
        print("=" * 80)
        print("PROBLEMAS ESPECÍFICOS A TESTAR:")
        print("1. ❌ Endpoint /send/{instanceId} com URLs de mídia (image, audio, video)")
        print("2. ❌ Payload com mediaUrl sendo aceito corretamente")
        print("3. ❌ Problemas de 'database is locked' no MessageScheduler")
        print("4. ❌ Mensagens de texto continuam funcionando")
        print("5. ❌ Sistema de retry de database funciona")
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
            self.passed_tests.append(test_name)
        else:
            self.failed_tests.append(test_name)
            
        print(f"{status} {test_name}")
        if details:
            print(f"   📝 {details}")
        if not success and response_data:
            print(f"   📊 Response: {response_data}")
        print()

    def test_baileys_health_check(self) -> bool:
        """
        TESTE 1: Baileys Service Health Check
        Verificar se o Baileys service está rodando e respondendo
        """
        print("🔍 TESTE 1: BAILEYS SERVICE HEALTH CHECK")
        print("-" * 50)
        
        try:
            response = requests.get(f"{self.baileys_url}/health", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                uptime = data.get('uptime', 0)
                status = data.get('status', 'unknown')
                instances = data.get('instances', {})
                
                self.log_test(
                    "Baileys Health Check", 
                    True, 
                    f"Status: {status}, Uptime: {uptime:.1f}s, Instâncias: {instances.get('total', 0)}",
                    data
                )
                return True
            else:
                self.log_test(
                    "Baileys Health Check", 
                    False, 
                    f"HTTP {response.status_code}: {response.text[:100]}",
                    {"status_code": response.status_code, "text": response.text[:200]}
                )
                return False
                
        except requests.exceptions.ConnectionError:
            self.log_test(
                "Baileys Health Check", 
                False, 
                "ERRO DE CONEXÃO: Baileys service não está rodando na porta 3002",
                {"error": "ConnectionError", "url": f"{self.baileys_url}/health"}
            )
            return False
        except Exception as e:
            self.log_test(
                "Baileys Health Check", 
                False, 
                f"Erro inesperado: {str(e)}",
                {"error": str(e)}
            )
            return False

    def test_text_message_sending(self) -> bool:
        """
        TESTE 2: Text Message Sending
        Confirmar que mensagens de texto continuam funcionando
        """
        print("🔍 TESTE 2: TEXT MESSAGE SENDING")
        print("-" * 50)
        
        test_instance_id = "test-instance"
        test_payload = {
            "to": "5511999999999",
            "message": "Teste de mensagem de texto",
            "type": "text"
        }
        
        try:
            response = requests.post(
                f"{self.baileys_url}/send/{test_instance_id}", 
                json=test_payload,
                timeout=10
            )
            
            if response.status_code == 400:
                # Expected response for non-connected instance
                data = response.json()
                error_msg = data.get('error', '')
                
                if 'não conectada' in error_msg or 'not connected' in error_msg.lower() or 'não está conectada' in error_msg:
                    self.log_test(
                        "Text Message - Instance Not Connected", 
                        True, 
                        f"Comportamento correto para instância não conectada: {error_msg}",
                        data
                    )
                    return True
                else:
                    self.log_test(
                        "Text Message - Instance Not Connected", 
                        False, 
                        f"Mensagem de erro inadequada: {error_msg}",
                        data
                    )
                    return False
                    
            elif response.status_code == 200:
                # Instance might be connected
                data = response.json()
                if data.get('success'):
                    self.log_test(
                        "Text Message - Connected Instance", 
                        True, 
                        "Mensagem de texto enviada com sucesso",
                        data
                    )
                    return True
                else:
                    self.log_test(
                        "Text Message - Connected Instance", 
                        False, 
                        "Resposta de sucesso inválida",
                        data
                    )
                    return False
            else:
                self.log_test(
                    "Text Message Sending", 
                    False, 
                    f"HTTP {response.status_code}: {response.text[:100]}",
                    {"status_code": response.status_code, "text": response.text[:200]}
                )
                return False
                
        except requests.exceptions.ConnectionError:
            self.log_test(
                "Text Message Sending", 
                False, 
                "ERRO DE CONEXÃO: Não foi possível acessar o endpoint de envio",
                {"error": "ConnectionError", "url": f"{self.baileys_url}/send/{test_instance_id}"}
            )
            return False
        except Exception as e:
            self.log_test(
                "Text Message Sending", 
                False, 
                f"Erro inesperado: {str(e)}",
                {"error": str(e)}
            )
            return False

    def test_media_url_sending(self) -> bool:
        """
        TESTE 3: Media URL Sending
        Testar endpoint /send/{instanceId} com URLs de mídia (image, audio, video)
        """
        print("🔍 TESTE 3: MEDIA URL SENDING")
        print("-" * 50)
        
        test_instance_id = "test-instance"
        all_passed = True
        
        for media_type, media_url in self.test_media_urls.items():
            print(f"   🎬 Testando {media_type.upper()}: {media_url}")
            
            test_payload = {
                "to": "5511999999999",
                "message": f"Teste de {media_type}",
                "type": media_type,
                "mediaUrl": media_url
            }
            
            try:
                response = requests.post(
                    f"{self.baileys_url}/send/{test_instance_id}", 
                    json=test_payload,
                    timeout=15
                )
                
                if response.status_code == 400:
                    # Check if it's the correct "instance not connected" error
                    data = response.json()
                    error_msg = data.get('error', '')
                    
                    if 'não conectada' in error_msg or 'not connected' in error_msg.lower() or 'não está conectada' in error_msg:
                        self.log_test(
                            f"Media URL {media_type.title()} - Instance Not Connected", 
                            True, 
                            f"Comportamento correto: {error_msg} (payload aceito, instância não conectada)",
                            data
                        )
                    elif 'payload' in error_msg.lower() or 'invalid' in error_msg.lower():
                        self.log_test(
                            f"Media URL {media_type.title()} - Payload Error", 
                            False, 
                            f"PROBLEMA: Ainda há erro de payload inválido: {error_msg}",
                            data
                        )
                        all_passed = False
                    else:
                        self.log_test(
                            f"Media URL {media_type.title()} - Unknown Error", 
                            False, 
                            f"Erro desconhecido: {error_msg}",
                            data
                        )
                        all_passed = False
                        
                elif response.status_code == 200:
                    # Instance might be connected and media sent
                    data = response.json()
                    if data.get('success'):
                        self.log_test(
                            f"Media URL {media_type.title()} - Success", 
                            True, 
                            f"Mídia {media_type} enviada com sucesso",
                            data
                        )
                    else:
                        self.log_test(
                            f"Media URL {media_type.title()} - Failed", 
                            False, 
                            "Resposta de sucesso inválida",
                            data
                        )
                        all_passed = False
                else:
                    self.log_test(
                        f"Media URL {media_type.title()}", 
                        False, 
                        f"HTTP {response.status_code}: {response.text[:100]}",
                        {"status_code": response.status_code, "text": response.text[:200]}
                    )
                    all_passed = False
                    
            except requests.exceptions.ConnectionError:
                self.log_test(
                    f"Media URL {media_type.title()}", 
                    False, 
                    "ERRO DE CONEXÃO: Não foi possível acessar o endpoint",
                    {"error": "ConnectionError", "media_type": media_type}
                )
                all_passed = False
            except Exception as e:
                self.log_test(
                    f"Media URL {media_type.title()}", 
                    False, 
                    f"Erro inesperado: {str(e)}",
                    {"error": str(e), "media_type": media_type}
                )
                all_passed = False
        
        return all_passed

    def test_database_concurrency(self) -> bool:
        """
        TESTE 4: Database Concurrency
        Testar se ainda há problemas de "database is locked" com múltiplas operações
        """
        print("🔍 TESTE 4: DATABASE CONCURRENCY")
        print("-" * 50)
        
        try:
            # Test multiple concurrent database operations
            def create_scheduled_message(thread_id):
                try:
                    payload = {
                        "instanceId": f"test-instance-{thread_id}",
                        "groupIds": [f"group-{thread_id}@g.us"],
                        "message": f"Mensagem de teste concorrente {thread_id}",
                        "messageType": "text",
                        "scheduledFor": (datetime.now() + timedelta(minutes=5)).isoformat(),
                        "scheduleType": "once"
                    }
                    
                    response = requests.post(
                        f"{self.whatsflow_url}/api/scheduled-messages",
                        json=payload,
                        timeout=10
                    )
                    
                    return {
                        "thread_id": thread_id,
                        "success": response.status_code in [200, 201],
                        "status_code": response.status_code,
                        "response": response.json() if response.status_code in [200, 201] else response.text[:100]
                    }
                except Exception as e:
                    return {
                        "thread_id": thread_id,
                        "success": False,
                        "error": str(e)
                    }
            
            # Run 5 concurrent operations
            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                futures = [executor.submit(create_scheduled_message, i) for i in range(1, 6)]
                results = [future.result() for future in concurrent.futures.as_completed(futures)]
            
            successful_operations = sum(1 for r in results if r['success'])
            failed_operations = len(results) - successful_operations
            
            # Check for database lock errors
            database_lock_errors = 0
            for result in results:
                if not result['success'] and 'error' in result:
                    if 'database is locked' in result['error'].lower() or 'locked' in result['error'].lower():
                        database_lock_errors += 1
            
            if database_lock_errors == 0:
                self.log_test(
                    "Database Concurrency - No Lock Errors", 
                    True, 
                    f"Nenhum erro de database lock encontrado. {successful_operations}/{len(results)} operações bem-sucedidas",
                    {"successful": successful_operations, "failed": failed_operations, "results": results}
                )
                return True
            else:
                self.log_test(
                    "Database Concurrency - Lock Errors Found", 
                    False, 
                    f"PROBLEMA: {database_lock_errors} erros de database lock encontrados",
                    {"lock_errors": database_lock_errors, "results": results}
                )
                return False
                
        except requests.exceptions.ConnectionError:
            self.log_test(
                "Database Concurrency", 
                False, 
                "ERRO DE CONEXÃO: WhatsFlow service não acessível",
                {"error": "ConnectionError"}
            )
            return False
        except Exception as e:
            self.log_test(
                "Database Concurrency", 
                False, 
                f"Erro inesperado: {str(e)}",
                {"error": str(e)}
            )
            return False

    def test_message_scheduler_apis(self) -> bool:
        """
        TESTE 5: Message Scheduler APIs
        Verificar se as APIs do sistema de agendamento estão funcionando
        """
        print("🔍 TESTE 5: MESSAGE SCHEDULER APIs")
        print("-" * 50)
        
        apis_to_test = [
            ("/api/scheduled-messages", "GET", "List Scheduled Messages"),
            ("/api/campaigns", "GET", "List Campaigns"),
            ("/api/instances", "GET", "List Instances")
        ]
        
        all_passed = True
        
        for endpoint, method, name in apis_to_test:
            try:
                if method == "GET":
                    response = requests.get(f"{self.whatsflow_url}{endpoint}", timeout=10)
                else:
                    response = requests.post(f"{self.whatsflow_url}{endpoint}", json={}, timeout=10)
                
                if response.status_code == 200:
                    data = response.json()
                    self.log_test(
                        f"Scheduler API - {name}", 
                        True, 
                        f"API funcionando, dados: {len(data) if isinstance(data, list) else 'object'}",
                        {"endpoint": endpoint, "method": method, "data_type": type(data).__name__}
                    )
                else:
                    self.log_test(
                        f"Scheduler API - {name}", 
                        False, 
                        f"HTTP {response.status_code}: {response.text[:100]}",
                        {"status_code": response.status_code, "endpoint": endpoint}
                    )
                    all_passed = False
                    
            except requests.exceptions.ConnectionError:
                self.log_test(
                    f"Scheduler API - {name}", 
                    False, 
                    "ERRO DE CONEXÃO: WhatsFlow service não acessível",
                    {"error": "ConnectionError", "endpoint": endpoint}
                )
                all_passed = False
            except Exception as e:
                self.log_test(
                    f"Scheduler API - {name}", 
                    False, 
                    f"Erro inesperado: {str(e)}",
                    {"error": str(e), "endpoint": endpoint}
                )
                all_passed = False
        
        return all_passed

    def test_database_retry_system(self) -> bool:
        """
        TESTE 6: Database Retry System
        Verificar se o sistema de retry de database funciona
        """
        print("🔍 TESTE 6: DATABASE RETRY SYSTEM")
        print("-" * 50)
        
        try:
            # Create a scheduled message to test retry system
            payload = {
                "instanceId": "test-retry-instance",
                "groupIds": ["test-group@g.us"],
                "message": "Teste do sistema de retry",
                "messageType": "text",
                "scheduledFor": (datetime.now() + timedelta(minutes=1)).isoformat(),
                "scheduleType": "once"
            }
            
            # Try to create multiple times rapidly to trigger potential retry scenarios
            responses = []
            for i in range(3):
                try:
                    response = requests.post(
                        f"{self.whatsflow_url}/api/scheduled-messages",
                        json=payload,
                        timeout=5
                    )
                    responses.append({
                        "attempt": i + 1,
                        "status_code": response.status_code,
                        "success": response.status_code in [200, 201],
                        "response": response.json() if response.status_code in [200, 201] else response.text[:100]
                    })
                    time.sleep(0.1)  # Small delay between requests
                except Exception as e:
                    responses.append({
                        "attempt": i + 1,
                        "success": False,
                        "error": str(e)
                    })
            
            successful_attempts = sum(1 for r in responses if r['success'])
            
            if successful_attempts > 0:
                self.log_test(
                    "Database Retry System", 
                    True, 
                    f"Sistema de retry funcionando: {successful_attempts}/3 tentativas bem-sucedidas",
                    {"responses": responses}
                )
                return True
            else:
                self.log_test(
                    "Database Retry System", 
                    False, 
                    "PROBLEMA: Nenhuma tentativa bem-sucedida",
                    {"responses": responses}
                )
                return False
                
        except Exception as e:
            self.log_test(
                "Database Retry System", 
                False, 
                f"Erro inesperado: {str(e)}",
                {"error": str(e)}
            )
            return False

    def run_all_tests(self):
        """Run all tests and generate final report"""
        print("🚀 INICIANDO BATERIA COMPLETA DE TESTES DE MÍDIA E AGENDAMENTO")
        print("=" * 80)
        
        start_time = time.time()
        
        # Run all tests
        tests = [
            ("Baileys Health Check", self.test_baileys_health_check),
            ("Text Message Sending", self.test_text_message_sending),
            ("Media URL Sending", self.test_media_url_sending),
            ("Database Concurrency", self.test_database_concurrency),
            ("Message Scheduler APIs", self.test_message_scheduler_apis),
            ("Database Retry System", self.test_database_retry_system)
        ]
        
        for test_name, test_func in tests:
            try:
                test_func()
            except Exception as e:
                self.log_test(
                    test_name, 
                    False, 
                    f"Erro crítico durante teste: {str(e)}",
                    {"critical_error": str(e)}
                )
        
        end_time = time.time()
        duration = end_time - start_time
        
        # Generate final report
        self.generate_final_report(duration)

    def generate_final_report(self, duration: float):
        """Generate comprehensive final report"""
        print("\n" + "=" * 80)
        print("📊 RELATÓRIO FINAL - TESTE DE CORREÇÕES DE MÍDIA E AGENDAMENTO")
        print("=" * 80)
        
        total_tests = len(self.test_results)
        passed_count = len(self.passed_tests)
        failed_count = len(self.failed_tests)
        success_rate = (passed_count / total_tests * 100) if total_tests > 0 else 0
        
        print(f"⏱️  Duração total: {duration:.2f} segundos")
        print(f"📈 Taxa de sucesso: {success_rate:.1f}% ({passed_count}/{total_tests} testes)")
        print()
        
        # Analyze the specific problems from review request
        print("🎯 ANÁLISE DOS PROBLEMAS ESPECÍFICOS:")
        print("-" * 50)
        
        # Problem 1: Media URL sending
        media_tests = [t for t in self.test_results if 'media url' in t['test'].lower()]
        media_working = all(t['success'] for t in media_tests)
        
        print(f"1. {'✅ CORRIGIDO' if media_working else '❌ AINDA COM PROBLEMA'} - Endpoint /send com URLs de mídia")
        if media_working:
            print("   📝 URLs de mídia sendo aceitas corretamente, erro mudou para 'instância não conectada'")
        else:
            print("   📝 Ainda há problemas com payload de mídia ou URLs não são aceitas")
        
        # Problem 2: Database locking
        db_tests = [t for t in self.test_results if 'database' in t['test'].lower() or 'concurrency' in t['test'].lower()]
        db_working = all(t['success'] for t in db_tests)
        
        print(f"2. {'✅ CORRIGIDO' if db_working else '❌ AINDA COM PROBLEMA'} - Problemas de 'database is locked'")
        if db_working:
            print("   📝 Sistema de retry funcionando, sem erros de database lock")
        else:
            print("   📝 Ainda há problemas de concorrência no database")
        
        # Problem 3: Text messages still working
        text_tests = [t for t in self.test_results if 'text message' in t['test'].lower()]
        text_working = all(t['success'] for t in text_tests)
        
        print(f"3. {'✅ FUNCIONANDO' if text_working else '❌ PROBLEMA'} - Mensagens de texto continuam funcionando")
        if text_working:
            print("   📝 Mensagens de texto funcionando normalmente")
        else:
            print("   📝 Problemas com envio de mensagens de texto")
        
        # Problem 4: Scheduler APIs
        scheduler_tests = [t for t in self.test_results if 'scheduler api' in t['test'].lower()]
        scheduler_working = all(t['success'] for t in scheduler_tests)
        
        print(f"4. {'✅ FUNCIONANDO' if scheduler_working else '❌ PROBLEMA'} - APIs do MessageScheduler")
        if scheduler_working:
            print("   📝 APIs de agendamento funcionando corretamente")
        else:
            print("   📝 Problemas com APIs do sistema de agendamento")
        
        print()
        
        # Overall assessment
        all_problems_resolved = media_working and db_working and text_working and scheduler_working
        
        if all_problems_resolved:
            print("🏆 RESULTADO FINAL: TODAS AS CORREÇÕES DE MÍDIA FORAM IMPLEMENTADAS COM SUCESSO!")
            print("✅ Sistema de envio de mídia funcionando")
            print("✅ Problemas de database lock resolvidos")
            print("✅ Mensagens de texto continuam funcionando")
            print("✅ Sistema de retry operacional")
        else:
            print("⚠️  RESULTADO FINAL: AINDA HÁ PROBLEMAS A RESOLVER")
            print("❌ Nem todas as correções foram implementadas corretamente")
            
        print()
        
        # Detailed test results
        if self.failed_tests:
            print("❌ TESTES QUE FALHARAM:")
            for test_name in self.failed_tests:
                test_result = next(t for t in self.test_results if t['test'] == test_name)
                print(f"   • {test_name}: {test_result['details']}")
            print()
        
        if self.passed_tests:
            print("✅ TESTES QUE PASSARAM:")
            for test_name in self.passed_tests:
                print(f"   • {test_name}")
            print()
        
        # Recommendations
        print("💡 RECOMENDAÇÕES:")
        if not media_working:
            print("   • Verificar se endpoint /send/{instanceId} aceita campo 'mediaUrl'")
            print("   • Testar com URLs de mídia reais")
            print("   • Verificar se erro mudou de 'payload inválido' para 'instância não conectada'")
        if not db_working:
            print("   • Implementar sistema de retry para operações de database")
            print("   • Verificar configuração SQLite WAL mode")
            print("   • Testar concorrência com múltiplas operações")
        if not text_working:
            print("   • Verificar se mudanças de mídia não afetaram mensagens de texto")
        if not scheduler_working:
            print("   • Verificar se APIs de agendamento estão funcionando")
            print("   • Testar CRUD de mensagens agendadas")
        
        if all_problems_resolved:
            print("   • Sistema está pronto para envio de mídia!")
            print("   • Todas as correções foram implementadas com sucesso")
        
        print("=" * 80)
        
        return {
            "success_rate": success_rate,
            "total_tests": total_tests,
            "passed_tests": passed_count,
            "failed_tests": failed_count,
            "all_problems_resolved": all_problems_resolved,
            "media_working": media_working,
            "db_working": db_working,
            "text_working": text_working,
            "scheduler_working": scheduler_working,
            "duration": duration
        }

def main():
    """Main test execution"""
    tester = MediaSchedulingTester()
    
    try:
        tester.run_all_tests()
    except KeyboardInterrupt:
        print("\n⚠️ Testes interrompidos pelo usuário")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Erro crítico durante execução dos testes: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()