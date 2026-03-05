export interface Notification {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  action: () => void;
}

export class NotificationSystem {
  private container: HTMLElement | null = null;

  /**
   * Show notification
   */
  show(notification: Notification): void {
    this.ensureContainer();
    const element = this.createElement(notification);
    this.container!.appendChild(element);

    // Auto-hide after duration
    if (notification.duration) {
      setTimeout(() => {
        this.hide(element);
      }, notification.duration);
    }

    // Animate in
    requestAnimationFrame(() => {
      element.classList.add('show');
    });
  }

  /**
   * Ensure container exists
   */
  private ensureContainer(): void {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'claude-notifications';
      this.container.className = 'claude-notification-container';
      document.body.appendChild(this.container);
    }
  }

  /**
   * Create notification element
   */
  private createElement(notification: Notification): HTMLElement {
    const element = document.createElement('div');
    element.className = `claude-notification claude-notification-${notification.type}`;

    const styles: Record<string, { bg: string; icon: string }> = {
      info: { bg: '#3794ff', icon: 'ℹ️' },
      success: { bg: '#73c991', icon: '✓' },
      warning: { bg: '#ffc107', icon: '⚠️' },
      error: { bg: '#f14c4c', icon: '✕' }
    };

    const style = styles[notification.type];

    element.innerHTML = `
      <div class="notification-icon" style="background: ${style.bg}">
        ${style.icon}
      </div>
      <div class="notification-content">
        <div class="notification-title">${this.escapeHtml(notification.title)}</div>
        ${notification.message ? `<div class="notification-message">${this.escapeHtml(notification.message)}</div>` : ''}
        ${notification.actions ? this.renderActions(notification.actions) : ''}
      </div>
      <button class="notification-close" aria-label="Close">×</button>
    `;

    // Bind close button
    element.querySelector('.notification-close')?.addEventListener('click', () => {
      this.hide(element);
    });

    // Bind action buttons
    notification.actions?.forEach(action => {
      element.querySelector(`[data-action="${this.escapeHtml(action.label)}"]`)?.addEventListener('click', () => {
        action.action();
        this.hide(element);
      });
    });

    return element;
  }

  /**
   * Render action buttons
   */
  private renderActions(actions: NotificationAction[]): string {
    return `
      <div class="notification-actions">
        ${actions.map(action => `
          <button data-action="${this.escapeHtml(action.label)}" class="notification-action-btn">
            ${this.escapeHtml(action.label)}
          </button>
        `).join('')}
      </div>
    `;
  }

  /**
   * Hide notification
   */
  private hide(element: HTMLElement): void {
    element.classList.remove('show');
    element.classList.add('hide');

    setTimeout(() => {
      element.remove();
    }, 300);
  }

  /**
   * Clear all notifications
   */
  clearAll(): void {
    this.container?.remove();
    this.container = null;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Export singleton
export const notificationSystem = new NotificationSystem();

// Convenience function
export const showNotification = (notification: Notification) => {
  notificationSystem.show(notification);
};
