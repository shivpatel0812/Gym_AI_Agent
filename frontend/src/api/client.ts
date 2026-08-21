import axios from "axios";
import { auth } from "../firebase";
import { API_BASE_URL } from "../config";

if (__DEV__) {
  console.log("API Base URL configured:", API_BASE_URL);
}

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
