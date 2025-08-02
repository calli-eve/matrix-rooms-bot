import { z } from 'zod';

export const ConfigSchema = z.object({
    matrix: z.object({
        homeserverUrl: z.string()
            .url("Must be a valid URL")
            .describe("Matrix homeserver URL"),
        accessToken: z.string()
            .min(1, "Access token must not be empty")
            .describe("Matrix access token"),
        userId: z.string()
            .optional()
            .describe("Matrix user ID for the bot (optional, will be auto-detected)")
    }).describe("Matrix configuration"),
    
    roomMonitor: z.object({
        observedSpace: z.string()
            .optional()
            .describe("Space ID to monitor for new rooms"),
        notificationRoom: z.string()
            .optional()
            .describe("Room ID where notifications about new rooms will be posted"),
        checkInterval: z.number()
            .int()
            .positive()
            .default(300000)
            .describe("Interval in milliseconds to check for new rooms (default: 5 minutes)"),
        stateFile: z.string()
            .optional()
            .default('./room-monitor-state.json')
            .describe("File path to store room monitoring state (default: ./room-monitor-state.json)")
    }).optional().describe("Room monitoring configuration")
});

export const validateConfig = (config) => {
    try {
        return ConfigSchema.parse(config);
    } catch (error) {
        console.error("Configuration validation failed:");
        error.errors.forEach(err => {
            console.error(`- ${err.path.join('.')}: ${err.message}`);
        });
        process.exit(1);
    }
}; 