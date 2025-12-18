import { app, InvocationContext, input } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';

const blobTrigger = input.storageBlob({
  path: 'test/{name}',
  connection: 'SourceStorageConnection',
});

app.storageBlob('processDocument', {
  blobName: blobTrigger,
  handler: async (blob: Buffer, context: InvocationContext): Promise<void> => {
    const blobName = context.triggerMetadata?.name as string;
    const extension = blobName.toLowerCase().split('.').pop();

    context.log(`Processing blob: ${blobName}, size: ${blob.length} bytes`);

    // Filter for PDF and DOCX files only
    if (!['pdf', 'docx'].includes(extension || '')) {
      context.log(`Skipping file ${blobName} - not a PDF or DOCX file`);
      return;
    }

    try {
      let documentBuffer: Buffer = blob;

      // DOCX files are supported natively by Content Understanding
      if (extension === 'docx') {
        context.log(`Processing DOCX file: ${blobName}`);
      } else {
        context.log(`Processing PDF file: ${blobName}`);
      }

      // Send to Content Understanding
      context.log(`Sending to Content Understanding: ${blobName}`);
      const result = await analyzeDocument(documentBuffer, blobName, context);

      // Print the JSON result
      context.log('Content Understanding Result:');
      context.log(JSON.stringify(result, null, 2));
      
      context.log(`Successfully processed ${blobName}`);
    } catch (error) {
      context.error(`Error processing ${blobName}:`, error);
      throw error;
    }
  },
});

/**
 * Analyze document using Azure Content Understanding
 */
async function analyzeDocument(
  documentBuffer: Buffer,
  fileName: string,
  context: InvocationContext
): Promise<any> {
  const endpoint = process.env.CONTENT_UNDERSTANDING_ENDPOINT;
  const projectName = process.env.CONTENT_UNDERSTANDING_PROJECT || 'function-to-content';

  if (!endpoint) {
    throw new Error('CONTENT_UNDERSTANDING_ENDPOINT environment variable is not set');
  }

  // Get access token using managed identity
  const credential = new DefaultAzureCredential();
  const tokenResponse = await credential.getToken(
    'https://cognitiveservices.azure.com/.default'
  );

  // Determine content type based on file extension
  const contentType = fileName.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  // Call Content Understanding API
  // Using Document Intelligence API pattern
  const apiVersion = '2024-07-31-preview';
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/${projectName}:analyze?api-version=${apiVersion}`;

  context.log(`Calling Content Understanding API: ${analyzeUrl}`);

  const response = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenResponse.token}`,
      'Content-Type': contentType,
    },
    body: documentBuffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Content Understanding API error: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  // Get operation location for polling
  const operationLocation = response.headers.get('operation-location');
  if (!operationLocation) {
    throw new Error('No operation-location header in response');
  }

  context.log(`Analysis started. Operation location: ${operationLocation}`);

  // Poll for results
  return await pollForResults(operationLocation, tokenResponse.token, context);
}

/**
 * Poll for analysis results
 */
async function pollForResults(
  operationLocation: string,
  accessToken: string,
  context: InvocationContext,
  maxAttempts: number = 60,
  delayMs: number = 2000
): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(operationLocation, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to get analysis results: ${response.status} ${response.statusText}`
      );
    }

    const result = await response.json();
    const status = result.status;

    context.log(`Analysis status (attempt ${attempt + 1}/${maxAttempts}): ${status}`);

    if (status === 'succeeded') {
      return result.analyzeResult;
    } else if (status === 'failed') {
      throw new Error(`Analysis failed: ${JSON.stringify(result.error || result)}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Analysis timed out');
}
