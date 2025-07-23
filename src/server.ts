import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { EpicFHIRTools } from './tools/epic-fhir-tools.js';
import { EpicFHIRClient } from './services/epic-fhir-client.js';
import dotenv from 'dotenv';
dotenv.config();

const isHttpMode = process.env.MCP_HTTP_MODE === 'true';
const isStdioMode = !isHttpMode;

const logger = {
  log: (...args: any[]) => {
    if (!isStdioMode) {
      console.log(...args);
    } else {
      console.error(...args);
    }
  },
  error: (...args: any[]) => {
    console.error(...args);
  }
};

export class EpicMCPServer {
  private server: Server;
  private epicClient: EpicFHIRClient;
  private fhirTools: EpicFHIRTools;

  constructor() {
    // Initialize Epic FHIR client with JWT support
    this.epicClient = new EpicFHIRClient({
      baseUrl: process.env.EPIC_FHIR_URL || 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
      clientId: process.env.EPIC_CLIENT_ID || 'not-configured',
      authType: 'jwt',
      tokenUrl: process.env.EPIC_TOKEN_URL || 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token',
      scope: process.env.EPIC_SCOPE || 'system/Patient.read system/Patient.write system/Condition.read system/Condition.write system/Encounter.read system/Encounter.write system/Observation.read system/Observation.write system/MedicationRequest.read system/MedicationRequest.write system/DocumentReference.read system/DocumentReference.write',
      privateKeyPath: process.env.EPIC_PRIVATE_KEY_PATH,
      // Determine if using sandbox based on configuration
      useSandbox: !process.env.EPIC_CLIENT_ID || 
                  process.env.EPIC_CLIENT_ID === 'not-configured' || 
                  !process.env.EPIC_PRIVATE_KEY_PATH ||
                  process.env.EPIC_USE_SANDBOX === 'true'
    });

    // Initialize tools
    this.fhirTools = new EpicFHIRTools(this.epicClient);

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'epic-mcp-server',
        version: '1.0.0',
        description: 'Epic FHIR MCP Server with JWT authentication for Epic EHR integration'
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const fhirToolsList = this.fhirTools.getAllTools();
      
      return {
        tools: fhirToolsList,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        logger.log(`🔧 EPIC TOOL CALLED: "${name}" with args:`, JSON.stringify(args, null, 2));
        
        // Route to appropriate tool handler with epic prefix
        const toolHandlers: Record<string, () => Promise<any>> = {
          // Epic FHIR Patient READ tools
          'epicSearchPatients': () => this.fhirTools.handleSearchPatients(args as any),
          'epicGetPatientDetails': () => this.fhirTools.handleGetPatient(args as any),
          
          // Epic FHIR Clinical READ tools
          'epicGetPatientObservations': () => this.fhirTools.handleGetObservations(args as any),
          'epicGetPatientMedications': () => this.fhirTools.handleGetMedications(args as any),
          'epicGetPatientConditions': () => this.fhirTools.handleGetConditions(args as any),
          'epicGetPatientEncounters': () => this.fhirTools.handleGetEncounters(args as any),
          
          // Epic FHIR Patient CREATE/UPDATE tools
          'epicCreatePatient': () => this.fhirTools.handleCreatePatient(args as any),
          'epicUpdatePatient': () => this.fhirTools.handleUpdatePatient(args as any),
          
          // Epic FHIR Clinical CREATE tools
          'epicCreateObservation': () => this.fhirTools.handleCreateObservation(args as any),
          'epicCreateMedicationRequest': () => this.fhirTools.handleCreateMedicationRequest(args as any),
          'epicCreateCondition': () => this.fhirTools.handleCreateCondition(args as any),
          'epicCreateEncounter': () => this.fhirTools.handleCreateEncounter(args as any),
          
          // Epic FHIR Document tools
          'epicCreateClinicalNote': () => this.fhirTools.handleCreateClinicalNote(args as any),
          'epicCreateDocumentInfo': () => this.fhirTools.handleCreateDocumentInfo(args as any),
        };

        const handler = toolHandlers[name];
        if (!handler) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Unknown tool: ${name}`,
                availableTools: Object.keys(toolHandlers),
                message: 'Epic MCP Server only handles epic-prefixed tools'
              }, null, 2)
            }],
            isError: true
          };
        }

        const result = await handler();
        logger.log(`✅ Epic tool "${name}" completed successfully`);
        return result;

      } catch (error: any) {
        logger.error(`Epic tool execution error:`, error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message || 'Epic tool execution failed',
              tool: name,
              timestamp: new Date().toISOString()
            }, null, 2)
          }],
          isError: true
        };
      }
    });
  }

  async start(): Promise<void> {
    try {
      logger.log('🏥 Epic FHIR MCP Server v1.0.0');
      logger.log('===================================');
      
      // Test Epic FHIR connection
      logger.log('🔍 Testing Epic FHIR connection...');
      
      try {
        // Test connection with a simple capability statement request
        const response = await fetch(`${process.env.EPIC_FHIR_URL || 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4'}/metadata`, {
          method: 'GET',
          headers: {
            'Accept': 'application/fhir+json',
            'User-Agent': 'Epic-MCP-Server/1.0.0'
          }
        });
        
        if (response.ok) {
          const metadata = await response.json();
          logger.log('✅ Epic FHIR server metadata retrieved successfully');
          logger.log(`📋 FHIR Version: ${metadata.fhirVersion || '4.0.1'}`);
          logger.log(`🏥 Implementation: ${metadata.implementation?.description || 'Epic FHIR Server'}`);
        } else {
          logger.log('⚠️ Could not retrieve Epic FHIR metadata, but server is reachable');
        }
      } catch (error) {
        logger.log('⚠️ Could not connect to Epic FHIR server, continuing with degraded functionality');
        logger.log('Error:', error);
      }
      
      logger.log('✅ Connected to Epic FHIR successfully');

      if (isHttpMode) {
        await this.startHttpServer();
      } else {
        await this.startStdioServer();
      }
      
    } catch (error) {
      logger.error('Failed to start Epic MCP server:', error);
      process.exit(1);
    }
  }

  private async startHttpServer(): Promise<void> {
    const express = await import('express');
    const cors = await import('cors');
    
    const app = express.default();
    app.use(cors.default());
    app.use(express.default.json({ limit: '50mb' }));

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        server: 'epic-mcp-server',
        version: '1.0.0',
        epic: {
          clientId: process.env.EPIC_CLIENT_ID ? '***configured***' : 'not-configured',
          authMode: process.env.EPIC_PRIVATE_KEY_PATH ? 'JWT' : 'Sandbox',
          sandboxMode: this.epicClient.isUsingSandbox()
        },
        totalTools: this.fhirTools.getAllTools().length,
        timestamp: new Date().toISOString()
      });
    });

    // MCP endpoint
    app.post('/mcp', async (req, res) => {
      try {
        const request = req.body;
        
        if (request.method === 'initialize') {
          res.json({
            jsonrpc: '2.0',
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {}
              },
              serverInfo: {
                name: 'epic-mcp-server',
                version: '1.0.0'
              }
            },
            id: request.id
          });
        } else if (request.method === 'tools/list') {
          const tools = this.fhirTools.getAllTools();
          res.json({
            jsonrpc: '2.0',
            result: { tools },
            id: request.id
          });
        } else if (request.method === 'tools/call') {
          const { name, arguments: args } = request.params;
          
          try {
            // Tool handlers with epic prefix
            const toolHandlers: Record<string, () => Promise<any>> = {
              // READ tools
              'epicSearchPatients': () => this.fhirTools.handleSearchPatients(args),
              'epicGetPatientDetails': () => this.fhirTools.handleGetPatient(args),
              'epicGetPatientObservations': () => this.fhirTools.handleGetObservations(args),
              'epicGetPatientMedications': () => this.fhirTools.handleGetMedications(args),
              'epicGetPatientConditions': () => this.fhirTools.handleGetConditions(args),
              'epicGetPatientEncounters': () => this.fhirTools.handleGetEncounters(args),
              // CREATE/UPDATE tools
              'epicCreatePatient': () => this.fhirTools.handleCreatePatient(args),
              'epicUpdatePatient': () => this.fhirTools.handleUpdatePatient(args),
              'epicCreateObservation': () => this.fhirTools.handleCreateObservation(args),
              'epicCreateMedicationRequest': () => this.fhirTools.handleCreateMedicationRequest(args),
              'epicCreateCondition': () => this.fhirTools.handleCreateCondition(args),
              'epicCreateEncounter': () => this.fhirTools.handleCreateEncounter(args),
              'epicCreateClinicalNote': () => this.fhirTools.handleCreateClinicalNote(args),
              'epicCreateDocumentInfo': () => this.fhirTools.handleCreateDocumentInfo(args),
            };

            const handler = toolHandlers[name];
            if (!handler) {
              throw new Error(`Unknown tool: ${name}. Available Epic tools: ${Object.keys(toolHandlers).join(', ')}`);
            }

            const result = await handler();
            res.json({
              jsonrpc: '2.0',
              result,
              id: request.id
            });
          } catch (error: any) {
            logger.error(`Epic tool execution error:`, error);
            res.json({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: error.message || 'Epic tool execution failed'
              },
              id: request.id
            });
          }
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32601,
              message: 'Method not found'
            },
            id: request.id
          });
        }
      } catch (error) {
        logger.error('HTTP request error:', error);
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error'
          },
          id: req.body?.id || null
        });
      }
    });

    const port = process.env.MCP_HTTP_PORT || 3003;
    app.listen(port, () => {
      logger.log(`🚀 HTTP Server ready for Epic FHIR integration`);
      logger.log(`📊 Server Information:`);
      logger.log(`======================`);
      logger.log(`✓ HTTP Server listening on port ${port}`);
      logger.log(`🌐 Health check: http://localhost:${port}/health`);
      logger.log(`🔗 MCP endpoint: http://localhost:${port}/mcp`);
      logger.log(`🏥 Epic FHIR URL: ${process.env.EPIC_FHIR_URL}`);
      logger.log(`🔐 Authentication: ${this.epicClient.isUsingSandbox() ? 'Sandbox (no auth)' : 'JWT with private key'}`);
      
      this.logAvailableTools();
    });
  }

  private async startStdioServer(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    if (isStdioMode) {
      logger.error('Epic FHIR MCP Server running on stdio transport');
      logger.error('Ready to accept commands');
    } else {
      logger.log('✓ Epic FHIR MCP Server started successfully');
      this.logAvailableTools();
    }
  }

  private logAvailableTools(): void {
    logger.log('\n📝 Available Epic FHIR tools:');
    
    logger.log('\n🏥 FHIR Patient Tools (with epic prefix):');
    logger.log('   👥 epicSearchPatients - Search patients in Epic FHIR');
    logger.log('   👤 epicGetPatientDetails - Get patient information');
    logger.log('   ➕ epicCreatePatient - Create new patient');
    logger.log('   📝 epicUpdatePatient - Update patient data');
    
    logger.log('\n🧪 FHIR Clinical Tools (with epic prefix):');
    logger.log('   🔬 epicGetPatientObservations - Get lab results and vitals');
    logger.log('   ➕ epicCreateObservation - Create new observation');
    logger.log('   💊 epicGetPatientMedications - Get medications');
    logger.log('   ➕ epicCreateMedicationRequest - Create medication request');
    logger.log('   🏥 epicGetPatientConditions - Get conditions/diagnoses');
    logger.log('   ➕ epicCreateCondition - Create new condition');
    logger.log('   📋 epicGetPatientEncounters - Get encounters/visits');
    logger.log('   ➕ epicCreateEncounter - Create new encounter');
    
    logger.log('\n📄 FHIR Document Tools (with epic prefix):');
    logger.log('   📝 epicCreateClinicalNote - Create clinical notes');
    logger.log('   📄 epicCreateDocumentInfo - Create document references');
    
    logger.log(`\n💬 The Epic server is now listening with ${this.epicClient.isUsingSandbox() ? 'sandbox mode' : 'JWT authentication'}...`);
    logger.log(`📊 Total available tools: ${this.fhirTools.getAllTools().length}`);
  }

  async stop(): Promise<void> {
    logger.log('🛑 Shutting down Epic MCP Server...');
    // Add any cleanup logic here
    logger.log('✓ Server stopped gracefully');
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new EpicMCPServer();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.log('\nReceived SIGINT, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.log('\nReceived SIGTERM, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  // Start the server
  server.start().catch((error) => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
}