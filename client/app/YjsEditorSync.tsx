"use client"

import { useEffect, useRef } from 'react'

export function YjsEditorSync({ editor, onNewLog, onNewTask, setRole, role, onCursorUpdate }: any) {
  const socketRef = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  const connectionInFlight = useRef(false); // To prevent double connections

  useEffect(() => {
    // 1. Double connection prevention (React Strict Mode fix)
    if (connectionInFlight.current) return;
    connectionInFlight.current = true;

    const rawUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000';
    
    // 2. ULTRA-CLEAN URL logic
    let cleanUrl = rawUrl.trim().split('?')[0].split('#')[0]; // Remove queries
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1); // Remove trailing slash
    
    const wsUrl = cleanUrl.replace(/^http/, "ws"); // Convert to ws/wss

    console.log("🚀 LIGMA Sync: Connecting to", wsUrl);
    
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
        console.log("✅ WebSocket established!");
        // Handshake protocol
        socket.send(JSON.stringify({ type: 'CLIENT_READY' }));
        socket.send(JSON.stringify({ type: 'SYNC_REQUEST', lastSeq: lastSeq.current }));
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // RBAC Error Revert
        if (message.type === 'error') {
            alert(message.message);
            editor.undo();
            return;
        }

        const messages = message.type === 'SYNC_REPLAY' ? message.events : [message];
        messages.forEach((msg: any) => {
          if (msg.seq > lastSeq.current || msg.seq === 0) {
            if (msg.seq > 0) lastSeq.current = msg.seq; 
            
            // ROLE ASSIGNMENT
            if (msg.type === 'init-role') {
                console.log("👤 Role Assigned:", msg.role);
                setRole(msg.role);
            }
            
            // Action Logging
            if (msg.author && msg.author !== role) {
                if (msg.type === 'update' && !editor.store.get(msg.data.id)) onNewLog(`${msg.author}: Created node`);
                if (msg.type === 'remove') onNewLog(`${msg.author}: Deleted node`);
            }

            // Sync States
            if (msg.type === 'update' && msg.data?.typeName === 'shape') {
              editor.store.mergeRemoteChanges(() => { editor.store.put([msg.data]); });
            }
            if (msg.type === 'remove') {
              editor.store.mergeRemoteChanges(() => { editor.store.remove([msg.data.id]); });
            }
          }
        });

        if (message.type === 'cursor') onCursorUpdate(message);
      } catch (e) { }
    };

    socket.onclose = () => {
        console.warn("🔌 Socket closed. Re-trying...");
        connectionInFlight.current = false;
    };

    // --- Local Editor Listeners ---
    const unlisten = editor.store.listen((event: any) => {
      if (event.source !== 'user') return;

      Object.entries(event.changes.added).forEach(([id, record]: any) => {
        if (record.typeName === 'shape') socketRef.current?.send(JSON.stringify({ type: 'update', data: record }));
      });

      Object.entries(event.changes.updated).forEach(([id, [from, to]]: any) => {
        if (to.typeName === 'shape') {
          socketRef.current?.send(JSON.stringify({ type: 'update', data: to }));
        }
      });

      Object.keys(event.changes.removed).forEach((id) => {
        socketRef.current?.send(JSON.stringify({ type: 'remove', data: { id } }));
      });
    }, { source: 'user', scope: 'document' });

    // Node Locking
    const handleLock = (e: any) => socketRef.current?.send(JSON.stringify({ type: 'lock-node', nodeId: e.detail.nodeId }));
    window.addEventListener('lock-node-request', handleLock);

    // Cleanup
    return () => { 
      unlisten();
      window.removeEventListener('lock-node-request', handleLock);
      socket.close();
      connectionInFlight.current = false;
    }
  }, [editor, setRole, role, onCursorUpdate, onNewLog]);

  return null;
}
