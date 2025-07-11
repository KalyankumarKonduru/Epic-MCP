#!/usr/bin/env node

/**
 * Epic FHIR MCP Server
 * A standalone MCP server for Epic FHIR integration
 * Similar to the Aidbox MCP server pattern
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { EpicFHIRTools } from './tools/epic-fhir-tools.js';
import { EpicFHIRClient } from './services/epic-fhir-client.js';

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
    // Initialize Epic FHIR client
    this.epicClient = new EpicFHIRClient({
      baseUrl: process.env.EPIC_FHIR_URL || 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
      clientId: process.env.EPIC_CLIENT_ID || 'your-epic-client-id',
      authType: process.env.EPIC_AUTH_TYPE as 'oauth2' | 'basic' || 'oauth2',
      tokenUrl: process.env.EPIC_TOKEN_URL || 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token',
      scope: process.env.EPIC_SCOPE || 'Patient.read Observation.read MedicationRequest.read Condition.read Encounter.read',
      // For sandbox testing
      username: process.env.EPIC_USERNAME,
      password: process.env.EPIC_PASSWORD,
    });

    // Initialize tools
    this.fhirTools = new EpicFHIRTools(this.epicClient);

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'epic-mcp-server',
        version: '1.0.0',
        description: 'Epic FHIR MCP Server with tools for Epic EHR integration'
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
        
        // Route to appropriate tool handler
        const toolHandlers: Record<string, () => Promise<any>> = {
          // Epic FHIR Patient tools
          'searchPatients': () => this.fhirTools.handleSearchPatients(args as any),
          'getPatientDetails': () => this.fhirTools.handleGetPatient(args as any),
          
          // Epic FHIR Clinical tools
          'getPatientObservations': () => this.fhirTools.handleGetObservations(args as any),
          'getPatientMedications': () => this.fhirTools.handleGetMedications(args as any),
          'getPatientConditions': () => this.fhirTools.handleGetConditions(args as any),
          'getPatientEncounters': () => this.fhirTools.handleGetEncounters(args as any),
        };

        const handler = toolHandlers[name];
        if (!handler) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Unknown tool: ${name}`,
                availableTools: Object.keys(toolHandlers)
              }, null, 2)
            }],
            isError: true
          };
        }

        const result = await handler();
        logger.log(`✅ Epic tool "${name}" completed successfully`);
        return result;

      } catch (error: any) {
        logger.error(`❌ Epic tool "${name}" failed:`, error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message || 'Unknown error occurred',
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
      
      // Test Epic connection (skip if in standalone mode)
      if (process.env.SKIP_EPIC_CONNECTION !== 'true') {
        try {
          await this.epicClient.testConnection();
          logger.log('✅ Connected to Epic FHIR successfully');
        } catch (error) {
          logger.error('⚠️  Warning: Could not connect to Epic FHIR:', error);
          logger.log('🔧 Starting in degraded mode - Epic operations will fail');
          logger.log('💡 To fix: Ensure Epic FHIR credentials are configured');
        }
      } else {
        logger.log('⚠️  Running in standalone mode (no Epic connection test)');
      }

      if (isHttpMode) {
        await this.startHttpServer();
      } else {
        await this.startStdioServer();
      }
      
    } catch (error) {
      logger.error('Failed to start Epic MCP server:', error);
      throw error;
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
          url: process.env.EPIC_FHIR_URL,
          clientId: process.env.EPIC_CLIENT_ID ? '***configured***' : 'not-configured'
        },
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
            const toolHandlers: Record<string, () => Promise<any>> = {
              'searchPatients': () => this.fhirTools.handleSearchPatients(args),
              'getPatientDetails': () => this.fhirTools.handleGetPatient(args),
              'getPatientObservations': () => this.fhirTools.handleGetObservations(args),
              'getPatientMedications': () => this.fhirTools.handleGetMedications(args),
              'getPatientConditions': () => this.fhirTools.handleGetConditions(args),
              'getPatientEncounters': () => this.fhirTools.handleGetEncounters(args),
            };

            const handler = toolHandlers[name];
            if (!handler) {
              throw new Error(`Unknown tool: ${name}`);
            }

            const result = await handler();
            res.json({
              jsonrpc: '2.0',
              result,
              id: request.id
            });
          } catch (error: any) {
            res.json({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: error.message || 'Tool execution failed'
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
    logger.log('\n🏥 FHIR Patient Tools:');
    logger.log('   👥 searchPatients - Search patients in Epic EHR');
    logger.log('   👤 getPatientDetails - Get patient information');
    
    logger.log('\n🧪 FHIR Clinical Tools:');
    logger.log('   🔬 getPatientObservations - Get lab results and vitals');
    logger.log('   💊 getPatientMedications - Get medications');
    logger.log('   🏥 getPatientConditions - Get conditions/diagnoses');
    logger.log('   📋 getPatientEncounters - Get encounters/visits');
    
    logger.log('\n💬 The Epic MCP server is now listening for MCP client connections...');
  }

  async stop(): Promise<void> {
    try {
      logger.log('Stopping Epic FHIR MCP Server...');
      await this.epicClient.disconnect();
      logger.log('✓ Server stopped gracefully');
    } catch (error) {
      logger.error('Error stopping server:', error);
    }
  }
}

// Main execution
async function main() {
  const server = new EpicMCPServer();
  
  // Handle graceful shutdown
  const cleanup = async () => {
    logger.log('\n🛑 Shutting down Epic MCP Server...');
    await server.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  try {
    await server.start();
  } catch (error) {
    logger.error('❌ Failed to start Epic MCP Server:', error);
    process.exit(1);
  }
}

// Only run main if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}