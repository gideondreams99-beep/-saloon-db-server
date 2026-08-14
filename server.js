import { WebSocketServer } from 'ws';
import { MiniFirestoreEngine } from './MiniFirestoreEngine.js';

const db = new MiniFirestoreEngine();
const port = process.env.PORT || 3000;
const wss = new WebSocketServer({ port });

const clientSubscriptions = new Map();

console.log(`⚡ Custom Firestore Database Server running on port ${port}`);

wss.on('connection', (ws) => {
  clientSubscriptions.set(ws, []);

  ws.on('message', (message) => {
    try {
      const payload = JSON.parse(message);
      const { apiKey, action, subId, collection, docId, data, options, filters, reqId } = payload;

      const auth = db.validateApiKey(apiKey);
      if (!auth.valid) {
        return ws.send(JSON.stringify({ action: 'ERROR', error: auth.reason }));
      }

      const clientInfo = auth.clientInfo;

      if (action === 'DOC_SET') {
        db.setDoc(collection, docId, data, options, clientInfo);
        ws.send(JSON.stringify({ action: 'SET_SUCCESS', docId, reqId }));
        broadcastUpdates(collection);
      }
      else if (action === 'DOC_DELETE') {
        db.deleteDoc(collection, docId, clientInfo);
        ws.send(JSON.stringify({ action: 'DELETE_SUCCESS', docId, reqId }));
        broadcastUpdates(collection);
      }
      else if (action === 'QUERY_GET') {
        const results = db.queryDocs(collection, filters || [], clientInfo);
        ws.send(JSON.stringify({ action: 'GET_RESPONSE', reqId, results }));
      }
      else if (action === 'SUBSCRIBE') {
        const subs = clientSubscriptions.get(ws) || [];
        subs.push({ subId, collection, filters, clientInfo });
        clientSubscriptions.set(ws, subs);

        sendSnapshot(ws, subId, collection, filters, clientInfo);
      }
      else if (action === 'UNSUBSCRIBE') {
        let subs = clientSubscriptions.get(ws) || [];
        subs = subs.filter(s => s.subId !== subId);
        clientSubscriptions.set(ws, subs);
      }

    } catch (err) {
      ws.send(JSON.stringify({ action: 'ERROR', error: err.message }));
    }
  });

  ws.on('close', () => {
    clientSubscriptions.delete(ws);
  });
});

function broadcastUpdates(changedCollection) {
  for (let [ws, subs] of clientSubscriptions.entries()) {
    for (let sub of subs) {
      if (sub.collection === changedCollection) {
        sendSnapshot(ws, sub.subId, sub.collection, sub.filters, sub.clientInfo);
      }
    }
  }
}

function sendSnapshot(ws, subId, collection, filters, clientInfo) {
  try {
    const results = db.queryDocs(collection, filters || [], clientInfo);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        action: 'SNAPSHOT_UPDATE',
        subId: subId,
        docs: results
      }));
    }
  } catch (err) {
    ws.send(JSON.stringify({ action: 'ERROR', error: err.message }));
  }
}
