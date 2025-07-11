/**
 * Epic FHIR Client
 * Handles authentication and API communication with Epic FHIR servers
 */

export interface EpicFHIRConfig {
    baseUrl: string;
    clientId: string;
    authType: 'oauth2' | 'basic';
    tokenUrl?: string;
    scope?: string;
    // For basic auth or sandbox
    username?: string;
    password?: string;
    // For OAuth2
    clientSecret?: string;
    redirectUri?: string;
  }
  
  export class EpicFHIRClient {
    private config: EpicFHIRConfig;
    private accessToken: string | null = null;
    private tokenExpiry: Date | null = null;
  
    constructor(config: EpicFHIRConfig) {
      this.config = {
        ...config,
        baseUrl: config.baseUrl.replace(/\/$/, '') // Remove trailing slash
      };
    }
  
    async testConnection(): Promise<boolean> {
      try {
        console.log('🔍 Testing Epic FHIR connection...');
        
        // Try to get metadata (this usually doesn't require auth)
        const response = await fetch(`${this.config.baseUrl}/metadata`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(10000)
        });
  
        if (response.ok) {
          const metadata = await response.json();
          console.log('✅ Epic FHIR server metadata retrieved successfully');
          console.log(`📋 FHIR Version: ${metadata.fhirVersion || 'Unknown'}`);
          console.log(`🏥 Implementation: ${metadata.software?.name || 'Epic'} ${metadata.software?.version || ''}`);
          return true;
        } else {
          console.warn(`⚠️  Epic FHIR metadata endpoint returned ${response.status}`);
          return false;
        }
      } catch (error: any) {
        console.error('❌ Epic FHIR connection test failed:', error.message);
        return false;
      }
    }
  
    private async authenticate(): Promise<string> {
      // Check if we have a valid cached token
      if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
        return this.accessToken as string; // We know it's not null due to the check above
      }
  
      console.log('🔐 Authenticating with Epic FHIR...');
  
      if (this.config.authType === 'oauth2') {
        const token = await this.authenticateOAuth2();
        this.accessToken = token;
        return token;
      } else {
        const token = await this.authenticateBasic();
        this.accessToken = token;
        return token;
      }
    }
  
    private async authenticateOAuth2(): Promise<string> {
      if (!this.config.tokenUrl) {
        throw new Error('Token URL is required for OAuth2 authentication');
      }
  
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        scope: this.config.scope || 'Patient.read'
      });
  
      if (this.config.clientSecret) {
        body.append('client_secret', this.config.clientSecret);
      }
  
      try {
        const response = await fetch(this.config.tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: body.toString(),
          signal: AbortSignal.timeout(15000)
        });
  
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OAuth2 authentication failed: ${response.status} ${response.statusText} - ${errorText}`);
        }
  
        const tokenData = await response.json();
        
        if (!tokenData.access_token) {
          throw new Error('No access token received from Epic FHIR OAuth2 endpoint');
        }
  
        const token = tokenData.access_token;
        
        // Set expiry (default to 1 hour if not specified)
        const expiresIn = tokenData.expires_in || 3600;
        this.tokenExpiry = new Date(Date.now() + (expiresIn * 1000));
  
        console.log('✅ Epic FHIR OAuth2 authentication successful');
        console.log(`🕒 Token expires in ${expiresIn} seconds`);
  
        return token;
  
      } catch (error: any) {
        console.error('❌ Epic FHIR OAuth2 authentication failed:', error);
        throw new Error(`Failed to authenticate with Epic FHIR: ${error.message}`);
      }
    }
  
    private async authenticateBasic(): Promise<string> {
      if (!this.config.username || !this.config.password) {
        throw new Error('Username and password are required for basic authentication');
      }
  
      // For basic auth, we'll use the credentials directly in requests
      const credentials = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      const token = `Basic ${credentials}`;
      
      console.log('✅ Epic FHIR Basic authentication configured');
      return token;
    }
  
    async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
      const url = `${this.config.baseUrl}${endpoint}`;
      console.log(`🔄 Epic FHIR Request: ${options.method || 'GET'} ${endpoint}`);
  
      try {
        // Get authentication token
        const token = await this.authenticate();
  
        const headers: Record<string, string> = {
          'Accept': 'application/fhir+json',
          'Content-Type': 'application/fhir+json',
          ...options.headers as Record<string, string>
        };
  
        // Add authorization header
        if (this.config.authType === 'oauth2') {
          headers['Authorization'] = `Bearer ${token}`;
        } else {
          headers['Authorization'] = token; // Already includes "Basic "
        }
  
        const response = await fetch(url, {
          ...options,
          headers,
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });
  
        console.log(`📡 Epic FHIR Response: ${response.status} ${response.statusText}`);
  
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ Epic FHIR API Error Response:`, errorText.substring(0, 500));
          
          // Handle specific Epic error cases
          if (response.status === 401) {
            this.accessToken = null; // Force re-authentication
            throw new Error(`Epic FHIR authentication failed: ${response.status} ${response.statusText}`);
          } else if (response.status === 403) {
            throw new Error(`Epic FHIR access forbidden: Insufficient permissions for ${endpoint}`);
          } else if (response.status === 404) {
            throw new Error(`Epic FHIR resource not found: ${endpoint}`);
          }
          
          throw new Error(`Epic FHIR API error: ${response.status} ${response.statusText} - ${errorText.substring(0, 100)}`);
        }
  
        const responseText = await response.text();
        
        if (!responseText.trim()) {
          return null; // Empty response
        }
  
        try {
          return JSON.parse(responseText);
        } catch (parseError) {
          console.error(`❌ Failed to parse Epic FHIR response:`, responseText.substring(0, 200));
          throw new Error(`Invalid JSON response from Epic FHIR API`);
        }
  
      } catch (error: any) {
        if (error.name === 'AbortError') {
          throw new Error('Epic FHIR request timed out');
        }
        
        console.error(`❌ Epic FHIR request failed for ${endpoint}:`, error);
        throw error;
      }
    }
  
    // Helper methods for common FHIR operations
    async searchResource(resourceType: string, params: Record<string, string>): Promise<any> {
      const searchParams = new URLSearchParams(params);
      return this.makeRequest(`/${resourceType}?${searchParams.toString()}`);
    }
  
    async getResource(resourceType: string, id: string): Promise<any> {
      return this.makeRequest(`/${resourceType}/${id}`);
    }
  
    async createResource(resourceType: string, resource: any): Promise<any> {
      return this.makeRequest(`/${resourceType}`, {
        method: 'POST',
        body: JSON.stringify(resource)
      });
    }
  
    async updateResource(resourceType: string, id: string, resource: any): Promise<any> {
      return this.makeRequest(`/${resourceType}/${id}`, {
        method: 'PUT',
        body: JSON.stringify(resource)
      });
    }
  
    async disconnect(): Promise<void> {
      this.accessToken = null;
      this.tokenExpiry = null;
      console.log('🏥 Disconnected from Epic FHIR');
    }
  
    // Utility methods for Epic-specific features
    getKnownSandboxPatients() {
      return [
        {
          id: 'erXuFYUfucBZaryVksYEcMg3',
          name: 'Camila Lopez',
          mrn: '12345'
        },
        {
          id: 'Tbt3KuCY0B5PSrJvCu2j-PlK.aiHsu2xUjUM8bWpetXoB',
          name: 'Jason Argonaut',
          mrn: '67890'
        }
      ];
    }
  
    isUsingSandbox(): boolean {
      return this.config.baseUrl.includes('fhir.epic.com') || 
             this.config.baseUrl.includes('sandbox');
    }
  }