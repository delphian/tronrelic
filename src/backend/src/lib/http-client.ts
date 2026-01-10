import axios from 'axios';

export const httpClient = axios.create({
  timeout: 10000,
  headers: {
    'User-Agent': 'TronRelic/2.0 (+https://tronrelic.com)'
  }
});

httpClient.interceptors.response.use(
  response => response,
  error => {
    if (error.response) {
      error.message = `HTTP ${error.response.status}: ${error.response.statusText}`;
    }
    return Promise.reject(error);
  }
);
