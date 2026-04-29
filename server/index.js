const WebSocket = require('ws');
const http = require('http');

const port = process.env.PORT || 4000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('LIGMA Master RBAC Server Active');
});

const wss = new WebSocket.Server({ server });

// --- Persistence & State Management ---
const userRoles = new Map();     // socket -> role
const lockedNodes = new Map();   // nodeId -> role
const eventBuffer = [];          // Immutable log
let globalSeq = 0;               // Sequence counter

wss.on('connection', (socket) => {
    console.log('--- New Connection Attempt (Pending Handshake) ---');

    socket.on('message', (message) => {
        let parsed;
        try {
            parsed = JSON.parse(message);
        } catch (e) { return; }

        // --- SMART ROLE ASSIGNMENT (PHASE 6) ---
        if (parsed.type === 'CLIENT_READY') {
            const activeRoles = Array.from(userRoles.values());
            let role = 'Viewer'; // Default

            if (!activeRoles.includes('Lead')) {
                role = 'Lead';
            } else if (!activeRoles.includes('Contributor')) {
                role = 'Contributor';
            } else {
                role = 'Viewer';
            }

            userRoles.set(socket, role);
            socket.send(JSON.stringify({ type: 'init-role', role: role, seq: 0 }));
            console.log(`SUCCESS: User assigned as ${role}`);
            return;
        }

        const userRole = userRoles.get(socket);

        // --- RECONNECT SYNC ---
        if (parsed.type === 'SYNC_REQUEST') {
            const missed = eventBuffer.filter(e => e.seq > (parsed.lastSeq || 0));
            socket.send(JSON.stringify({ type: 'SYNC_REPLAY', events: missed }));
            return;
        }

        // --- RBAC SERVER-SIDE ENFORCEMENT (CRITICAL) ---
        if (parsed.type === 'update' || parsed.type === 'remove') {
            const nodeId = parsed.data.id;

            // 1. Viewer Protection (Read-only)
            if (userRole === 'Viewer') {
                socket.send(JSON.stringify({ 
                    type: 'error', 
                    message: 'Access Denied: Viewers are in Read-Only mode.' 
                }));
                return;
            }

            // 2. Contributor Protection (Locked Node Check)
            if (lockedNodes.has(nodeId) && userRole === 'Contributor') {
                socket.send(JSON.stringify({ 
                    type: 'error', 
                    message: 'Access Denied: This node is locked by the Lead.' 
                }));
                return;
            }

            // Broadcast the change if authorized
            globalSeq++;
            const event = { ...parsed, seq: globalSeq, author: userRole, timestamp: Date.now() };
            eventBuffer.push(event);
            if(eventBuffer.length > 5000) eventBuffer.shift();

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(event));
                }
            });
        }

        // --- LOCK COMMAND ---
        if (parsed.type === 'lock-node') {
            if (userRole === 'Lead') {
                lockedNodes.set(parsed.nodeId, 'Lead');
                console.log(`NODE LOCKED: ${parsed.nodeId}`);
                wss.clients.forEach(c => {
                    if (c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify({ type: 'node-locked', nodeId: parsed.nodeId }));
                    }
                });
            } else {
                socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized: Only Lead can lock nodes.' }));
            }
        }
    });

    socket.on('close', () => {
        const role = userRoles.get(socket);
        userRoles.delete(socket);
        console.log(`User left: ${role}. Active connections: ${userRoles.size}`);
    });
});

server.listen(port, () => {
    console.log(`
    ===========================================
    LIGMA PRODUCTION SERVER LIVE ON PORT ${port}
    - Three-Role RBAC: ACTIVE
    - Event Sourcing: ACTIVE
    - Handshake Protocol: ACTIVE
    ===========================================
    `);
});