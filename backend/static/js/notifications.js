// Notification and Progress System

class NotificationManager {
    constructor() {
        this.notifications = [];
        this.notificationId = 0;
    }

    show(title, message, type = 'info', duration = 5000) {
        const id = this.notificationId++;
        
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification-toast ${type}`;
        notification.id = `notification-${id}`;
        
        // Icon based on type
        let icon = '';
        if (type === 'success') {
            icon = '<svg class="notification-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--primary);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
        } else if (type === 'error') {
            icon = '<svg class="notification-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #C5221F;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
        } else {
            icon = '<svg class="notification-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: #1976D2;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
        }
        
        notification.innerHTML = `
            ${icon}
            <div class="notification-content">
                <div class="notification-title">${title}</div>
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close" onclick="notificationManager.close(${id})">&times;</button>
        `;
        
        document.body.appendChild(notification);
        this.notifications.push({ id, element: notification });
        
        // Auto-close after duration
        if (duration > 0) {
            setTimeout(() => this.close(id), duration);
        }
        
        // DO NOT show browser notifications - they overlap with our in-app notifications
        
        return id;
    }

    close(id) {
        const notification = this.notifications.find(n => n.id === id);
        if (notification) {
            notification.element.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                notification.element.remove();
                this.notifications = this.notifications.filter(n => n.id !== id);
            }, 300);
        }
    }

    success(title, message, duration = 5000) {
        return this.show(title, message, 'success', duration);
    }

    error(title, message, duration = 7000) {
        return this.show(title, message, 'error', duration);
    }

    info(title, message, duration = 5000) {
        return this.show(title, message, 'info', duration);
    }
}

class ProgressTracker {
    constructor() {
        this.startTime = null;
        this.stages = [];
        this.currentStage = 0;
    }

    start(stages = ['Processing...']) {
        this.startTime = Date.now();
        this.stages = stages;
        this.currentStage = 0;
        this.updateProgress(0, stages[0]);
    }

    nextStage() {
        this.currentStage++;
        if (this.currentStage < this.stages.length) {
            const progress = (this.currentStage / this.stages.length) * 100;
            this.updateProgress(progress, this.stages[this.currentStage]);
        }
    }

    updateProgress(percent, message = null) {
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const loadingMessage = document.getElementById('loadingMessage');
        const etaText = document.getElementById('etaText');
        
        if (progressFill) {
            progressFill.style.width = `${percent}%`;
        }
        
        if (progressText) {
            progressText.textContent = `${Math.round(percent)}%`;
        }
        
        if (message && loadingMessage) {
            loadingMessage.textContent = message;
        }
        
        // Calculate ETA
        if (this.startTime && percent > 0 && percent < 100) {
            const elapsed = Date.now() - this.startTime;
            const total = (elapsed / percent) * 100;
            const remaining = total - elapsed;
            
            if (etaText && remaining > 0) {
                const seconds = Math.ceil(remaining / 1000);
                if (seconds < 60) {
                    etaText.textContent = `ETA: ${seconds}s`;
                } else {
                    const minutes = Math.floor(seconds / 60);
                    const secs = seconds % 60;
                    etaText.textContent = `ETA: ${minutes}m ${secs}s`;
                }
            }
        } else if (etaText) {
            etaText.textContent = '';
        }
    }

    complete(message = 'Complete!') {
        this.updateProgress(100, message);
        
        // Clear ETA
        const etaText = document.getElementById('etaText');
        if (etaText) {
            etaText.textContent = '';
        }
    }

    reset() {
        this.startTime = null;
        this.stages = [];
        this.currentStage = 0;
        this.updateProgress(0, '');
    }
}

// Global instances
const notificationManager = new NotificationManager();
const progressTracker = new ProgressTracker();

// DO NOT request notification permission - we only use in-app notifications

// Add slideOut animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
