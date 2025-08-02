import { readFile } from 'fs/promises';
import { validateConfig } from './config.schema.js';
import { MatrixClient } from 'matrix-js-sdk';
import { RoomMonitor } from './room-monitor.js';

// Load and validate configuration
const config = JSON.parse(await readFile('./config.json', 'utf-8'));
const validatedConfig = validateConfig(config);

// Initialize Matrix client
const matrixClient = new MatrixClient({
    baseUrl: validatedConfig.matrix.homeserverUrl,
    accessToken: validatedConfig.matrix.accessToken,
    userId: validatedConfig.matrix.userId
});

console.log('Matrix client initialized with user ID:', matrixClient.getUserId());

// Initialize room monitoring if configured
const roomMonitor = new RoomMonitor(matrixClient, validatedConfig);

// Start room monitoring if configured
if (roomMonitor && validatedConfig.roomMonitor?.observedSpace && validatedConfig.roomMonitor?.notificationRoom) {
    console.log('Starting room monitoring...');
    
    // Start room monitoring after 5 seconds
    setTimeout(async () => {
        try {
            await roomMonitor.startMonitoring();
        } catch (error) {
            console.error('Failed to start room monitoring:', error);
        }
    }, 5000);
} else {
    console.log('Room monitoring not configured - skipping');
}

console.log('Matrix Rooms Bot started successfully!'); 