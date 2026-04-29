const WebSocket = require('ws');
const http = require('http');
const port = process.env.PORT || 4000;
const server = http.createServer((req, res) => { res.writeHead(200); res.end('LIGMA Master RBAC Active'); });
const wss = new WebSocket.Server({ server });

// --- SYSTEM STATE ---
const activeSessions = new Map(); // userId -> { role, socket }
const lockedNodes = new Map();   
const eventBuffer = [];          
let globalSeq = 0;               

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        let parsed;
        try { parsed = JSON.parse(message); } catch (e) { return; }

        if (parsed.type === 'CLIENT_READY') {
            const uid = parsed.userId || `anon_${Math.random()}`;
            
            // 1. Check if this UID already has an active role
            let role = 'Viewer';
            
            if (activeSessions.has(uid)) {
                role = activeSessions.get(uid).role;
            } else {
                // 2. New UID, assign based on slots
                const currentlyAssignedRoles = Array.from(activeSessions.values()).map(s => s.role);
                
                if (!currentlyAssignedRoles.includes('Lead')) role = 'Lead';
                else if (!currentlyAssignedRoles.includes('Contributor')) role = 'Contributor';
                
                activeSessions.set(uid, { role, socket: ws });
            }

            ws.userId = uid; // Attach UID to socket for easy cleanup
            ws.send(JSON.stringify({ type: 'init-role', role: role, seq: 0 }));
            console.log(`[AUTH] User: ${uid} | Assigned: ${role} | Total: ${activeSessions.size}`);
            return;
        }

        // ... REST OF THE LOGIC ...
        const userRole = activeSessions.get(ws.userId)?.role || 'Viewer';

        if (parsed.type === 'SYNC_REQUEST') {
            const missed = eventBuffer.filter(e => e.seq > (parsed.lastSeq || 0));
            ws.send(JSON.stringify({ type: 'SYNC_REPLAY', events: missed }));
            return;
        }

        if (parsed.type === 'update' || parsed.type === 'remove') {
            const nodeId = parsed.data.id;
            if (userRole === 'Viewer' || (lockedNodes.has(nodeId) && userRole === 'Contributor')) {
                ws.send(JSON.stringify({ type: 'error', message: 'Access Denied.' }));
                return;
            }
            globalSeq++;
            const event = { ...parsed, seq: globalSeq, author: userRole, authorData: parsed.authorData, timestamp: Date.now() };
            eventBuffer.push(event);
            if(eventBuffer.length > 5000) eventBuffer.shift();
            wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(event)); });
        }

        if (parsed.type === 'lock-node' && userRole === 'Lead') {
            lockedNodes.set(parsed.nodeId, 'Lead');
            wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'node-locked', nodeId: parsed.nodeId })); });
        }
    });

    ws.on('close', () => {
        if (ws.userId) {
            // Hum session foran delete nahi karenge (reconnect handling), 
            // balki 5 second wait karenge. Agar socket wapis nahi aaya toh delete.
            const uid = ws.userId;
            setTimeout(() => {
                let stillConnected = false;
                wss.clients.forEach(client => { if(client.userId === uid) stillConnected = true; });
                if (!stillConnected) {
                    activeSessions.delete(uid);
                    console.log(`[CLEANUP] Session ${uid} removed.`);
                }
            }, 5000);
        }
    });
});

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

server.listen(port, () => console.log(`Backend Live on ${port}`));