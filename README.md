# OCR Function

Azure Function for automatic document processing using Azure Content Understanding. This function automatically triggers when PDF or DOCX files are uploaded to Azure Blob Storage and extracts structured data using custom AI models.

## Architecture

```
Azure Blob Storage (bloblogictest/test)
    ↓ (new file uploaded)
Azure Function (func-ocr-we-001)
    ↓ (sends document)
Azure Content Understanding (function-to-content)
    ↓ (returns JSON)
Application Insights (logs & monitoring)
```

## Features

- ✅ **Blob Trigger**: Automatically processes new PDF/DOCX files
- ✅ **Native DOCX Support**: No conversion needed (Content Understanding supports DOCX)
- ✅ **Managed Identity**: Passwordless authentication to all Azure services
- ✅ **Custom AI Model**: Uses `function-to-content` project for field extraction
- ✅ **Structured Logging**: Complete results logged to Application Insights
- ✅ **TypeScript**: Type-safe implementation with Azure Functions v4

## Prerequisites

- Node.js 20+
- Azure Functions Core Tools v4
- Azure CLI
- Access to Azure subscription `3cdfd20a-bc20-4227-9611-6322804e335c`

## Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Local Settings

The `local.settings.json` file is already configured with:
- Connection to `bloblogictest` storage account
- Content Understanding endpoint
- Project name: `function-to-content`

For local testing with managed identity, use:
```bash
az login
```

### 3. Build and Start

```bash
# Build TypeScript
npm run build

# Start function locally
npm start
```

### 4. Test Locally

Upload a PDF or DOCX file to the `test` container in `bloblogictest`:

```bash
az storage blob upload \
  --account-name bloblogictest \
  --container-name test \
  --name sample.pdf \
  --file ./sample.pdf \
  --auth-mode login
```

## Deployment

### Deploy to Azure

The infrastructure is already deployed. To deploy the function code:

```bash
# Build the project
npm run build

# Deploy to Azure Function App
func azure functionapp publish func-ocr-we-001
```

### Verify Deployment

```bash
# Check function app status
az functionapp show \
  --name func-ocr-we-001 \
  --resource-group appservice \
  --query "{name:name, state:state, defaultHostName:defaultHostName}"

# View recent logs
az functionapp log tail \
  --name func-ocr-we-001 \
  --resource-group appservice
```

## Testing in Azure

1. Upload a test file to the blob container:

```bash
az storage blob upload \
  --account-name bloblogictest \
  --container-name test \
  --name test-document.pdf \
  --file ./test-document.pdf \
  --auth-mode login
```

2. Monitor execution in Application Insights:

```bash
# View live metrics
az monitor app-insights component show \
  --app appi-ocr-func-we-001 \
  --resource-group appservice \
  --query "{appId:appId, instrumentationKey:instrumentationKey}"
```

Or visit the Azure Portal:
- Navigate to Application Insights > appi-ocr-func-we-001
- View **Live Metrics** or **Logs** to see execution results

## Project Structure

```
ocr-function/
├── src/
│   ├── functions/
│   │   └── process-document.ts      # Blob trigger function
│   └── services/
│       └── contentUnderstanding.ts  # Content Understanding client
├── infra/
│   └── bicep/
│       └── ocr-function/
│           ├── main.bicep            # Infrastructure template
│           ├── main.bicepparam       # Parameters
│           └── rbac-external.bicep   # RBAC assignments
├── package.json                      # Dependencies
├── tsconfig.json                     # TypeScript config
├── host.json                         # Azure Functions runtime config
├── local.settings.json               # Local environment variables
└── .funcignore                       # Deployment exclusions
```

## How It Works

### 1. Blob Trigger

When a file is uploaded to `bloblogictest/test`:
- Function checks file extension (must be `.pdf` or `.docx`)
- Skips other file types

### 2. Document Processing

For DOCX files:
- Content Understanding supports DOCX natively
- No conversion needed

For PDF files:
- Sent directly to Content Understanding

### 3. Content Understanding Analysis

- Authenticates using managed identity
- Calls custom model: `function-to-content`
- Polls for results (max 2 minutes)
- Returns structured JSON

### 4. Result Logging

Complete analysis result is logged to Application Insights:
```json
{
  "content": "extracted text...",
  "pages": [...],
  "tables": [...],
  "documents": [
    {
      "fields": {
        "FieldName": {"value": "..."},
        ...
      }
    }
  ]
}
```

## Configuration

### Environment Variables

| Variable | Description | Value |
|----------|-------------|-------|
| `AzureWebJobsStorage__accountName` | Internal storage for function | `stfuncocrifat001` |
| `SourceStorageConnection__blobServiceUri` | Source blob storage URI | `https://bloblogictest.blob.core.windows.net/` |
| `CONTENT_UNDERSTANDING_ENDPOINT` | AI service endpoint | `https://gal3729-resource.cognitiveservices.azure.com/` |
| `CONTENT_UNDERSTANDING_PROJECT` | Custom model name | `function-to-content` |
| `FUNCTIONS_WORKER_RUNTIME` | Runtime | `node` |
| `WEBSITE_NODE_DEFAULT_VERSION` | Node version | `~20` |

All configured via Bicep deployment.

## Monitoring

### Application Insights Queries

View processed documents:
```kusto
traces
| where message contains "Processing blob"
| project timestamp, message
| order by timestamp desc
```

View Content Understanding results:
```kusto
traces
| where message contains "Content Understanding Result"
| project timestamp, message
| order by timestamp desc
```

Check for errors:
```kusto
traces
| where severityLevel >= 3
| project timestamp, severityLevel, message
| order by timestamp desc
```

## Security

- **Managed Identity**: No connection strings or API keys
- **RBAC Roles Assigned**:
  - Storage Blob Data Reader (on source container)
  - Storage Blob Data Owner (on internal storage)
  - Storage Queue Data Contributor (for triggers)
  - Cognitive Services User (for Content Understanding)
- **HTTPS Only**: All communication encrypted
- **Private Networking**: Optional (not implemented in initial deployment)

## Troubleshooting

### Function not triggering

1. Check blob storage connection:
```bash
az functionapp config appsettings list \
  --name func-ocr-we-001 \
  --resource-group appservice \
  --query "[?name=='SourceStorageConnection__blobServiceUri']"
```

2. Verify RBAC permissions:
```bash
az role assignment list \
  --assignee <managed-identity-principal-id> \
  --scope /subscriptions/3cdfd20a-bc20-4227-9611-6322804e335c/resourceGroups/appservice/providers/Microsoft.Storage/storageAccounts/bloblogictest
```

### Content Understanding errors

1. Verify endpoint configuration
2. Check managed identity has Cognitive Services User role
3. Confirm project name `function-to-content` exists
4. Review Application Insights logs for detailed error messages

### Build errors

```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

## Infrastructure

Infrastructure deployed via Bicep in [infra/bicep/ocr-function/](infra/bicep/ocr-function/)

Resources:
- Function App: `func-ocr-we-001`
- App Service Plan: `plan-ocr-func-we-001` (Consumption Y1)
- Storage Account: `stfuncocrifat001`
- Application Insights: `appi-ocr-func-we-001`
- Log Analytics: `law-ocr-func-we-001`

## Contributing

1. Make changes to TypeScript code in `src/`
2. Build: `npm run build`
3. Test locally: `npm start`
4. Deploy: `func azure functionapp publish func-ocr-we-001`

## License

MIT
