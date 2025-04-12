const logger = require('./logger');

class RetryHandler {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.initialDelay = options.initialDelay || 30000; // 30 segundos
        this.maxDelay = options.maxDelay || 120000; // 2 minutos
        this.factor = options.factor || 2;
        this.jitter = options.jitter || 0.1;
        this.currentRetry = 0;
    }

    async execute(operation, description = '') {
        while (this.currentRetry < this.maxRetries) {
            try {
                return await operation();
            } catch (error) {
                this.currentRetry++;
                if (this.currentRetry >= this.maxRetries) {
                    throw error;
                }

                const delay = this.calculateDelay();
                console.log(`Retry ${this.currentRetry}/${this.maxRetries} for ${description} after ${delay/1000} seconds`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    calculateDelay() {
        const delay = Math.min(
            this.initialDelay * Math.pow(this.factor, this.currentRetry - 1),
            this.maxDelay
        );
        const jitter = delay * this.jitter;
        return delay + (Math.random() * jitter * 2 - jitter);
    }

    reset() {
        this.currentRetry = 0;
    }
}

module.exports = RetryHandler; 
module.exports = RetryHandler; 