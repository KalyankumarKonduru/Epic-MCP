import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';

export interface EpicFHIRConfig {
  baseUrl: string;
  clientId?: string;
  authType: 'oauth2' | 'basic' | 'none' | 'jwt';
  tokenUrl?: string;
  scope?: string;
  username?: string;
  password?: string;
  useSandbox?: boolean;
  privateKeyPath?: string;
  certificatePath?: string;
}

export class EpicFHIRClient {
  private config: EpicFHIRConfig;
  private accessToken?: string;
  private tokenExpiry?: Date;

  constructor(config: EpicFHIRConfig) {
    this.config = {
      ...config,
      // Use JWT authentication for Epic when credentials are available
      authType: config.clientId && config.clientId !== 'not-configured' && config.privateKeyPath ? 'jwt' : 'none',
      useSandbox: !config.clientId || config.clientId === 'not-configured' || !config.privateKeyPath
    };

    console.log(`🏥 Epic FHIR Client initialized:`);
    console.log(`   URL: ${this.config.baseUrl}`);
    console.log(`   Mode: ${this.config.useSandbox ? 'Sandbox (no auth)' : 'Production (JWT auth)'}`);
    console.log(`   Auth: ${this.config.authType}`);
    console.log(`   Client ID: ${this.config.clientId || 'not-configured'}`);
  }

  isUsingSandbox(): boolean {
    return this.config.useSandbox === true;
  }

  getKnownSandboxPatients() {
    return [
      {
        id: 'erXuFYUfucBZaryVksYEcMg3',
        name: 'Camila Lopez',
        mrn: 'E1238',
        birthDate: '1987-09-15',
        gender: 'female'
      },
      {
        id: 'Tbt3KuCY0B5PSrJvCu2j-PlK.aiHsu2xUjUM8bWpetXoB',
        name: 'Jason Argonaut',
        mrn: 'E1239', 
        birthDate: '1985-08-01',
        gender: 'male'
      },
      {
        id: 'eq081-VQEgP8drUUqCWzHfw3',
        name: 'Jessica Thompson',
        mrn: 'E1240',
        birthDate: '1990-03-12',
        gender: 'female'
      }
    ];
  }

  async authenticate(): Promise<void> {
    // Skip authentication for sandbox mode
    if (this.config.useSandbox) {
      console.log('🏥 Using Epic sandbox mode - no authentication required');
      return;
    }

    // Check if token is still valid
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      console.log('🔐 Using existing valid token');
      return;
    }

    console.log('🔐 Authenticating with Epic FHIR using JWT...');

    try {
      if (this.config.authType === 'jwt') {
        await this.authenticateJWT();
      } else {
        throw new Error(`Unsupported auth type: ${this.config.authType}`);
      }
    } catch (error) {
      console.error('❌ Epic FHIR authentication failed:', error);
      throw new Error(`Failed to authenticate with Epic FHIR: ${error}`);
    }
  }

  private async authenticateJWT(): Promise<void> {
    if (!this.config.clientId || !this.config.tokenUrl || !this.config.privateKeyPath) {
      throw new Error('JWT authentication requires clientId, tokenUrl, and privateKeyPath');
    }

    // Read private key
    let privateKey: string;
    try {
      privateKey = fs.readFileSync(this.config.privateKeyPath, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read private key from ${this.config.privateKeyPath}: ${error}`);
    }

    // Create JWT assertion
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      iss: this.config.clientId,  // Issuer (your client ID)
      sub: this.config.clientId,  // Subject (your client ID)
      aud: this.config.tokenUrl,  // Audience (Epic's token URL)
      jti: uuidv4(),              // Unique identifier for this JWT
      exp: now + 300,             // Expires in 5 minutes
      iat: now                    // Issued at
    };

    const jwtAssertion = jwt.sign(jwtPayload, privateKey, {
      algorithm: 'RS256',
      header: {
        alg: 'RS256',
        typ: 'JWT'
      }
    });

    console.log(`🔐 Created JWT assertion for client: ${this.config.clientId}`);

    // Request access token using JWT assertion
    const tokenRequest = {
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: jwtAssertion,
      scope: this.config.scope || 'system/Patient.read system/Observation.read system/MedicationRequest.read system/Condition.read system/Encounter.read'
    };

    console.log(`🔐 Requesting token from: ${this.config.tokenUrl}`);

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams(tokenRequest)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Token request failed: ${response.status} ${response.statusText}`);
      console.error(`Response: ${errorText}`);
      throw new Error(`JWT authentication failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const tokenData = await response.json();
    this.accessToken = tokenData.access_token;
    this.tokenExpiry = new Date(Date.now() + (tokenData.expires_in * 1000));

    console.log('✅ Epic FHIR JWT authentication successful');
    console.log(`🔐 Token expires in: ${tokenData.expires_in} seconds`);
    console.log(`🔐 Granted scopes: ${tokenData.scope}`);
  }

  async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    // Authenticate only if not using sandbox
    if (!this.config.useSandbox) {
      await this.authenticate();
    }

    const url = `${this.config.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Accept': 'application/fhir+json',
      'User-Agent': 'Epic-MCP-Server/1.0.0',
      ...((options.headers as Record<string, string>) || {})
    };

    // Add authentication headers only for production
    if (!this.config.useSandbox && this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    console.log(`🔍 Epic FHIR Request: ${options.method || 'GET'} ${endpoint}`);
    console.log(`🔍 Mode: ${this.config.useSandbox ? 'Sandbox' : 'Production with JWT'}`);

    const response = await fetch(url, {
      ...options,
      headers
    });

    console.log(`📊 Epic FHIR Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Epic FHIR request failed for ${endpoint}: ${response.status} ${response.statusText}`);
      console.error(`Response: ${errorText}`);
      
      // If authentication error, clear token and retry once
      if (response.status === 401 && this.accessToken) {
        console.log('🔄 Authentication expired, clearing token and retrying...');
        this.accessToken = undefined;
        this.tokenExpiry = undefined;
        
        // Retry the request once
        return this.makeRequest(endpoint, options);
      }
      
      throw new Error(`Epic FHIR request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`✅ Epic FHIR request successful for ${endpoint}`);
    
    return data;
  }

  async searchResource(resourceType: string, params: Record<string, string>): Promise<any> {
    const queryString = new URLSearchParams(params).toString();
    const endpoint = `/${resourceType}?${queryString}`;
    return this.makeRequest(endpoint);
  }

  async getResource(resourceType: string, id: string): Promise<any> {
    const endpoint = `/${resourceType}/${id}`;
    return this.makeRequest(endpoint);
  }

  async createResource(resourceType: string, resource: any): Promise<any> {
    const endpoint = `/${resourceType}`;
    return this.makeRequest(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/fhir+json'
      },
      body: JSON.stringify(resource)
    });
  }

  async updateResource(resourceType: string, id: string, resource: any): Promise<any> {
    const endpoint = `/${resourceType}/${id}`;
    return this.makeRequest(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/fhir+json'
      },
      body: JSON.stringify(resource)
    });
  }
}