# Epic MCP Server

A standalone Model Context Protocol (MCP) server for Epic FHIR integration with JWT authentication support. This server provides secure access to Epic EHR systems through FHIR R4 APIs with both sandbox and production environment support.

## 🏥 Features

- **Epic FHIR Integration**: Complete FHIR R4 API support for Epic EHR systems
- **JWT Authentication**: Secure authentication using RS256 signed JWT assertions
- **Sandbox Support**: Development mode with pre-configured test patients
- **Multiple Transport Modes**: HTTP and STDIO transport support
- **Comprehensive FHIR Tools**: Patient search, clinical data retrieval, and more
- **Health Monitoring**: Built-in health check endpoints
- **Error Handling**: Robust error handling with detailed logging

## 📋 Available Tools

### Patient Management
- **`epicSearchPatients`** - Search patients by name, identifier, birthdate, or gender
- **`epicGetPatientDetails`** - Get comprehensive patient information by ID

### Clinical Data
- **`epicGetPatientObservations`** - Retrieve lab results, vitals, and other observations
- **`epicGetPatientMedications`** - Get current and historical medications
- **`epicGetPatientConditions`** - Access patient conditions and diagnoses
- **`epicGetPatientEncounters`** - Retrieve healthcare encounters and visits

## 🚀 Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- TypeScript 5.0.0 or higher
- Epic FHIR access credentials (for production)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/epic-mcp-server.git
cd epic-mcp-server

# Install dependencies
npm install

# Build the project
npm run build
```

### Environment Configuration

Create a `.env` file in the root directory:

```env
# Epic FHIR Configuration
EPIC_FHIR_URL=https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
EPIC_TOKEN_URL=https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token
EPIC_CLIENT_ID=your-client-id
EPIC_PRIVATE_KEY_PATH=./path/to/your/private-key.pem

# Scopes (adjust based on your Epic app registration)
EPIC_SCOPE=system/Patient.read system/Condition.read system/Encounter.read system/Observation.read system/MedicationRequest.read

# Server Configuration
MCP_HTTP_PORT=3003
MCP_HTTP_MODE=true

# Development/Testing
EPIC_USE_SANDBOX=false
```

### Running the Server

#### HTTP Mode (Recommended)
```bash
npm run start:http
```

#### STDIO Mode
```bash
npm run start:stdio
```

#### Development Mode
```bash
npm run dev:http
```

## 🔐 Authentication Setup

### Production Environment

1. **Register your application** with Epic's App Orchard
2. **Generate an RS256 key pair**:
   ```bash
   # Generate private key
   openssl genrsa -out epic-private-key.pem 2048
   
   # Generate public key
   openssl rsa -in epic-private-key.pem -pubout -out epic-public-key.pem
   ```
3. **Upload the public key** to your Epic app registration
4. **Configure environment variables** with your client ID and private key path

### Sandbox Mode

For development and testing, the server automatically uses sandbox mode when:
- `EPIC_CLIENT_ID` is not configured or set to "not-configured"
- `EPIC_PRIVATE_KEY_PATH` is not provided
- `EPIC_USE_SANDBOX=true` is explicitly set

In sandbox mode, the server provides access to test patients without authentication.

## 📊 Health Monitoring

Check server health:
```bash
curl http://localhost:3003/health
```

Response:
```json
{
  "status": "healthy",
  "server": "epic-mcp-server",
  "version": "1.0.0",
  "epic": {
    "clientId": "***configured***",
    "authMode": "jwt",
    "sandbox": false
  }
}
```

## 🔧 Tool Usage Examples

### Search Patients
```json
{
  "tool": "epicSearchPatients",
  "arguments": {
    "name": "Smith",
    "gender": "female",
    "limit": 10
  }
}
```

### Get Patient Details
```json
{
  "tool": "epicGetPatientDetails",
  "arguments": {
    "patientId": "erXuFYUfucBZaryVksYEcMg3"
  }
}
```

### Get Patient Observations
```json
{
  "tool": "epicGetPatientObservations",
  "arguments": {
    "patientId": "erXuFYUfucBZaryVksYEcMg3",
    "category": "vital-signs",
    "limit": 20
  }
}
```

## 🧪 Known Sandbox Patients

When running in sandbox mode, the following test patients are available:

| Name | Patient ID | MRN | Birth Date | Gender |
|------|------------|-----|------------|--------|
| Camila Lopez | `erXuFYUfucBZaryVksYEcMg3` | E1238 | 1987-09-15 | female |
| Jason Argonaut | `Tbt3KuCY0B5PSrJvCu2j-PlK.aiHsu2xUjUM8bWpetXoB` | E1239 | 1985-08-01 | male |
| Jessica Thompson | `eq081-VQEgP8drUUqCWzHfw3` | E1240 | 1990-03-12 | female |

## 📚 API Reference

### MCP Endpoint
- **URL**: `http://localhost:3003/mcp`
- **Method**: POST
- **Content-Type**: application/json
- **Format**: JSON-RPC 2.0

### Health Check
- **URL**: `http://localhost:3003/health`
- **Method**: GET

## 🛠 Development

### Scripts

```bash
# Build TypeScript
npm run build

# Start in HTTP mode
npm run start:http

# Start in STDIO mode
npm run start:stdio

# Development with hot reload
npm run dev:http

# Clean build artifacts
npm run clean

# Test JWT authentication
npm run test-jwt
```

### Project Structure

```
epic-mcp-server/
├── src/
│   ├── server.ts              # Main server implementation
│   ├── services/
│   │   └── epic-fhir-client.ts # Epic FHIR API client
│   └── tools/
│       └── epic-fhir-tools.ts  # FHIR tool implementations
├── dist/                      # Compiled JavaScript
├── package.json
├── tsconfig.json
└── .env                      # Environment configuration
```

## 🔍 Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify your client ID and private key are correctly configured
   - Ensure your public key is uploaded to Epic App Orchard
   - Check that your scopes match your Epic app registration

2. **Connection Issues**
   - Verify Epic FHIR URL is accessible
   - Check firewall settings for outbound HTTPS connections
   - Ensure token URL is correct for your Epic environment

3. **Sandbox Mode Issues**
   - Set `EPIC_USE_SANDBOX=true` for development
   - Use the provided test patient IDs for sandbox testing

### Debugging

Enable detailed logging by setting log level:
```bash
# View detailed Epic FHIR requests/responses
npm run dev:http
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support

- **Epic FHIR Documentation**: [Epic on FHIR](https://fhir.epic.com/)
- **Model Context Protocol**: [MCP Documentation](https://modelcontextprotocol.io/)
- **Issues**: [GitHub Issues](https://github.com/KalyankumarKonduru/epic-mcp-server/issues)

---

**Note**: This server is designed for integration with Epic EHR systems. Ensure you have proper Epic credentials and follow Epic's integration guidelines for production deployments.
