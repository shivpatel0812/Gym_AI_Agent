import firebase_admin
from firebase_admin import credentials, firestore
import os
import json
import base64
from dotenv import load_dotenv

load_dotenv()

if not firebase_admin._apps:
    firebase_json_b64 = os.getenv("FIREBASE_SERVICE_ACCOUNT_B64")
    google_app_creds = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    
    if firebase_json_b64:
        try:
            firebase_json = json.loads(base64.b64decode(firebase_json_b64).decode())
            cred = credentials.Certificate(firebase_json)
            firebase_admin.initialize_app(cred)
            print("Firebase Admin initialized from base64 env var")
        except Exception as e:
            print(f"Error decoding base64 Firebase credentials: {e}")
            firebase_admin.initialize_app()
    elif google_app_creds:
        try:
            if os.path.exists(google_app_creds):
                cred = credentials.Certificate(google_app_creds)
                firebase_admin.initialize_app(cred)
                print(f"Firebase Admin initialized with service account file: {google_app_creds}")
            else:
                firebase_json = json.loads(google_app_creds)
                cred = credentials.Certificate(firebase_json)
                firebase_admin.initialize_app(cred)
                print("Firebase Admin initialized from JSON string")
        except json.JSONDecodeError:
            print(f"WARNING: GOOGLE_APPLICATION_CREDENTIALS is not a valid file path or JSON. Path: {google_app_creds}")
            firebase_admin.initialize_app()
        except Exception as e:
            print(f"Error initializing Firebase: {e}")
            firebase_admin.initialize_app()
    else:
        print("WARNING: Firebase credentials not found. Using default initialization.")
        firebase_admin.initialize_app()

db = firestore.client()

