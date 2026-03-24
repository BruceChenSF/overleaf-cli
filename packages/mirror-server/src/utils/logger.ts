/**
 * Structured logging utility
 */
export class Logger {
  private static logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info';

  static setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.logLevel = level;
  }

  static debug(message: string, ...args: any[]): void {
    if (this.logLevel === 'debug') {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  static info(message: string, ...args: any[]): void {
    console.log(`[INFO] ${message}`, ...args);
  }

  static warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }

  static error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }

  /**
   * Sync operation专用日志（带分隔符）
   */
  static logSync(operation: string, details: any): void {
    console.log('\n' + '='.repeat(60));
    console.log(`[SYNC] ${operation}`);
    console.log(JSON.stringify(details, null, 2));
    console.log('='.repeat(60) + '\n');
  }
}
