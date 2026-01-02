import { initializeApp, getApps } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Validate that all required environment variables are present
if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
  console.error('Missing Firebase environment variables. Please check your .env file.');
  console.error('Required variables:', {
    VITE_FIREBASE_API_KEY: !!firebaseConfig.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: !!firebaseConfig.authDomain,
    VITE_FIREBASE_PROJECT_ID: !!firebaseConfig.projectId,
    VITE_FIREBASE_STORAGE_BUCKET: !!firebaseConfig.storageBucket,
    VITE_FIREBASE_MESSAGING_SENDER_ID: !!firebaseConfig.messagingSenderId,
    VITE_FIREBASE_APP_ID: !!firebaseConfig.appId,
  });
  throw new Error('Firebase configuration is incomplete. Please check your .env file.');
}

// Initialize Firebase (singleton pattern)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

// Set persistence to LOCAL (browser storage) matching mobile AsyncStorage
setPersistence(auth, browserLocalPersistence);

export { auth, db };
export default app;
