import firebase_admin
from firebase_admin import credentials, firestore
import os
from dotenv import load_dotenv

load_dotenv()

if not firebase_admin._apps:
    cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path and os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
        print(f"Firebase Admin initialized with service account: {cred_path}")
    else:
        print("WARNING: GOOGLE_APPLICATION_CREDENTIALS not set or file not found. Firebase Admin may not work properly for token verification.")
        print(f"Expected path: {cred_path}")
        firebase_admin.initialize_app()

db = firestore.client()

