#!/usr/bin/env python3
import sqlite3

def check_campaigns():
    try:
        conn = sqlite3.connect('/app/whatsflow.db')
        cursor = conn.cursor()
        
        # Check campaigns table
        cursor.execute("SELECT COUNT(*) FROM campaigns")
        count = cursor.fetchone()[0]
        print(f"Total campaigns: {count}")
        
        # Get all campaigns
        cursor.execute("SELECT * FROM campaigns ORDER BY created_at DESC")
        campaigns = cursor.fetchall()
        
        print("\nCampaigns:")
        for campaign in campaigns:
            print(f"ID: {campaign[0]}, Name: {campaign[1]}, Status: {campaign[3]}")
        
        conn.close()
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_campaigns()