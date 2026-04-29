const WebSocket = require('ws');
const http = require('http');

const port = process.env.PORT || 4000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('LIGMA Production Server - Active');
});

// 1. Initialize WebSocket Server properly
const wss = new WebSocket.Server({ noServer: true });

// --- SYSTEM STATE ---
const userRoles = new Map();     // ws -> role
const lockedNodes = new Map();   // nodeId -> role
const eventBuffer = [];          // Challenge 04: Append-Only Log
let globalSeq = 0;               // Challenge 05: Sequence

// 2. Explicit Upgrade Handling (Critical for Render Proxy)
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; }); // Heartbeat logic

    console.log('--- Client connected to LIGMA Engine ---');

    ws.on('message', (message) => {
        let parsed;
        try { parsed = JSON.parse(message); } catch (e) { return; }

        // --- HANDSHAKE: Role Assignment ---
        if (parsed.type === 'CLIENT_READY') {
            const currentActiveRoles = Array.from(userRoles.values());
            let role = 'Viewer';

            if (!currentActiveRoles.includes('Lead')) {
                role = 'Lead';
            } else if (!currentActiveRoles.includes('Contributor')) {
                role = 'Contributor';
            }

            userRoles.set(ws, role);
            ws.send(JSON.stringify({ type: 'init-role', role: role, seq: 0 }));
            console.log(`[HANDSHAKE] User assigned as: ${role}`);
            return;
        }

        const userRole = userRoles.get(ws);

        // --- RECONNECT: Delta Replay ---
        if (parsed.type === 'SYNC_REQUEST') {
            const missedEvents = eventBuffer.filter(e => e.seq > (parsed.lastSeq || 0));
            ws.send(JSON.stringify({ type: 'SYNC_REPLAY', events: missedEvents }));
            return;
        }

        // --- RBAC: Server-side Enforcement ---
        if (parsed.type === 'update' || parsed.type === 'remove') {
            const nodeId = parsed.data.id;
            
            if (userRole === 'Viewer' || (lockedNodes.has(nodeId) && userRole !== 'Lead')) {
                ws.send(JSON.stringify({ 
                    type: 'error', 
                    message: 'Access Denied: Node is locked or you have insufficient permissions.' 
                }));
                return;
            }

            // Global Sequencing & Event Sourcing
            globalSeq++;
            const eventWithSeq = { 
                ...parsed, 
                seq: globalSeq, 
                author: userRole,
                timestamp: Date.now() 
            };
            
            eventBuffer.push(eventWithSeq);
            if (eventBuffer.length > 5000) eventBuffer.shift();

            // Broadcast to everyone
            const broadcastMsg = JSON.stringify(eventWithSeq);
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(broadcastMsg);
                }
            });
        }

        // --- NODE LOCKING ---
        if (parsed.type === 'lock-node' && userRole === 'Lead') {
            lockedNodes.set(parsed.nodeId, 'Lead');
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'node-locked', nodeId: parsed.nodeId }));
                }
            });
        }
    });

    ws.on('close', () => {
        const leavingRole = userRoles.get(ws);
        userRoles.delete(ws);
        console.log(`[EXIT] User (${leavingRole}) disconnected.`);
    });
});

// 3. Keep-Alive Heartbeat (30s)
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

server.listen(port, () => {
    console.log(`
    ===========================================
    LIGMA PRODUCTION BACKEND LIVE ON PORT ${port}
    ===========================================
    `);
});
