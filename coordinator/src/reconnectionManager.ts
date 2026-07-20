/**
 * Handles endpoint disconnection and retry with exponential backoff.
 */

export type ConnectionStatus = 'connected' | 'error' | 'reconnecting';

interface ReconnectionConfig {
  endpoint: string;
  providerType: string;
}

export class ReconnectionManager {
  private status: ConnectionStatus = 'connected';
  private retryCount: number = 0;
  private maxDelay: number = 30000;
  private baseDelay: number = 10000;
  private onStatusChange: (status: ConnectionStatus, message?: string) => void;
  private config: ReconnectionConfig = { endpoint: '', providerType: 'kaggle' };

  constructor(onStatusChange: (status: ConnectionStatus, message?: string) => void) {
    this.onStatusChange = onStatusChange;
  }

  updateConfig(config: Partial<ReconnectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  handleFailure(error: any): void {
    if (this.status === 'error') return;

    this.status = 'error';
    this.onStatusChange('error', error.message || 'Connection failed');
    this.startRetrying();
  }

  private async verifyEndpointReachable(): Promise<boolean> {
    try {
      const url = this.config.endpoint.replace('/infer', '/health');
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private scheduleRetry(): void {
    this.status = 'reconnecting';
    this.onStatusChange('reconnecting', `Attempting to reconnect... (Attempt ${this.retryCount + 1})`);

    const delay = Math.min(this.baseDelay * Math.pow(1.5, this.retryCount), this.maxDelay);

    setTimeout(async () => {
      this.retryCount++;

      if (this.config.providerType === 'kaggle') {
        const reachable = await this.verifyEndpointReachable();
        if (reachable) {
          this.status = 'connected';
          this.onStatusChange('connected', this.config.endpoint);
        } else {
          this.scheduleRetry();
        }
      } else {
        // API providers: assume recovered, will fail gracefully on next inference attempt
        this.status = 'connected';
        this.onStatusChange('connected', 'Ready to retry connection');
      }
    }, delay);
  }

  private startRetrying(): void {
    this.scheduleRetry();
  }

  reset(): void {
    this.status = 'connected';
    this.retryCount = 0;
  }
}
