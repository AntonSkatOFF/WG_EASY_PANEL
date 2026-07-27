require('dotenv').config();
const axios = require('axios');

const WG_EASY_URL = process.env.WG_EASY_URL || 'http://localhost:51821';
const WG_EASY_USERNAME = process.env.WG_EASY_USERNAME || 'admin';
const WG_EASY_PASSWORD = process.env.WG_EASY_PASSWORD || '';

// Create axios instance with auth
const api = axios.create({
  baseURL: WG_EASY_URL,
  auth: {
    username: WG_EASY_USERNAME,
    password: WG_EASY_PASSWORD
  }
});

// WG-Easy API wrapper
class WgEasyAPI {
  // Get all clients
  async getClients() {
    try {
      const response = await api.get('/api/wireguard/client');
      return response.data;
    } catch (error) {
      console.error('Error fetching clients:', error.message);
      throw error;
    }
  }

  // Get single client by ID
  async getClient(clientId) {
    try {
      const response = await api.get(`/api/wireguard/client/${clientId}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching client:', error.message);
      throw error;
    }
  }

  // Create new client
  async createClient(name) {
    try {
      const response = await api.post('/api/wireguard/client', { name });
      return response.data;
    } catch (error) {
      console.error('Error creating client:', error.message);
      throw error;
    }
  }

  // Delete client
  async deleteClient(clientId) {
    try {
      await api.delete(`/api/wireguard/client/${clientId}`);
      return true;
    } catch (error) {
      console.error('Error deleting client:', error.message);
      throw error;
    }
  }

  // Get client configuration (.conf file)
  async getClientConfig(clientId) {
    try {
      const response = await api.get(`/api/wireguard/client/${clientId}/configuration`, {
        responseType: 'text'
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching client config:', error.message);
      throw error;
    }
  }

  // Get QR code for client
  async getClientQRCode(clientId) {
    try {
      const response = await api.get(`/api/wireguard/client/${clientId}/qrcode.svg`, {
        responseType: 'arraybuffer'
      });
      return Buffer.from(response.data).toString('base64');
    } catch (error) {
      console.error('Error fetching QR code:', error.message);
      throw error;
    }
  }

  // Enable client
  async enableClient(clientId) {
    try {
      await api.post(`/api/wireguard/client/${clientId}/enabled`);
      return true;
    } catch (error) {
      console.error('Error enabling client:', error.message);
      throw error;
    }
  }

  // Disable client
  async disableClient(clientId) {
    try {
      await api.delete(`/api/wireguard/client/${clientId}/enabled`);
      return true;
    } catch (error) {
      console.error('Error disabling client:', error.message);
      throw error;
    }
  }

  // Get server status
  async getStatus() {
    try {
      const response = await api.get('/api/wireguard/status');
      return response.data;
    } catch (error) {
      console.error('Error fetching status:', error.message);
      throw error;
    }
  }

  // Test connection
  async testConnection() {
    try {
      await this.getStatus();
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new WgEasyAPI();
