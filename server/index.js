const WebSocket = require('ws');
const http = require('http');

const port = process.env.PORT || 4000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('LIGMA Master RBAC Server Active');
});

// 1. Initialize WebSocket Server for Manual Upgrade
const wss = new WebSocket.Server({ noServer: true });

// --- Persistence & State Management ---
const userRoles = new Map();     // socket -> role
const lockedNodes = new Map();   // nodeId -> role
const eventBuffer = [];          // Immutable log
let globalSeq = 0;               // Sequence counter

// 2. Explicit Upgrade Handling (Critical for Render Proxy)
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; }); // Heartbeat check

    console.log('--- New Client Connected (Handshake Pending) ---');

    ws.on('message', (message) => {
        let parsed;
        try { parsed = JSON.parse(message); } catch (e) { return; }

        // --- SMART ROLE HANDSHAKE ---
        if (parsed.type === 'CLIENT_READY') {
            const activeRoles = Array.from(userRoles.values());
            let role = 'Viewer'; 

            if (!activeRoles.includes('Lead')) {
                role = 'Lead';
            } else if (!activeRoles.includes('Contributor')) {
                role = 'Contributor';
            } else {
                role = 'Viewer';
            }

            userRoles.set(ws, role);
            ws.send(JSON.stringify({ type: 'init-role', role: role, seq: 0 }));
            console.log(`SUCCESS: User assigned as ${role}`);
            return;
        }

        const userRole = userRoles.get(ws);

        // --- RECONNECT SYNC ---
        if (parsed.type === 'SYNC_REQUEST') {
            const missed = eventBuffer.filter(e => e.seq > (parsed.lastSeq || 0));
            ws.send(JSON.stringify({ type: 'SYNC_REPLAY', events: missed }));
            return;
        }

        // --- RBAC SERVER-SIDE ENFORCEMENT ---
        if (parsed.type === 'update' || parsed.type === 'remove') {
            const nodeId = parsed.data.id;
            if (userRole === 'Viewer') {
                ws.send(JSON.stringify({ type: 'error', message: 'Access Denied: Viewers are in Read-Only mode.' }));
                return;
            }
            if (lockedNodes.has(nodeId) && userRole === 'Contributor') {
                ws.send(JSON.stringify({ type: 'error', message: 'Access Denied: Locked by Lead.' }));
                return;
            }

            globalSeq++;
            const event = { ...parsed, seq: globalSeq, author: userRole, timestamp: Date.now() };
            eventBuffer.push(event);
            if(eventBuffer.length > 5000) eventBuffer.shift();

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
            });
        }

        // --- LOCK COMMAND ---
        if (parsed.type === 'lock-node' && userRole === 'Lead') {
            lockedNodes.set(parsed.nodeId, 'Lead');
            wss.clients.forEach(c => {
                if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'node-locked', nodeId: parsed.nodeId }));
            });
        }
    });

    ws.on('close', () => {
        userRoles.delete(ws);
        console.log(`User left. Remaining: ${userRoles.size}`);
    });
});

// 3. Keep-Alive Heartbeat (Render requirements)
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

server.listen(port, () => console.log(`LIGMA Backend live on port ${port}`));
