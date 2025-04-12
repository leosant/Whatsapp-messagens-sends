module.exports = {
    testEnvironment: 'jsdom',
    setupFilesAfterEnv: ['@testing-library/jest-dom'],
    testMatch: [
        '**/tests/**/*.test.js'
    ],
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    verbose: true
}; 