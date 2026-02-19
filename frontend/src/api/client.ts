import axios from "axios";
import { auth } from "../firebase";
import { expoConfig } from "../config";

// Get API base URL from config, with localhost as fallback
const configApiUrl = expoConfig?.extra?.apiBaseUrl;
const API_BASE_URL = configApiUrl || "http://localhost:8000";

// Log the API URL being used for debugging
console.log('API Base URL configured:', API_BASE_URL);
console.log('Config API URL:', configApiUrl);

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 second timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  async (config) => {
    const user = auth.currentUser;
    if (user) {
      try {
        const token = await user.getIdToken();
        config.headers.Authorization = `Bearer ${token}`;
      } catch (error) {
        console.error('Error getting auth token:', error);
        // Don't block the request if token fetch fails, let the backend handle it
      }
    }
    return config;
  },
  (error) => {
    console.error('Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor for better error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Enhanced error logging
    if (error.code === 'ECONNABORTED') {
      console.error('Request timeout:', {
        url: error.config?.url,
        baseURL: error.config?.baseURL,
        timeout: error.config?.timeout,
      });
      error.message = 'Request timeout. Please check your connection and try again.';
    } else if (error.message === 'Network Error' || !error.response) {
      console.error('Network error:', {
        url: error.config?.url,
        baseURL: error.config?.baseURL,
        message: error.message,
        code: error.code,
      });
      error.message = 'Network error. Please check your internet connection and ensure the API server is accessible.';
    } else if (error.response) {
      // Server responded with error status
      console.error('API error:', {
        status: error.response.status,
        statusText: error.response.statusText,
        url: error.config?.url,
        data: error.response.data,
      });
    }
    return Promise.reject(error);
  }
);

export default apiClient;
