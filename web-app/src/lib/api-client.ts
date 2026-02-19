import axios from 'axios';
import { auth } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
});

// Track auth initialization state
let authReady = false;
let authUser: User | null = null;
let authReadyPromise: Promise<User | null> | null = null;

// Initialize auth state listener once
const initAuthListener = (): Promise<User | null> => {
  if (authReadyPromise) return authReadyPromise;
  
  console.log('[API Client] Initializing auth listener...');
  authReadyPromise = new Promise((resolve) => {
    // This listener stays active to track auth state changes
    onAuthStateChanged(auth, (user) => {
      console.log('[API Client] Auth state changed:', { user: user?.email, uid: user?.uid, wasReady: authReady });
      authUser = user;
      if (!authReady) {
        authReady = true;
        resolve(user);
      }
    });
  });
  
  return authReadyPromise;
};

// Start listening immediately
initAuthListener();

// Helper to wait for auth to be ready (with timeout)
const waitForAuth = async (timeoutMs: number = 5000): Promise<User | null> => {
  // If auth is already ready, return current user
  if (authReady) {
    return authUser;
  }
  
  // Wait for auth to initialize (with timeout)
  const timeoutPromise = new Promise<User | null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });
  
  return Promise.race([initAuthListener(), timeoutPromise]);
};

// Request interceptor to add Firebase ID token
apiClient.interceptors.request.use(async (config) => {
  try {
    console.log('[API Client] Waiting for auth...', { authReady, authUser: authUser?.email });
    const user = await waitForAuth();
    console.log('[API Client] Auth result:', { user: user?.email, uid: user?.uid });
    if (user) {
      const token = await user.getIdToken();
      config.headers.Authorization = `Bearer ${token}`;
      console.log('[API Client] Token added to request');
    } else {
      console.warn('[API Client] No authenticated user - request will be sent without auth token');
    }
  } catch (error) {
    console.error('[API Client] Error getting auth token:', error);
  }
  return config;
});

export default apiClient;
