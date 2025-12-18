---
goal: Deploy Azure Function App with blob trigger for OCR document processing using Azure Content Understanding
---

# Introduction

This implementation plan defines the Azure infrastructure required to automatically process PDF and DOCX files uploaded to an existing Azure Blob Storage container using an Azure Function triggered by blob events. The function will send documents to Azure Content Understanding for field extraction and return structured JSON results. All resources will be deployed to West Europe region within the existing `appservice` resource group, using managed identities for secure authentication.

## Resources

### functionStorage

```yaml
name: functionStorage
kind: Raw
type: Microsoft.Storage/storageAccounts@2023-05-01

purpose: Internal storage account for Azure Function App operations (not for source documents)
dependsOn: []

parameters:
  required:
    - name: storageAccountName
      type: string
      description: Name of the storage account for function internals
      example: stfuncocrwe001
    - name: location
      type: string
      description: Azure region for deployment
      example: westeurope
    - name: resourceGroupName
      type: string
      description: Resource group name
      example: appservice
  optional:
    - name: sku
      type: string
      description: Storage account SKU
      default: Standard_LRS
    - name: tags
      type: object
      description: Resource tags
      default: {project: 'ocr-function', environment: 'prod'}

outputs:
  - name: storageAccountId
    type: string
    description: Resource ID of the storage account
  - name: storageAccountName
    type: string
    description: Name of the storage account

references:
  docs: https://learn.microsoft.com/en-us/azure/templates/microsoft.storage/storageaccounts
```

### logAnalyticsWorkspace

```yaml
name: logAnalyticsWorkspace
kind: Raw
type: Microsoft.OperationalInsights/workspaces@2023-09-01

purpose: Centralized logging and monitoring workspace for Application Insights
dependsOn: []

parameters:
  required:
    - name: workspaceName
      type: string
      description: Name of the Log Analytics workspace
      example: law-ocr-func-we-001
    - name: location
      type: string
      description: Azure region for deployment
      example: westeurope
  optional:
    - name: sku
      type: string
      description: Pricing tier
      default: PerGB2018
    - name: retentionInDays
      type: int
      description: Data retention period in days
      default: 30

outputs:
  - name: workspaceId
    type: string
    description: Resource ID of the workspace
  - name: workspaceCustomerId
    type: string
    description: Workspace customer ID for Application Insights

references:
  docs: https://learn.microsoft.com/en-us/azure/templates/microsoft.operationalinsights/workspaces
```

### applicationInsights

```yaml
name: applicationInsights
kind: Raw
type: Microsoft.Insights/components@2020-02-02

purpose: Application performance monitoring and logging for the Function App
dependsOn: [logAnalyticsWorkspace]

parameters:
  required:
    - name: appInsightsName
      type: string
      description: Name of Application Insights instance
      example: appi-ocr-func-we-001
    - name: location
      type: string
      description: Azure region for deployment
      example: westeurope
    - name: workspaceResourceId
      type: string
      description: Resource ID of Log Analytics workspace
      example: (from logAnalyticsWorkspace output)
  optional:
    - name: applicationType
      type: string
      description: Application type
      default: web

outputs:
  - name: appInsightsId
    type: string
    description: Resource ID of Application Insights
  - name: instrumentationKey
    type: string
    description: Instrumentation key for Function App
  - name: connectionString
    type: string
    description: Connection string for Application Insights

references:
  docs: https://learn.microsoft.com/en-us/azure/templates/microsoft.insights/components
```

### functionAppPlan

```yaml
name: functionAppPlan
kind: Raw
type: Microsoft.Web/serverfarms@2024-11-01

purpose: Consumption or Flex Consumption hosting plan for the Function App
dependsOn: []

parameters:
  required:
    - name: planName
      type: string
      description: Name of the App Service Plan
      example: plan-ocr-func-we-001
    - name: location
      type: string
      description: Azure region for deployment
      example: westeurope
  optional:
    - name: sku
      type: object
      description: SKU configuration for the plan
      default: {name: 'Y1', tier: 'Dynamic'}
    - name: reserved
      type: bool
      description: Reserved for Linux
      default: false

outputs:
  - name: planId
    type: string
    description: Resource ID of the App Service Plan

references:
  docs: https://learn.microsoft.com/en-us/azure/templates/microsoft.web/serverfarms
```

### functionApp

```yaml
name: functionApp
kind: AVM
avmModule: br/public:avm/res/web/site:0.19.4

purpose: Azure Function App with blob trigger for document OCR processing
dependsOn: [functionAppPlan, functionStorage, applicationInsights]

parameters:
  required:
    - name: name
      type: string
      description: Name of the Function App
      example: func-ocr-we-001
    - name: kind
      type: string
      description: Type of site
      example: functionapp
    - name: serverFarmResourceId
      type: string
      description: Resource ID of the App Service Plan
      example: (from functionAppPlan output)
    - name: location
      type: string
      description: Azure region
      example: westeurope
  optional:
    - name: managedIdentities
      type: object
      description: Managed identity configuration
      default: {systemAssigned: true}
    - name: httpsOnly
      type: bool
      description: Force HTTPS only
      default: true
    - name: configs
      type: array
      description: Function App configuration including app settings
      example: See detailed configuration below

outputs:
  - name: functionAppId
    type: string
    description: Resource ID of the Function App
  - name: functionAppName
    type: string
    description: Name of the Function App
  - name: principalId
    type: string
    description: Principal ID of the system-assigned managed identity

references:
  docs: https://learn.microsoft.com/en-us/azure/templates/microsoft.web/sites
  avm: https://github.com/Azure/bicep-registry-modules/tree/main/avm/res/web/site
```

**Function App Configuration Details:**

The `configs` parameter should include:

```yaml
configs:
  - name: appsettings
    properties:
      FUNCTIONS_EXTENSION_VERSION: '~4'
      FUNCTIONS_WORKER_RUNTIME: 'node'
      WEBSITE_NODE_DEFAULT_VERSION: '~20'
      WEBSITE_RUN_FROM_PACKAGE: '1'
      APPLICATIONINSIGHTS_CONNECTION_STRING: (from applicationInsights output)
      AzureWebJobsStorage__accountName: (from functionStorage output - for internal storage)
      SourceStorageConnection__blobServiceUri: 'https://bloblogictest.blob.core.windows.net/'
      CONTENT_UNDERSTANDING_ENDPOINT: 'https://gal3729-resource.cognitiveservices.azure.com/'
      SOURCE_STORAGE_ACCOUNT: 'bloblogictest'
      SOURCE_CONTAINER: 'test'
    storageAccountResourceId: (functionStorage ID)
    storageAccountUseIdentityAuthentication: true
    applicationInsightResourceId: (applicationInsights ID)
```

### roleAssignmentBlobDataReader

```yaml
name: roleAssignmentBlobDataReader
kind: Raw
type: Microsoft.Authorization/roleAssignments@2022-04-01

purpose: Grant Function App managed identity read access to source blob container
dependsOn: [functionApp]

parameters:
  required:
    - name: roleDefinitionId
      type: string
      description: Storage Blob Data Reader role ID
      example: 2a2b9908-6ea1-4ae2-8e65-a410df84e7d1
    - name: principalId
      type: string
      description: Principal ID of Function App managed identity
      example: (from functionApp output)
    - name: principalType
      type: string
      description: Type of principal
      example: ServicePrincipal
    - name: scope
      type: string
      description: Scope for role assignment (bloblogictest/test container)
      example: /subscriptions/3cdfd20a-bc20-4227-9611-6322804e335c/resourceGroups/appservice/providers/Microsoft.Storage/storageAccounts/bloblogictest/blobServices/default/containers/test

outputs:
  - name: roleAssignmentId
    type: string
    description: Resource ID of the role assignment

references:
  docs: https://learn.microsoft.com/en-us/azure/templates/microsoft.authorization/roleassignments
```

### roleAssignmentCognitiveServicesUser

```yaml
name: roleAssignmentCognitiveServicesUser
kind: Raw
type: Microsoft.Authorization/roleAssignments@2022-04-01

purpose: Grant Function App managed identity access to Content Understanding API
dependsOn: [functionApp]

parameters:
  required:
    - name: roleDefinitionId
      type: string
      description: Cognitive Services User role ID
      example: a97b65f3-24c7-4388-baec-2e87135dc908
    - name: principalId
      type: string
      description: Principal ID of Function App managed identity
      example: (from functionApp output)
    - name: principalType
      type: string
      description: Type of principal
      example: ServicePrincipal
    - name: scope
      type: string
      description: Scope for role assignment (Content Understanding resource)
      example: /subscriptions/3cdfd20a-bc20-4227-9611-6322804e335c/resourceGroups/appservice/providers/Microsoft.CognitiveServices/accounts/gal3729-resource

outputs:
  - name: roleAssignmentId
    type: string
    description: Resource ID of the role assignment

references:
  docs: https://learn.microsoft.com/en-us/azure/templates/microsoft.authorization/roleassignments
```

### roleAssignmentInternalStorageBlobOwner

```yaml
name: roleAssignmentInternalStorageBlobOwner
kind: Raw
type: Microsoft.Authorization/roleAssignments@2022-04-01

purpose: Grant Function App managed identity full access to its internal storage account
dependsOn: [functionApp, functionStorage]

parameters:
  required:
    - name: roleDefinitionId
      type: string
      description: Storage Blob Data Owner role ID
      example: b7e6dc6d-f1e8-4753-8033-0f276bb0955b
    - name: principalId
      type: string
      description: Principal ID of Function App managed identity
      example: (from functionApp output)
    - name: principalType
      type: string
      description: Type of principal
      example: ServicePrincipal
    - name: scope
      type: string
      description: Scope for role assignment (function storage account)
      example: (functionStorage resource ID)

outputs:
  - name: roleAssignmentId
    type: string
    description: Resource ID of the role assignment

references:
  docs: https://learn.microsoft.com/en-us/azure/templates/microsoft.authorization/roleassignments
```

### roleAssignmentInternalStorageQueueContributor

```yaml
name: roleAssignmentInternalStorageQueueContributor
kind: Raw
type: Microsoft.Authorization/roleAssignments@2022-04-01

purpose: Grant Function App managed identity queue access for blob trigger operations
dependsOn: [functionApp, functionStorage]

parameters:
  required:
    - name: roleDefinitionId
      type: string
      description: Storage Queue Data Contributor role ID
      example: 974c5e8b-45b9-4653-ba55-5f855dd0fb88
    - name: principalId
      type: string
      description: Principal ID of Function App managed identity
      example: (from functionApp output)
    - name: principalType
      type: string
      description: Type of principal
      example: ServicePrincipal
    - name: scope
      type: string
      description: Scope for role assignment (function storage account)
      example: (functionStorage resource ID)

outputs:
  - name: roleAssignmentId
    type: string
    description: Resource ID of the role assignment

references:
  docs: https://learn.microsoft.com/en-us/azure/templates/microsoft.authorization/roleassignments
```

# Implementation Plan

This implementation follows a phased approach to ensure proper resource creation, dependency management, and secure configuration using managed identities and least-privilege access patterns.

## Phase 1 — Foundation Infrastructure

**Objective:** Deploy foundational monitoring and storage infrastructure required by the Function App

This phase establishes the core infrastructure components that the Function App depends on: internal storage for function operations, Log Analytics workspace for centralized logging, and Application Insights for application performance monitoring.

- IMPLEMENT-GOAL-001: Deploy foundational monitoring and storage resources

| Task | Description | Action |
|------|-------------|--------|
| TASK-001 | Create storage account for Function App internals | Deploy `functionStorage` resource in `westeurope` region with Standard_LRS SKU |
| TASK-002 | Create Log Analytics workspace | Deploy `logAnalyticsWorkspace` with 30-day retention for centralized logging |
| TASK-003 | Create Application Insights instance | Deploy `applicationInsights` linked to Log Analytics workspace for telemetry collection |
| TASK-004 | Validate outputs | Ensure all resource IDs, connection strings, and instrumentation keys are captured for Phase 2 |

## Phase 2 — Function App Hosting

**Objective:** Deploy the Function App hosting plan and the Function App itself with managed identity enabled

This phase creates the compute infrastructure for running the Azure Function. The Consumption plan provides serverless, event-driven execution. The Function App is configured with system-assigned managed identity and application settings that reference the resources from Phase 1.

- IMPLEMENT-GOAL-002: Deploy Function App hosting infrastructure with managed identity

| Task | Description | Action |
|------|-------------|--------|
| TASK-005 | Create App Service Plan | Deploy `functionAppPlan` with Consumption (Y1) SKU for serverless execution |
| TASK-006 | Deploy Function App | Deploy `functionApp` using AVM module `br/public:avm/res/web/site:0.19.4` with system-assigned managed identity |
| TASK-007 | Configure application settings | Set `FUNCTIONS_EXTENSION_VERSION`, `FUNCTIONS_WORKER_RUNTIME`, `WEBSITE_NODE_DEFAULT_VERSION`, Application Insights connection, and storage configurations |
| TASK-008 | Configure blob trigger connection | Set `SourceStorageConnection__blobServiceUri` to point to existing `bloblogictest` storage using identity-based connection |
| TASK-009 | Configure Content Understanding endpoint | Set `CONTENT_UNDERSTANDING_ENDPOINT` and source storage parameters for document processing |
| TASK-010 | Capture managed identity principal ID | Extract system-assigned managed identity `principalId` for Phase 3 RBAC assignments |

## Phase 3 — RBAC Permissions

**Objective:** Grant Function App managed identity least-privilege access to source blob storage, Content Understanding, and internal storage

This phase implements security by assigning only the necessary permissions to the Function App's managed identity. Separate role assignments ensure the function can read source documents, access the AI service, and manage its internal state.

- IMPLEMENT-GOAL-003: Configure role-based access control for managed identity

| Task | Description | Action |
|------|-------------|--------|
| TASK-011 | Assign Storage Blob Data Reader role | Grant read access to `bloblogictest/test` container for source PDF/DOCX files |
| TASK-012 | Assign Cognitive Services User role | Grant access to Content Understanding API at `gal3729-resource` scope |
| TASK-013 | Assign Storage Blob Data Owner role | Grant full blob access to Function App's internal storage account for trigger operations |
| TASK-014 | Assign Storage Queue Data Contributor role | Grant queue access to internal storage for blob trigger poison message handling |
| TASK-015 | Validate role assignments | Verify all role assignments are successfully created and propagated (may take 1-2 minutes) |

## Phase 4 — Validation and Testing

**Objective:** Validate infrastructure deployment and prepare for function code deployment

This final phase ensures the infrastructure is correctly configured and ready for the TypeScript function code deployment. It includes validation checks and provides deployment instructions for the application code.

- IMPLEMENT-GOAL-004: Validate infrastructure and document deployment process

| Task | Description | Action |
|------|-------------|--------|
| TASK-016 | Validate Function App deployment | Verify Function App is running and Application Insights is receiving telemetry |
| TASK-017 | Validate managed identity configuration | Confirm system-assigned managed identity is enabled and has correct role assignments |
| TASK-018 | Validate blob trigger connection | Test that `SourceStorageConnection__blobServiceUri` configuration is correctly formatted |
| TASK-019 | Document function code deployment | Provide instructions for deploying TypeScript function code via `func azure functionapp publish` |
| TASK-020 | Document test procedure | Provide steps to upload test PDF/DOCX file to `bloblogictest/test` container and monitor execution |

# High-level design

## Architecture Overview

The solution implements a serverless event-driven architecture using Azure Functions with a blob storage trigger. When a PDF or DOCX file is uploaded to the existing `bloblogictest/test` container, an Azure Function is automatically triggered to process the document through Azure Content Understanding for field extraction.

## Resource Topology

```
┌─────────────────────────────────────────────────────────────┐
│                    Resource Group: appservice                 │
│                      Region: westeurope                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐          ┌──────────────────────┐       │
│  │ Log Analytics   │◄─────────┤ Application Insights │       │
│  │ Workspace       │          └──────────┬───────────┘       │
│  └─────────────────┘                     │                   │
│                                           │                   │
│  ┌──────────────────────────────────────┴─────────────┐      │
│  │          Azure Function App                        │      │
│  │  - Runtime: Node.js v20 (TypeScript)               │      │
│  │  - Plan: Consumption (Y1)                          │      │
│  │  - Identity: System-assigned Managed Identity      │      │
│  │  - Trigger: Blob Storage (bloblogictest/test)      │      │
│  └────┬───────────────────────┬──────────────┬────────┘      │
│       │                       │              │                │
│       │ Uses for              │ Reads from   │ Calls          │
│       │ internal ops          │ (on trigger) │ (for OCR)      │
│       │                       │              │                │
│  ┌────▼────────────┐    ┌────▼──────────┐  ┌▼───────────┐   │
│  │ Storage Account │    │ bloblogictest │  │  Content   │   │
│  │ (Function       │    │   Container:  │  │Understanding│  │
│  │  Internals)     │    │     test      │  │   (Existing)│  │
│  └─────────────────┘    └───────────────┘  └─────────────┘  │
│                                                               │
│  RBAC Assignments:                                            │
│  • Function → bloblogictest/test: Storage Blob Data Reader   │
│  • Function → Content Understanding: Cognitive Services User │
│  • Function → Internal Storage: Storage Blob Data Owner      │
│  • Function → Internal Storage: Storage Queue Data Contributor│
└───────────────────────────────────────────────────────────────┘
```

## Authentication Flow

All authentication uses **Azure Managed Identity** (passwordless):

1. **Function App to Source Blob Storage:** System-assigned managed identity authenticates via `SourceStorageConnection__blobServiceUri` configuration pointing to `bloblogictest.blob.core.windows.net`
2. **Function App to Content Understanding:** Managed identity obtains token using `DefaultAzureCredential` and calls the Content Understanding endpoint
3. **Function App to Internal Storage:** Managed identity authenticates to internal storage account using `AzureWebJobsStorage__accountName` configuration

## Security Principles

- **Least Privilege:** Role assignments are scoped to specific resources (container level for source storage, resource level for Content Understanding)
- **No Secrets:** No connection strings or API keys stored; all authentication uses managed identity
- **Network Isolation:** Option to add Private Endpoints for enhanced network security (not included in this initial deployment)
- **HTTPS Only:** Function App configured with `httpsOnly: true`

## Scalability Considerations

- **Consumption Plan:** Automatically scales based on incoming blob events (0 to 200 instances)
- **Blob Trigger:** Uses Azure Storage queues internally to manage trigger messages and ensure reliable processing
- **Concurrency:** Can process multiple documents in parallel as they arrive
- **Cost Efficiency:** Pay-per-execution model; no cost when idle

## Monitoring and Observability

- **Application Insights:** Captures all function invocations, dependencies, exceptions, and custom telemetry
- **Log Analytics:** Centralized query and analysis of logs across all components
- **Metrics:** Track blob trigger latency, function duration, Content Understanding API response times, success/failure rates
- **Alerts:** Can be configured post-deployment for critical failures or performance degradation

## Deployment Strategy

1. **Infrastructure First:** Deploy all Bicep resources in sequential phases
2. **Validation:** Wait for role assignment propagation (1-2 minutes)
3. **Code Deployment:** Use Azure Functions Core Tools to deploy TypeScript code
4. **Testing:** Upload test PDF/DOCX to `bloblogictest/test` container
5. **Monitoring:** Verify execution in Application Insights and function logs

## Extensibility

The architecture supports future enhancements:

- **Additional File Types:** Extend function code to support more document formats
- **Result Storage:** Add output binding to store extracted JSON in Cosmos DB or separate blob container
- **Dead Letter Queue:** Implement retry logic and poison message handling
- **Private Networking:** Add VNet integration and Private Endpoints for enhanced security
- **Custom Models:** Integrate custom Content Understanding models for domain-specific extraction
