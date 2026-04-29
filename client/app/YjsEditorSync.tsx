"use client"
import { useEffect, useRef } from 'react'

export function YjsEditorSync({ editor, onNewLog, setRole, role, onCursorUpdate }: any) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const lastSeq = useRef(0);
  const isConnecting = useRef(false);

  useEffect(() => {
    if (isConnecting.current) return; // Double connection prevention
    isConnecting.current = true;

    const rawUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000';
    let cleanUrl = rawUrl.trim().replace(/\/+$/, ""); 
    const wsUrl = cleanUrl.replace(/^http/, "ws");

    const connect = () => {
        console.log("🔄 LIGMA Sync: Connecting to", wsUrl);
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;

        socket.onopen = () => {
            console.log("✅ WebSocket established!");
            reconnectCount.current = 0;
            socket.send(JSON.stringify({ type: 'CLIENT_READY' }));
            socket.send(JSON.stringify({ type: 'SYNC_REQUEST', lastSeq: lastSeq.current }));
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                
                // RBAC Revert
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
                        if (msg.type === 'init-role') setRole(msg.role);
                        
                        // ACTION LOGGING
                        if (msg.author && msg.author !== role) {
                            if (msg.type === 'update' && !editor.store.get(msg.data.id)) onNewLog(`${msg.author}: Created node`);
                            if (msg.type === 'remove') onNewLog(`${msg.author}: Deleted node`);
                        }

                        // STATE SYNC
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
            console.warn("🔌 Socket lost. Reconnecting...");
            const timeout = Math.min(1000 * Math.pow(2, reconnectCount.current), 10000);
            reconnectCount.current++;
            setTimeout(connect, timeout);
        };
    };

    connect();

    // Editor Listeners
    const unlisten = editor.store.listen((event: any) => {
      if (event.source !== 'user') return;
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;

      Object.values(event.changes.added).forEach((record: any) => {
        if (record.typeName === 'shape') socketRef.current?.send(JSON.stringify({ type: 'update', data: record }));
      });
      Object.values(event.changes.updated).forEach(([from, to]: any) => {
        if (to.typeName === 'shape') socketRef.current?.send(JSON.stringify({ type: 'update', data: to }));
      });
      Object.keys(event.changes.removed).forEach((id) => {
        socketRef.current?.send(JSON.stringify({ type: 'remove', data: { id } }));
      });
    }, { source: 'user', scope: 'document' });

    const handleLock = (e: any) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'lock-node', nodeId: e.detail.nodeId }));
        }
    };
    window.addEventListener('lock-node-request', handleLock);

    return () => { 
      unlisten(); 
      if (socketRef.current) {
        socketRef.current.onclose = null; // Prevent loop on unmount
        socketRef.current.close();
      }
      isConnecting.current = false;
      window.removeEventListener('lock-node-request', handleLock);
    }
  }, [editor, setRole, role, onCursorUpdate, onNewLog]);

  return null;
}
