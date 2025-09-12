#!/usr/bin/env python3
"""
Backend Test for WhatsFlow Real - Groups/Campaigns URL Corrections Validation
Testing critical validation after URL corrections for external IP access
"""

import requests
import json
import time
import sys
from datetime import datetime

class URLCorrectionsValidator:
    def __init__(self):
        # Test both localhost and external IP as mentioned in review request
        self.base_urls = [
            "http://localhost:8889",
            "http://78.46.250.112:8889"
        ]
        self.baileys_urls = [
            "http://localhost:3002", 
            "http://78.46.250.112:3002"
        ]
        self.test_results = []
        self.working_base_url = None
        self.working_baileys_url = None
        
    def log_test(self, test_name, success, message, details=None):
        """Log test results"""
        result = {
            'test': test_name,
            'success': success,
            'message': message,
            'timestamp': datetime.now().isoformat(),
            'details': details or {}
        }
        self.test_results.append(result)
        
        status = "✅" if success else "❌"
        print(f"{status} {test_name}: {message}")
        if details:
            for key, value in details.items():
                print(f"   {key}: {value}")
        print()

    def test_service_connectivity(self):
        """Test connectivity to both WhatsFlow and Baileys services"""
        print("🔍 Testing Service Connectivity...")
        
        # Test WhatsFlow Real service
        whatsflow_connected = False
        for url in self.base_urls:
            try:
                response = requests.get(f"{url}/", timeout=10)
                if response.status_code == 200:
                    self.working_base_url = url
                    whatsflow_connected = True
                    self.log_test(
                        "WhatsFlow Service Connectivity",
                        True,
                        f"WhatsFlow Real accessible at {url}",
                        {"status_code": response.status_code, "url": url}
                    )
                    break
            except Exception as e:
                continue
        
        if not whatsflow_connected:
            self.log_test(
                "WhatsFlow Service Connectivity",
                False,
                "WhatsFlow Real not accessible on any URL",
                {"tested_urls": self.base_urls}
            )
            return False
        
        # Test Baileys service
        baileys_connected = False
        for url in self.baileys_urls:
            try:
                response = requests.get(f"{url}/health", timeout=10)
                if response.status_code == 200:
                    self.working_baileys_url = url
                    baileys_connected = True
                    data = response.json()
                    self.log_test(
                        "Baileys Service Connectivity",
                        True,
                        f"Baileys service accessible at {url}",
                        {"status": data.get('status'), "uptime": data.get('uptime'), "url": url}
                    )
                    break
            except Exception as e:
                continue
        
        if not baileys_connected:
            self.log_test(
                "Baileys Service Connectivity",
                False,
                "Baileys service not accessible on any URL",
                {"tested_urls": self.baileys_urls}
            )
        
        return whatsflow_connected and baileys_connected

    def test_campaigns_api_get(self):
        """Test GET /api/campaigns returns 5 campaigns as expected"""
        print("🔍 Testing GET /api/campaigns...")
        
        if not self.working_base_url:
            self.log_test("GET /api/campaigns", False, "No working base URL available")
            return False
        
        try:
            response = requests.get(f"{self.working_base_url}/api/campaigns", timeout=10)
            
            if response.status_code == 200:
                campaigns = response.json()
                campaign_count = len(campaigns)
                
                # Verify we have the expected 5 campaigns
                if campaign_count == 5:
                    campaign_names = [c.get("name", "Unknown") for c in campaigns]
                    self.log_test(
                        "GET /api/campaigns",
                        True,
                        f"Successfully retrieved {campaign_count} campaigns",
                        {
                            "campaign_count": campaign_count,
                            "campaign_names": campaign_names
                        }
                    )
                    return True
                else:
                    self.log_test(
                        "GET /api/campaigns",
                        False,
                        f"Expected 5 campaigns, got {campaign_count}",
                        {"actual_count": campaign_count, "expected_count": 5}
                    )
                    return False
            else:
                self.log_test(
                    "GET /api/campaigns",
                    False,
                    f"API returned status {response.status_code}",
                    {"status_code": response.status_code, "response": response.text[:200]}
                )
                return False
                
        except Exception as e:
            self.log_test(
                "GET /api/campaigns",
                False,
                f"Exception occurred: {str(e)}",
                {"error_type": type(e).__name__}
            )
            return False

    def test_create_campaign(self):
        """Test POST /api/campaigns creates new campaign"""
        print("🔍 Testing POST /api/campaigns...")
        
        if not self.working_base_url:
            self.log_test("POST /api/campaigns", False, "No working base URL available")
            return False
        
        try:
            # Create test campaign
            test_campaign = {
                "name": "Test Campaign URL Validation",
                "description": "Testing campaign creation after URL corrections",
                "status": "active"
            }
            
            response = requests.post(
                f"{self.working_base_url}/api/campaigns",
                json=test_campaign,
                timeout=10
            )
            
            if response.status_code in [200, 201]:
                created_campaign = response.json()
                campaign_id = created_campaign.get('id')
                
                self.log_test(
                    "POST /api/campaigns",
                    True,
                    "Successfully created new campaign",
                    {
                        "campaign_id": campaign_id,
                        "campaign_name": created_campaign.get('name')
                    }
                )
                return True
            else:
                self.log_test(
                    "POST /api/campaigns",
                    False,
                    f"Failed to create campaign: {response.status_code}",
                    {"status_code": response.status_code, "response": response.text[:200]}
                )
                return False
                
        except Exception as e:
            self.log_test(
                "POST /api/campaigns",
                False,
                f"Exception occurred: {str(e)}",
                {"error_type": type(e).__name__}
            )
            return False

    def test_dynamic_url_configuration(self):
        """Test that URLs are using dynamic configuration instead of hardcoded localhost"""
        print("🔍 Testing Dynamic URL Configuration...")
        
        if not self.working_base_url:
            self.log_test("Dynamic URL Configuration", False, "No working base URL available")
            return False
        
        try:
            # Get the main page and check for dynamic URL configuration
            response = requests.get(f"{self.working_base_url}/", timeout=10)
            
            if response.status_code == 200:
                html_content = response.text
                
                # Check for dynamic URL configuration
                has_whatsflow_dynamic = "window.WHATSFLOW_API_URL = window.location.origin" in html_content
                has_api_base_config = "window.API_BASE_URL" in html_content
                
                config_details = {
                    "has_whatsflow_dynamic_config": has_whatsflow_dynamic,
                    "has_api_base_config": has_api_base_config
                }
                
                if has_whatsflow_dynamic and has_api_base_config:
                    self.log_test(
                        "Dynamic URL Configuration",
                        True,
                        "URLs are using dynamic configuration (window.location.origin)",
                        config_details
                    )
                    return True
                else:
                    self.log_test(
                        "Dynamic URL Configuration",
                        False,
                        "URLs may not be properly configured for dynamic access",
                        config_details
                    )
                    return False
            else:
                self.log_test(
                    "Dynamic URL Configuration",
                    False,
                    f"Could not retrieve main page: {response.status_code}",
                    {"status_code": response.status_code}
                )
                return False
                
        except Exception as e:
            self.log_test(
                "Dynamic URL Configuration",
                False,
                f"Exception occurred: {str(e)}",
                {"error_type": type(e).__name__}
            )
            return False

    def test_external_ip_access(self):
        """Test that system works with external IP (78.46.250.112:8889)"""
        print("🔍 Testing External IP Access...")
        
        external_url = "http://78.46.250.112:8889"
        
        try:
            response = requests.get(f"{external_url}/api/campaigns", timeout=15)
            
            if response.status_code == 200:
                campaigns = response.json()
                self.log_test(
                    "External IP Access",
                    True,
                    f"System accessible via external IP with {len(campaigns)} campaigns",
                    {
                        "external_url": external_url,
                        "campaign_count": len(campaigns)
                    }
                )
                return True
            else:
                self.log_test(
                    "External IP Access",
                    False,
                    f"External IP access failed: {response.status_code}",
                    {
                        "external_url": external_url,
                        "status_code": response.status_code
                    }
                )
                return False
                
        except Exception as e:
            self.log_test(
                "External IP Access",
                False,
                f"Cannot access system via external IP: {str(e)}",
                {
                    "external_url": external_url,
                    "error_type": type(e).__name__
                }
            )
            return False

    def test_crud_operations(self):
        """Test full CRUD operations on campaigns"""
        print("🔍 Testing CRUD Operations...")
        
        if not self.working_base_url:
            self.log_test("CRUD Operations", False, "No working base URL available")
            return False
        
        try:
            # CREATE - Already tested in test_create_campaign
            # Let's test UPDATE and DELETE
            
            # First get existing campaigns
            response = requests.get(f"{self.working_base_url}/api/campaigns", timeout=10)
            if response.status_code != 200:
                self.log_test("CRUD Operations", False, "Could not retrieve campaigns for CRUD test")
                return False
            
            campaigns = response.json()
            if not campaigns:
                self.log_test("CRUD Operations", False, "No campaigns available for CRUD test")
                return False
            
            # Test UPDATE (PUT)
            test_campaign = campaigns[0]
            campaign_id = test_campaign['id']
            
            updated_data = {
                "name": test_campaign['name'] + " - Updated",
                "description": "Updated description for testing",
                "status": "active"
            }
            
            update_response = requests.put(
                f"{self.working_base_url}/api/campaigns/{campaign_id}",
                json=updated_data,
                timeout=10
            )
            
            if update_response.status_code == 200:
                self.log_test(
                    "UPDATE Campaign",
                    True,
                    "Successfully updated campaign",
                    {"campaign_id": campaign_id}
                )
            else:
                self.log_test(
                    "UPDATE Campaign",
                    False,
                    f"Failed to update campaign: {update_response.status_code}",
                    {"campaign_id": campaign_id}
                )
                return False
            
            # Test DELETE
            delete_response = requests.delete(
                f"{self.working_base_url}/api/campaigns/{campaign_id}",
                timeout=10
            )
            
            if delete_response.status_code == 200:
                self.log_test(
                    "DELETE Campaign",
                    True,
                    "Successfully deleted campaign",
                    {"campaign_id": campaign_id}
                )
                return True
            else:
                self.log_test(
                    "DELETE Campaign",
                    False,
                    f"Failed to delete campaign: {delete_response.status_code}",
                    {"campaign_id": campaign_id}
                )
                return False
                
        except Exception as e:
            self.log_test(
                "CRUD Operations",
                False,
                f"Exception occurred: {str(e)}",
                {"error_type": type(e).__name__}
            )
            return False

    def run_validation(self):
        """Run all validation tests"""
        print("🚀 Starting WhatsFlow URL Corrections Validation")
        print("Testing groups tab functionality after URL corrections")
        print("=" * 70)
        
        start_time = time.time()
        
        # Test sequence
        tests = [
            ("Service Connectivity", self.test_service_connectivity),
            ("GET /api/campaigns (5 campaigns)", self.test_campaigns_api_get),
            ("POST /api/campaigns (create)", self.test_create_campaign),
            ("Dynamic URL Configuration", self.test_dynamic_url_configuration),
            ("External IP Access", self.test_external_ip_access),
            ("CRUD Operations", self.test_crud_operations)
        ]
        
        passed_tests = 0
        total_tests = len(tests)
        
        for test_name, test_func in tests:
            try:
                if test_func():
                    passed_tests += 1
            except Exception as e:
                self.log_test(
                    test_name,
                    False,
                    f"Test failed with exception: {str(e)}",
                    {"error_type": type(e).__name__}
                )
        
        # Summary
        end_time = time.time()
        duration = end_time - start_time
        success_rate = (passed_tests / total_tests) * 100
        
        print("=" * 70)
        print(f"🏁 Validation Summary:")
        print(f"   Tests Passed: {passed_tests}/{total_tests} ({success_rate:.1f}%)")
        print(f"   Duration: {duration:.2f} seconds")
        print(f"   Working WhatsFlow URL: {self.working_base_url}")
        print(f"   Working Baileys URL: {self.working_baileys_url}")
        
        # Save detailed results
        results_summary = {
            "timestamp": datetime.now().isoformat(),
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "success_rate": success_rate,
            "duration": duration,
            "working_urls": {
                "whatsflow": self.working_base_url,
                "baileys": self.working_baileys_url
            },
            "detailed_results": self.test_results
        }
        
        with open('/app/url_corrections_test_results.json', 'w') as f:
            json.dump(results_summary, f, indent=2)
        
        print(f"📊 Detailed results saved to: /app/url_corrections_test_results.json")
        
        return success_rate >= 80  # Consider 80%+ as successful

if __name__ == "__main__":
    validator = URLCorrectionsValidator()
    success = validator.run_validation()
    
    if success:
        print("\n🎉 URL corrections validation completed successfully!")
        sys.exit(0)
    else:
        print("\n❌ URL corrections validation failed!")
        sys.exit(1)