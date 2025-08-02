import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export class RoomMonitor {
    constructor(matrixClient, config) {
        this.matrixClient = matrixClient;
        this.config = config;
        this.observedSpace = config.roomMonitor?.observedSpace;
        this.notificationRoom = config.roomMonitor?.notificationRoom;
        this.stateFile = config.roomMonitor?.stateFile || './data/room-monitor-state.json';
        this.lastCheckedRooms = new Set();
        this.isRunning = false;
    }

    async fetchRoomsInSpace(spaceId, visitedSpaces = new Set()) {
        try {
            // Prevent infinite recursion
            if (visitedSpaces.has(spaceId)) {
                console.log(`Already visited space ${spaceId}, skipping`);
                return [];
            }
            visitedSpaces.add(spaceId);

            // Try to get room data directly from the server
            const response = await this.matrixClient.http.authedRequest(
                'GET',
                `/rooms/${encodeURIComponent(spaceId)}/state`
            );
            
            if (!response) {
                console.error(`Space ${spaceId} not found or not accessible. Make sure the bot is a member of this space.`);
                return [];
            }

            const rooms = [];
            const subspaces = [];

            // Look for m.space.child events in the state
            for (const event of response) {
                if (event.type === 'm.space.child') {
                    const roomId = event.state_key;
                    const roomName = event.content?.name || roomId;
                    
                    // Check if this is a space (has space type) or a regular room
                    if (event.content?.room_type === 'm.space') {
                        subspaces.push({
                            room_id: roomId,
                            name: roomName
                        });
                    } else {
                        rooms.push({
                            room_id: roomId,
                            name: roomName
                        });
                    }
                }
            }

            console.log(`Found ${rooms.length} rooms and ${subspaces.length} subspaces in space ${spaceId}`);

            // Recursively fetch rooms from subspaces
            for (const subspace of subspaces) {
                try {
                    console.log(`Checking subspace: ${subspace.name} (${subspace.room_id})`);
                    const subspaceRooms = await this.fetchRoomsInSpace(subspace.room_id, visitedSpaces);
                    rooms.push(...subspaceRooms);
                } catch (error) {
                    console.error(`Error fetching rooms from subspace ${subspace.room_id}:`, error);
                }
            }

            return rooms;
        } catch (error) {
            console.error('Error fetching rooms in space:', error);
            return [];
        }
    }

    async getRoomInfo(roomId) {
        try {
            // Get room state directly from the server
            const response = await this.matrixClient.http.authedRequest(
                'GET',
                `/rooms/${encodeURIComponent(roomId)}/state`
            );
            
            if (!response) {
                return null;
            }

            // Extract room name, alias, and description from state events
            let roomName = roomId;
            let canonicalAlias = null;
            let roomDescription = '';
            let memberCount = 0;

            for (const event of response) {
                if (event.type === 'm.room.name' && event.content?.name) {
                    roomName = event.content.name;
                } else if (event.type === 'm.room.canonical_alias' && event.content?.alias) {
                    canonicalAlias = event.content.alias;
                } else if (event.type === 'm.room.topic' && event.content?.topic) {
                    roomDescription = event.content.topic;
                } else if (event.type === 'm.room.member' && event.content?.membership === 'join') {
                    memberCount++;
                }
            }

            return {
                room_id: roomId,
                name: roomName,
                canonical_alias: canonicalAlias,
                description: roomDescription,
                joined_member_count: memberCount
            };
        } catch (error) {
            if (error.errcode === 'M_FORBIDDEN') {
                console.log(`Bot not in room ${roomId}, skipping`);
                return null;
            }
            console.error(`Error fetching room info for ${roomId}:`, error);
            return null;
        }
    }

    async sendRoomNotification(roomInfo) {
        try {
            const roomName = roomInfo.name || roomInfo.canonical_alias || roomInfo.room_id;
            const roomId = roomInfo.room_id;
            const roomAlias = roomInfo.canonical_alias;
            const memberCount = roomInfo.joined_member_count || 0;
            
            // Create the room link
            const roomLink = roomAlias ? `https://matrix.to/#/${roomAlias}` : `https://matrix.to/#/${roomId}`;
            
            // Create the notification message
            const message = {
                msgtype: 'm.text',
                body: `🆕 New room created: **${roomName}**\n👥 Members: ${memberCount}\n🔗 ${roomLink}`,
                format: 'org.matrix.custom.html',
                formatted_body: `<p>🆕 <strong>New room created:</strong> <strong>${roomName}</strong></p><p>👥 <strong>Members:</strong> ${memberCount}</p><p>🔗 <a href="${roomLink}">${roomLink}</a></p>`
            };

            await this.matrixClient.sendEvent(this.notificationRoom, 'm.room.message', message);
            console.log(`Notification sent for new room: ${roomName} (${roomId})`);
        } catch (error) {
            console.error('Error sending room notification:', error);
        }
    }

    async sendSimpleRoomNotification(roomId) {
        try {
            // Try to get room details if possible
            let roomName = roomId;
            let roomDescription = '';
            let roomAlias = null;

            try {
                const roomDetails = await this.getRoomInfo(roomId);
                if (roomDetails) {
                    roomName = roomDetails.name || roomId;
                    roomAlias = roomDetails.canonical_alias;
                    roomDescription = roomDetails.description || '';
                }
            } catch (error) {
                console.log(`Could not fetch details for room ${roomId}, using basic info`);
            }

            // Create the room link
            const roomLink = roomAlias ? `https://matrix.to/#/${roomAlias}` : `https://matrix.to/#/${roomId}`;
            
            // Create the notification message
            let body = `🆕 New room created in monitored space!\n\n`;
            body += `**Room Name:** ${roomName}\n`;
            if (roomDescription) {
                body += `**Description:** ${roomDescription}\n`;
            }
            body += `**Room ID:** ${roomId}\n`;
            body += `🔗 ${roomLink}`;

            let formattedBody = `<p>🆕 <strong>New room created in monitored space!</strong></p>`;
            formattedBody += `<p><strong>Room Name:</strong> ${roomName}</p>`;
            if (roomDescription) {
                formattedBody += `<p><strong>Description:</strong> ${roomDescription}</p>`;
            }
            formattedBody += `<p><strong>Room ID:</strong> ${roomId}</p>`;
            formattedBody += `<p>🔗 <a href="${roomLink}">${roomLink}</a></p>`;

            const message = {
                msgtype: 'm.text',
                body: body,
                format: 'org.matrix.custom.html',
                formatted_body: formattedBody
            };

            await this.matrixClient.sendEvent(this.notificationRoom, 'm.room.message', message);
            console.log(`Enhanced notification sent for new room: ${roomName} (${roomId})`);
        } catch (error) {
            console.error('Error sending enhanced room notification:', error);
        }
    }

    async checkForNewRooms(shouldAlert = true) {
        if (!this.observedSpace || !this.notificationRoom) {
            console.log('Room monitoring not configured - skipping check');
            return;
        }

        try {
            console.log('Checking for new rooms in space (including subspaces):', this.observedSpace);
            
            const rooms = await this.fetchRoomsInSpace(this.observedSpace);
            console.log(`Total rooms found (including subspaces): ${rooms.length}`);
            
            const currentRoomIds = new Set(rooms.map(room => room.room_id));
            
            // Find new rooms (rooms that weren't in our last check)
            const newRoomIds = [];
            for (const roomId of currentRoomIds) {
                if (!this.lastCheckedRooms.has(roomId)) {
                    newRoomIds.push(roomId);
                }
            }

            // Send notifications for new rooms only if we should alert
            if (shouldAlert) {
                for (const roomId of newRoomIds) {
                    await this.sendSimpleRoomNotification(roomId);
                    // Small delay between notifications
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } else {
                console.log('First run - not sending alerts for existing rooms');
            }

            // Update our set of known rooms
            this.lastCheckedRooms = currentRoomIds;

            // Save state to file
            await this.saveState();

            if (newRoomIds.length > 0) {
                if (shouldAlert) {
                    console.log(`Found ${newRoomIds.length} new room(s) in space and subspaces`);
                } else {
                    console.log(`Found ${newRoomIds.length} existing room(s) on first run`);
                }
            } else {
                console.log('No new rooms found');
            }

            return {
                checked: currentRoomIds.size,
                new: newRoomIds.length,
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
                console.log(`Loaded state from ${this.stateFile}: ${this.lastCheckedRooms.size} known rooms`);
                return true;
            } else {
                console.log(`No state file found at ${this.stateFile}, starting fresh`);
                return false;
            }
        } catch (error) {
            console.error('Error loading state:', error);
            return false;
        }
    }

    async saveState() {
        try {
            const state = {
                rooms: Array.from(this.lastCheckedRooms),
                lastUpdated: new Date().toISOString(),
                observedSpace: this.observedSpace
            };
            await writeFile(this.stateFile, JSON.stringify(state, null, 2));
            console.log(`State saved to ${this.stateFile}`);
        } catch (error) {
            console.error('Error saving state:', error);
        }
    }

    async startMonitoring() {
        if (this.isRunning) {
            console.log('Room monitoring is already running');
            return;
        }

        if (!this.observedSpace || !this.notificationRoom) {
            console.log('Room monitoring not configured - skipping start');
            return;
        }

        console.log('Starting room monitoring...');
        this.isRunning = true;

        // Load existing state
        const hasExistingState = await this.loadState();

        // Do initial check to populate lastCheckedRooms
        await this.checkForNewRooms(hasExistingState);

        // Set up recurring checks
        const checkInterval = this.config.roomMonitor?.checkInterval || 300000; // 5 minutes default
        this.monitoringInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.checkForNewRooms(true);
            }
        }, checkInterval);

        console.log(`Room monitoring started - checking every ${checkInterval / 1000} seconds`);
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