import { DefaultAzureCredential } from '@azure/identity';
import { InvocationContext } from '@azure/functions';

export interface AnalyzeResult {
  content: string;
  pages?: any[];
  tables?: any[];
  keyValuePairs?: any[];
  documents?: any[];
  [key: string]: any;
}

/**
 * Client for Azure Content Understanding (Document Intelligence)
 */
export class ContentUnderstandingClient {
  private credential: DefaultAzureCredential;
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    this.credential = new DefaultAzureCredential();
  }

  /**
   * Analyze a document using a custom Content Understanding model
   */
  async analyzeDocument(
    projectName: string,
    documentBuffer: Buffer,
    fileName: string,
    context: InvocationContext
  ): Promise<AnalyzeResult> {
    const tokenResponse = await this.credential.getToken(
      'https://cognitiveservices.azure.com/.default'
    );

    const contentType = fileName.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    const apiVersion = '2024-07-31-preview';
    const analyzeUrl = `${this.endpoint}/documentintelligence/documentModels/${projectName}:analyze?api-version=${apiVersion}`;

    context.log(`Analyzing document with model: ${projectName}`);

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

    const operationLocation = response.headers.get('operation-location');
    if (!operationLocation) {
      throw new Error('No operation-location header in response');
    }

    return await this.pollForResults(
      operationLocation,
      tokenResponse.token,
      context
    );
  }

  /**
   * Poll for analysis results until completion
   */
  private async pollForResults(
    operationLocation: string,
    accessToken: string,
    context: InvocationContext,
    maxAttempts: number = 60,
    delayMs: number = 2000
  ): Promise<AnalyzeResult> {
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

      context.log(`Analysis status (attempt ${attempt + 1}): ${status}`);

      if (status === 'succeeded') {
        return result.analyzeResult;
      } else if (status === 'failed') {
        throw new Error(
          `Analysis failed: ${JSON.stringify(result.error || result)}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error('Analysis timed out after maximum polling attempts');
  }
}
