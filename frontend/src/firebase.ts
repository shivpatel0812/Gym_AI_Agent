import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import Constants from 'expo-constants';

const firebaseConfig = {
  apiKey: Constants.expoConfig?.extra?.firebaseApiKey || "AIzaSyDhBB_67ZjxoWGtf6RlrHdxyZTMrJfaU-g",
  authDomain: Constants.expoConfig?.extra?.firebaseAuthDomain || "gymapp-5cb9b.firebaseapp.com",
  projectId: Constants.expoConfig?.extra?.firebaseProjectId || "gymapp-5cb9b",
  storageBucket: Constants.expoConfig?.extra?.firebaseStorageBucket || "gymapp-5cb9b.firebasestorage.app",
  messagingSenderId: Constants.expoConfig?.extra?.firebaseMessagingSenderId || "187393327042",
  appId: Constants.expoConfig?.extra?.firebaseAppId || "1:187393327042:web:1b79560f55be7ff64aa05b"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
