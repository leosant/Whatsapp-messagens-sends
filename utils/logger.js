const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../logs');
        this.logFile = path.join(this.logDir, 'whatsapp-sender.log');
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] [${level}] ${message}`;
        if (data) {
            logMessage += `\nData: ${JSON.stringify(data, null, 2)}`;
        }
        return logMessage + '\n';
    }

    log(level, message, data = null) {
        const logMessage = this.formatMessage(level, message, data);
        console.log(logMessage);
        fs.appendFileSync(this.logFile, logMessage);
    }

    info(message, data = null) {
        this.log('INFO', message, data);
    }

    error(message, data = null) {
        this.log('ERROR', message, data);
    }

    warn(message, data = null) {
        this.log('WARN', message, data);
    }

    debug(message, data = null) {
        this.log('DEBUG', message, data);
    }
}

module.exports = new Logger(); 