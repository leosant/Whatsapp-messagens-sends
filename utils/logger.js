const winston = require('winston');
const path = require('path');

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: () => {
                const now = new Date();
                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const year = now.getFullYear();
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');
                return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
            }
        }),
        winston.format.printf(({ level, message, timestamp, ...metadata }) => {
            let msg = `${timestamp} [${level.toUpperCase()}] ${message}`;
            if (Object.keys(metadata).length > 0) {
                msg += ` ${JSON.stringify(metadata)}`;
            }
            return msg;
        })
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join('logs', 'whatsapp-sender.log'),
            maxsize: 10000000, // 10MB
            maxFiles: 5,
            tailable: true
        }),
        new winston.transports.Console()
    ]
});

module.exports = logger; 