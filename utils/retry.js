const logger = require('./logger');

class RetryHandler {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 5;
        this.initialDelay = options.initialDelay || 1000; // 1 second
        this.maxDelay = options.maxDelay || 30000; // 30 seconds
        this.factor = options.factor || 2;
        this.jitter = options.jitter || 0.1;
    }

    async execute(operation, context = '') {
        let attempt = 0;
        let delay = this.initialDelay;

        while (attempt < this.maxRetries) {
            try {
                logger.info(`Attempt ${attempt + 1}/${this.maxRetries} - ${context}`);
                return await operation();
            } catch (error) {
                attempt++;
                
                if (attempt === this.maxRetries) {
                    logger.error(`Final attempt failed - ${context}`, { error: error.message });
                    throw error;
                }

                // Calculate next delay with jitter
                const jitterAmount = delay * this.jitter * (Math.random() * 2 - 1);
                const nextDelay = Math.min(delay + jitterAmount, this.maxDelay);

                logger.warn(`Attempt ${attempt} failed, retrying in ${Math.round(nextDelay/1000)}s - ${context}`, {
                    error: error.message,
                    nextDelay: nextDelay,
                    attempt: attempt
                });

                await new Promise(resolve => setTimeout(resolve, nextDelay));
                delay *= this.factor;
            }
        }
    }
}

module.exports = RetryHandler; 