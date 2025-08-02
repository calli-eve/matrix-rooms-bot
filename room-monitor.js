import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

export class RoomMonitor {
    constructor(matrixClient, config) {
        this.matrixClient = matrixClient;
        this.config = config;
        this.observedSpace = config.roomMonitor?.observedSpace;
        this.notificationRoom = config.roomMonitor?.notificationRoom;
        this.stateFile = config.roomMonitor?.stateFile || './data/room-monitor-state.json';
        this.lastCheckedRooms = new Set();
        this.roomNames = {};
        this.isRunning = false;
    }

    async fetchRoomsInSpace(spaceId, visitedSpaces = new Set()) {
        const allRooms = [];
    
        const recurseHierarchy = async (spaceId) => {
            if (visitedSpaces.has(spaceId)) return;
            visitedSpaces.add(spaceId);
    
            let nextBatch = null;
            do {
                let query = `/rooms/${encodeURIComponent(spaceId)}/hierarchy?limit=100`;
                if (nextBatch) query += `&from=${encodeURIComponent(nextBatch)}`;
    
                const response = await this.matrixClient.http.authedRequest(
                    'GET',
                    query,
                    undefined,
                    undefined,
                    {
                        prefix: '/_matrix/client/v1'  // ✅ Correct path
                    }
                );
    
                const rooms = response.rooms || [];
    
                for (const room of rooms) {
                    const isSpace = room.room_type === 'm.space';
                    const metadata = {
                        room_id: room.room_id,
                        name: room.name || null,
                        canonicalAlias: room.canonical_alias || null,
                        topic: room.topic || '',  // ✅ Pull description
                        memberCount: room.num_joined_members || 0
                    };
    
                    if (isSpace) {
                        await recurseHierarchy(room.room_id);
                    } else {
                        allRooms.push(metadata);
                    }
                }
    
                nextBatch = response.next_batch;
            } while (nextBatch);
        };
    
        try {
            await recurseHierarchy(spaceId);
        } catch (error) {
            console.error(`Error traversing space hierarchy: ${error.message}`);
        }
    
        return allRooms;
    }

    async sendEnhancedRoomNotification(room) {
        try {
            const roomId = room.room_id;
            const roomName = room.name || room.canonicalAlias || roomId;
            const roomDescription = room.topic || '';
            const roomAlias = room.canonicalAlias;
            const memberCount = room.memberCount || 0;

            const roomLink = roomAlias ? `https://matrix.to/#/${roomAlias}` : `https://matrix.to/#/${roomId}`;

            let body = `🆕 New room created in monitored space!\n\n`;
            if (roomName !== roomId) body += `**Room Name:** ${roomName}\n`;
            if (roomDescription) body += `**Description:** ${roomDescription}\n`;
            body += `**Room ID:** ${roomId}\n`;
            body += `👥 Members: ${memberCount}\n`;
            body += `🔗 ${roomLink}`;

            let formattedBody = `<p>🆕 <strong>New room created in monitored space!</strong></p>`;
            if (roomName !== roomId) formattedBody += `<p><strong>Room Name:</strong> ${roomName}</p>`;
            if (roomDescription) formattedBody += `<p><strong>Description:</strong> ${roomDescription}</p>`;
            formattedBody += `<p><strong>Room ID:</strong> ${roomId}</p>`;
            formattedBody += `<p><strong>👥 Members:</strong> ${memberCount}</p>`;
            formattedBody += `<p>🔗 <a href="${roomLink}">${roomLink}</a></p>`;

            const message = {
                msgtype: 'm.text',
                body: body,
                format: 'org.matrix.custom.html',
                formatted_body: formattedBody
            };

            console.log(`Sending notification for room ${roomId}`);
            await this.matrixClient.sendEvent(this.notificationRoom, 'm.room.message', message);
        } catch (error) {
            console.error('Error sending notification:', error);
        }
    }

    async checkForNewRooms(shouldAlert = true) {
        if (!this.observedSpace || !this.notificationRoom) {
            console.log('Room monitoring not configured');
            return;
        }

        try {
            const rooms = await this.fetchRoomsInSpace(this.observedSpace);
            const currentRoomIds = new Set(rooms.map(room => room.room_id));
            const newRooms = rooms.filter(room => !this.lastCheckedRooms.has(room.room_id));

            for (const room of newRooms) {
                if (room.name && room.name !== room.room_id) {
                    this.roomNames[room.room_id] = room.name;
                }
            }

            if (shouldAlert && newRooms.length > 0) {
                for (const room of newRooms) {
                    await this.sendEnhancedRoomNotification(room);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            this.lastCheckedRooms = currentRoomIds;
            await this.saveState();

            return {
                checked: currentRoomIds.size,
                new: newRooms.length,
                timestamp: new Date()
            };
        } catch (error) {
            console.error('Error checking for new rooms:', error);
            return {
                checked: 0,
                new: 0,
                error: error.message,
                timestamp: new Date()
            };
        }
    }

    async loadState() {
        try {
            if (existsSync(this.stateFile)) {
                const stateData = await readFile(this.stateFile, 'utf-8');
                const state = JSON.parse(stateData);
                this.lastCheckedRooms = new Set(state.rooms || []);
                this.roomNames = state.roomNames || {};
                console.log(`Loaded state from ${this.stateFile}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error loading state:', error);
            return false;
        }
    }

    async saveState() {
        try {
            const state = {
                rooms: Array.from(this.lastCheckedRooms),
                roomNames: this.roomNames,
                lastUpdated: new Date().toISOString(),
                observedSpace: this.observedSpace
            };
            await writeFile(this.stateFile, JSON.stringify(state, null, 2));
            console.log(`Saved state to ${this.stateFile}`);
        } catch (error) {
            console.error('Error saving state:', error);
        }
    }

    async startMonitoring() {
        if (this.isRunning) return;
        if (!this.observedSpace || !this.notificationRoom) return;

        console.log('Starting room monitoring...');
        this.isRunning = true;

        const hasExistingState = await this.loadState();
        await this.checkForNewRooms(hasExistingState);

        const interval = this.config.roomMonitor?.checkInterval || 300000;
        this.monitoringInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.checkForNewRooms(true);
            }
        }, interval);

        console.log(`Room monitoring started (interval: ${interval / 1000}s)`);
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        this.isRunning = false;
        console.log('Room monitoring stopped');
    }

    isMonitoring() {
        return this.isRunning;
    }

    getConfig() {
        return {
            observedSpace: this.observedSpace,
            notificationRoom: this.notificationRoom,
            isRunning: this.isRunning
        };
    }
}
