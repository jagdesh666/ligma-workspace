"use client"

import { useEffect, useRef } from 'react'
import { Editor } from 'tldraw'

export function YjsEditorSync({ editor, onNewLog, setRole, role, onCursorUpdate }: any) {
  const socketRef = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);

  useEffect(() => {
    const rawUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';
    const wsUrl = rawUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
        console.log("Connected! Sending CLIENT_READY...");
        // Yeh line server ko role assign karne par majboor karegi
        socket.send(JSON.stringify({ type: 'CLIENT_READY' }));
        socket.send(JSON.stringify({ type: 'SYNC_REQUEST', lastSeq: lastSeq.current }));
    };

socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // RBAC ERROR HANDLING
        if (message.type === 'error') {
            alert(message.message);
            editor.undo();
            return;
        }

        const messages = message.type === 'SYNC_REPLAY' ? message.events : [message];
        messages.forEach((msg: any) => {
          if (msg.seq > lastSeq.current || msg.seq === 0) {
            if (msg.seq > 0) lastSeq.current = msg.seq; 
            if (msg.type === 'init-role') setRole(msg.role);
            
            // --- PHASE 9: EVENT LOGGING (Who did what) ---
            // Jab dusre users kuch karenge, toh unka role aur action log hoga
            if (msg.author && msg.author !== role) {
                if (msg.type === 'update') onNewLog(`${msg.author}: Modified a node`);
                if (msg.type === 'remove') onNewLog(`${msg.author}: Deleted a node`);
            }
            
            // Lock events ko specifically log karein
            if (msg.type === 'node-locked') {
                onNewLog(`System: Node locked by Lead`);
            }

            // Syncing Canvas State
            if (msg.type === 'update' && msg.data?.typeName === 'shape') {
              editor.store.mergeRemoteChanges(() => { editor.store.put([msg.data]); });
            }
            if (msg.type === 'remove') {
              editor.store.mergeRemoteChanges(() => { editor.store.remove([msg.data.id]); });
            }
          }
        });

        // Cursor Sync
        if (message.type === 'cursor') onCursorUpdate(message);
      } catch (e) { 
        console.warn("Sync error:", e);
      }
    };

    const unlisten = editor.store.listen((event: any) => {
      if (event.source !== 'user') return;
      
      // SAFETY CHECK: Sirf tab bhejo agar socket OPEN ho
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;

      // Sync Adds and Updates
      Object.values(event.changes.added).forEach((record: any) => {
        if (record.typeName === 'shape') {
            socketRef.current?.send(JSON.stringify({ type: 'update', data: record }));
        }
      });
      Object.values(event.changes.updated).forEach(([from, to]: any) => {
        if (to.typeName === 'shape') {
            socketRef.current?.send(JSON.stringify({ type: 'update', data: to }));
        }
      });
      // Sync Deletions
      Object.keys(event.changes.removed).forEach((id) => {
        socketRef.current?.send(JSON.stringify({ type: 'remove', data: { id } }));
      });
    });

    const handlePointerMove = () => {
      // SAFETY CHECK: Cursor sync ke liye bhi socket check karein
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const { x, y } = editor.inputs.currentPagePoint;
        socketRef.current.send(JSON.stringify({ type: 'cursor', x, y, userId: `user-${role}` }));
      }
    };
    window.addEventListener('pointermove', handlePointerMove);

    const handleLock = (e: any) => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'lock-node', nodeId: e.detail.nodeId }));
        }
    };
    window.addEventListener('lock-node-request', handleLock);

    return () => { 
        unlisten(); 
        socket.close(); 
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('lock-node-request', handleLock);
    }
  }, [editor, role, setRole, onCursorUpdate]);

  return null;
}