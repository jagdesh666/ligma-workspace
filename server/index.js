// server/index.js - replace wss.on('connection') part
wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    console.log('--- Client Connected ---');

    ws.on('message', (message) => {
        let parsed;
        try { parsed = JSON.parse(message); } catch (e) { return; }

        if (parsed.type === 'CLIENT_READY') {
            // Logic: Pehle check karo ke lead slots khali hain ya nahi
            const currentRoles = Array.from(userRoles.values());
            let role = 'Viewer';

            if (!currentRoles.includes('Lead')) {
                role = 'Lead';
            } else if (!currentRoles.includes('Contributor')) {
                role = 'Contributor';
            }

            userRoles.set(ws, role);
            ws.send(JSON.stringify({ type: 'init-role', role: role, seq: 0 }));
            console.log(`[HANDSHAKE] Assigned: ${role}`);
            return;
        }

        const userRole = userRoles.get(ws);
        // ... (Baaki code: update, remove, lock, sync_request wahi rakhein)
        // ... COPY PASTE YOUR EXISTING MESSAGE LOGIC HERE ...
    });

    ws.on('close', () => {
        const leavingRole = userRoles.get(ws);
        userRoles.delete(ws);
        console.log(`[EXIT] ${leavingRole} left. Cleaning up...`);
        
        // --- BOOSTER: Force cleanup check to allow immediate re-promotion ---
        if (leavingRole === 'Lead' || leavingRole === 'Contributor') {
            console.log("High-priority role slot freed.");
        }
    });
});
