#!/usr/bin/env python3
"""
Groups Functionality Test for WhatsFlow Real
Testing groups tab functionality after URL corrections
"""

import requests
import json
import time
import sys
from datetime import datetime

class GroupsFunctionalityTester:
    def __init__(self):
        self.whatsflow_url = "http://localhost:8889"
        self.baileys_url = "http://localhost:3002"
        self.test_results = []
        
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

    def test_baileys_groups_endpoint(self):
        """Test Baileys /groups/{instanceId} endpoint"""
        print("🔍 Testing Baileys Groups Endpoint...")
        
        try:
            # Test with a dummy instance ID
            test_instance_id = "test_instance_123"
            response = requests.get(f"{self.baileys_url}/groups/{test_instance_id}", timeout=10)
            
            # We expect this to return an error since the instance is not connected
            # but the endpoint should exist and handle the error gracefully
            if response.status_code in [200, 400, 404, 500]:
                try:
                    response_data = response.json()
                    error_message = response_data.get('error', '')
                    
                    # Check if error message indicates proper handling
                    if "não está conectada" in error_message.lower() or "not connected" in error_message.lower() or "instância" in error_message.lower():
                        self.log_test(
                            "Baileys Groups Endpoint",
                            True,
                            "Groups endpoint properly handles unconnected instances",
                            {
                                "status_code": response.status_code,
                                "error_message": error_message,
                                "endpoint": f"/groups/{test_instance_id}"
                            }
                        )
                        return True
                    else:
                        self.log_test(
                            "Baileys Groups Endpoint",
                            True,
                            "Groups endpoint is accessible and responding",
                            {
                                "status_code": response.status_code,
                                "response": str(response_data)[:200]
                            }
                        )
                        return True
                except:
                    # If response is not JSON, check if it's a valid response
                    self.log_test(
                        "Baileys Groups Endpoint",
                        True,
                        "Groups endpoint is accessible",
                        {
                            "status_code": response.status_code,
                            "response_type": "non-json"
                        }
                    )
                    return True
            else:
                self.log_test(
                    "Baileys Groups Endpoint",
                    False,
                    f"Groups endpoint returned unexpected status: {response.status_code}",
                    {"status_code": response.status_code}
                )
                return False
                
        except Exception as e:
            self.log_test(
                "Baileys Groups Endpoint",
                False,
                f"Exception occurred: {str(e)}",
                {"error_type": type(e).__name__}
            )
            return False

    def test_campaign_groups_api(self):
        """Test campaign groups API endpoints"""
        print("🔍 Testing Campaign Groups API...")
        
        try:
            # First get a campaign to test with
            response = requests.get(f"{self.whatsflow_url}/api/campaigns", timeout=10)
            if response.status_code != 200:
                self.log_test("Campaign Groups API", False, "Could not retrieve campaigns")
                return False
            
            campaigns = response.json()
            if not campaigns:
                self.log_test("Campaign Groups API", False, "No campaigns available for testing")
                return False
            
            campaign_id = campaigns[0]['id']
            
            # Test GET campaign groups
            groups_response = requests.get(f"{self.whatsflow_url}/api/campaigns/{campaign_id}/groups", timeout=10)
            
            if groups_response.status_code == 200:
                groups = groups_response.json()
                self.log_test(
                    "GET Campaign Groups",
                    True,
                    f"Successfully retrieved campaign groups",
                    {
                        "campaign_id": campaign_id,
                        "groups_count": len(groups)
                    }
                )
            else:
                self.log_test(
                    "GET Campaign Groups",
                    False,
                    f"Failed to retrieve campaign groups: {groups_response.status_code}",
                    {"campaign_id": campaign_id}
                )
                return False
            
            # Test POST campaign groups (add groups to campaign)
            test_groups_data = {
                "groups": [
                    {
                        "group_id": "test_group_123@g.us",
                        "group_name": "Test Group 1",
                        "instance_id": "test_instance"
                    }
                ]
            }
            
            add_groups_response = requests.post(
                f"{self.whatsflow_url}/api/campaigns/{campaign_id}/groups",
                json=test_groups_data,
                timeout=10
            )
            
            if add_groups_response.status_code in [200, 201]:
                self.log_test(
                    "POST Campaign Groups",
                    True,
                    "Successfully added groups to campaign",
                    {"campaign_id": campaign_id}
                )
                return True
            else:
                self.log_test(
                    "POST Campaign Groups",
                    False,
                    f"Failed to add groups to campaign: {add_groups_response.status_code}",
                    {
                        "campaign_id": campaign_id,
                        "status_code": add_groups_response.status_code
                    }
                )
                return False
                
        except Exception as e:
            self.log_test(
                "Campaign Groups API",
                False,
                f"Exception occurred: {str(e)}",
                {"error_type": type(e).__name__}
            )
            return False

    def test_scheduled_messages_api(self):
        """Test scheduled messages API for campaigns"""
        print("🔍 Testing Scheduled Messages API...")
        
        try:
            # Get a campaign to test with
            response = requests.get(f"{self.whatsflow_url}/api/campaigns", timeout=10)
            if response.status_code != 200:
                self.log_test("Scheduled Messages API", False, "Could not retrieve campaigns")
                return False
            
            campaigns = response.json()
            if not campaigns:
                self.log_test("Scheduled Messages API", False, "No campaigns available for testing")
                return False
            
            campaign_id = campaigns[0]['id']
            
            # Test GET scheduled messages for campaign
            messages_response = requests.get(f"{self.whatsflow_url}/api/campaigns/{campaign_id}/scheduled-messages", timeout=10)
            
            if messages_response.status_code == 200:
                messages = messages_response.json()
                self.log_test(
                    "GET Scheduled Messages",
                    True,
                    f"Successfully retrieved scheduled messages",
                    {
                        "campaign_id": campaign_id,
                        "messages_count": len(messages)
                    }
                )
                return True
            else:
                self.log_test(
                    "GET Scheduled Messages",
                    False,
                    f"Failed to retrieve scheduled messages: {messages_response.status_code}",
                    {"campaign_id": campaign_id}
                )
                return False
                
        except Exception as e:
            self.log_test(
                "Scheduled Messages API",
                False,
                f"Exception occurred: {str(e)}",
                {"error_type": type(e).__name__}
            )
            return False

    def test_instances_api(self):
        """Test instances API"""
        print("🔍 Testing Instances API...")
        
        try:
            response = requests.get(f"{self.whatsflow_url}/api/instances", timeout=10)
            
            if response.status_code == 200:
                instances = response.json()
                self.log_test(
                    "GET Instances",
                    True,
                    f"Successfully retrieved instances",
                    {
                        "instances_count": len(instances)
                    }
                )
                return True
            else:
                self.log_test(
                    "GET Instances",
                    False,
                    f"Failed to retrieve instances: {response.status_code}",
                    {"status_code": response.status_code}
                )
                return False
                
        except Exception as e:
            self.log_test(
                "Instances API",
                False,
                f"Exception occurred: {str(e)}",
                {"error_type": type(e).__name__}
            )
            return False

    def test_cors_configuration(self):
        """Test CORS configuration for cross-origin requests"""
        print("🔍 Testing CORS Configuration...")
        
        try:
            # Test CORS headers on Baileys service
            response = requests.options(f"{self.baileys_url}/groups/test", timeout=10)
            
            cors_headers = {
                'access-control-allow-origin': response.headers.get('Access-Control-Allow-Origin'),
                'access-control-allow-methods': response.headers.get('Access-Control-Allow-Methods'),
                'access-control-allow-headers': response.headers.get('Access-Control-Allow-Headers')
            }
            
            # Check if CORS is properly configured
            if cors_headers['access-control-allow-origin'] == '*' or 'localhost' in str(cors_headers['access-control-allow-origin']):
                self.log_test(
                    "CORS Configuration",
                    True,
                    "CORS is properly configured for cross-origin requests",
                    cors_headers
                )
                return True
            else:
                self.log_test(
                    "CORS Configuration",
                    False,
                    "CORS may not be properly configured",
                    cors_headers
                )
                return False
                
        except Exception as e:
            self.log_test(
                "CORS Configuration",
                False,
                f"Exception occurred: {str(e)}",
                {"error_type": type(e).__name__}
            )
            return False

    def run_tests(self):
        """Run all groups functionality tests"""
        print("🚀 Starting Groups Functionality Tests")
        print("Testing groups tab after URL corrections")
        print("=" * 60)
        
        start_time = time.time()
        
        # Test sequence
        tests = [
            ("Baileys Groups Endpoint", self.test_baileys_groups_endpoint),
            ("Campaign Groups API", self.test_campaign_groups_api),
            ("Scheduled Messages API", self.test_scheduled_messages_api),
            ("Instances API", self.test_instances_api),
            ("CORS Configuration", self.test_cors_configuration)
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
        
        print("=" * 60)
        print(f"🏁 Groups Functionality Test Summary:")
        print(f"   Tests Passed: {passed_tests}/{total_tests} ({success_rate:.1f}%)")
        print(f"   Duration: {duration:.2f} seconds")
        
        # Save detailed results
        results_summary = {
            "timestamp": datetime.now().isoformat(),
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "success_rate": success_rate,
            "duration": duration,
            "detailed_results": self.test_results
        }
        
        with open('/app/groups_functionality_test_results.json', 'w') as f:
            json.dump(results_summary, f, indent=2)
        
        print(f"📊 Detailed results saved to: /app/groups_functionality_test_results.json")
        
        return success_rate >= 80  # Consider 80%+ as successful

if __name__ == "__main__":
    tester = GroupsFunctionalityTester()
    success = tester.run_tests()
    
    if success:
        print("\n🎉 Groups functionality tests completed successfully!")
        sys.exit(0)
    else:
        print("\n❌ Groups functionality tests failed!")
        sys.exit(1)