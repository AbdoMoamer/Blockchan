const net = require('net');

let peers = [];
let publicKeys = new Map();
const RECONNECT_INTERVAL = 5000; // 5 seconds
const CONNECTION_TIMEOUT = 10000; // 10 seconds
let server = null;

function createServer(port, onMessage, onConnect) {
  return new Promise((resolve, reject) => {
    if (server) {
      server.close();
    }

    server = net.createServer(socket => {
      // Set timeout for idle connections
      socket.setTimeout(CONNECTION_TIMEOUT);
      
      socket.on('timeout', () => {
        console.log('⚠️ Connection timeout, closing...');
        socket.end();
      });

      socket.on('data', data => {
        try {
          const message = JSON.parse(data.toString());
          // Reset timeout on data
          socket.setTimeout(CONNECTION_TIMEOUT);

          switch (message.type) {
            case "PUBKEY":
              publicKeys.set(socket.remotePort, message.key);
              socket.write(JSON.stringify({ type: "PUBKEY", key: onConnect() }));
              // Send full blockchain and transaction queue on connection
              socket.write(JSON.stringify({ 
                type: "SYNC", 
                blockchain: onConnect().blockchain, 
                transactionQueue: onConnect().transactionQueue 
              }));
              break;
            case "TX":
              // Add transaction to queue and broadcast to other peers
              onMessage(message, socket);
              broadcast("TX", message.data);
              break;
            case "BLOCK":
              // Handle new block and broadcast to other peers
              onMessage(message, socket);
              broadcast("BLOCK", message.data);
              break;
            case "SYNC":
              // Handle blockchain synchronization
              onMessage(message, socket);
              break;
            case "PEER_DISCOVERY":
              // Handle peer discovery requests
              const peerList = peers.map(p => ({
                port: p.remotePort,
                publicKey: publicKeys.get(p.remotePort)
              }));
              socket.write(JSON.stringify({ 
                type: "PEER_LIST", 
                peers: peerList 
              }));
              break;
            default:
              console.log("📩 Unknown message type:", message);
          }
        } catch (err) {
          console.log("⚠️ Message parsing error:", err.message);
        }
      });

      socket.on('error', err => {
        console.log("⚠️ Peer error:", err.message);
        removePeer(socket);
      });

      socket.on('close', () => {
        console.log("🔌 Connection closed");
        removePeer(socket);
      });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${port} is in use, trying port ${port + 1}`);
        server.close();
        createServer(port + 1, onMessage, onConnect)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      console.log(`🌐 Server running on port ${port}`);
      resolve(server);
    });
  });
}

function removePeer(socket) {
  const index = peers.indexOf(socket);
  if (index > -1) {
    peers.splice(index, 1);
    publicKeys.delete(socket.remotePort);
  }
}

function connectToPeer(ip, port, myKey, onMessage) {
  const socket = net.connect(port, ip, () => {
    socket.write(JSON.stringify({ type: "PUBKEY", key: myKey }));
    console.log(`🔗 Connected to ${ip}:${port}`);
    
    // Request peer discovery after connection
    socket.write(JSON.stringify({ type: "PEER_DISCOVERY" }));
  });

  socket.setTimeout(CONNECTION_TIMEOUT);

  socket.on('timeout', () => {
    console.log('⚠️ Connection timeout, attempting to reconnect...');
    socket.end();
    setTimeout(() => connectToPeer(ip, port, myKey, onMessage), RECONNECT_INTERVAL);
  });

  socket.on('data', data => {
    try {
      const message = JSON.parse(data.toString());
      socket.setTimeout(CONNECTION_TIMEOUT);

      if (message.type === "PUBKEY") {
        publicKeys.set(port, message.key);
        console.log("🔑 Received peer key:", message.key);
      } else if (message.type === "PEER_LIST") {
        // Connect to new peers discovered
        message.peers.forEach(peer => {
          if (!peers.some(p => p.remotePort === peer.port)) {
            connectToPeer(ip, peer.port, myKey, onMessage);
          }
        });
      } else {
        onMessage(message, socket);
      }
    } catch (err) {
      console.log("⚠️ Receive error:", err.message);
    }
  });

  socket.on('error', err => {
    console.log("❌ Peer connection failed:", err.message);
    removePeer(socket);
    setTimeout(() => connectToPeer(ip, port, myKey, onMessage), RECONNECT_INTERVAL);
  });

  socket.on('close', () => {
    console.log("🔌 Connection closed, attempting to reconnect...");
    removePeer(socket);
    setTimeout(() => connectToPeer(ip, port, myKey, onMessage), RECONNECT_INTERVAL);
  });

  peers.push(socket);
}

function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  console.log(`📢 Broadcasting ${type} to ${peers.length} peers`);
  
  const failedPeers = [];
  for (const peer of peers) {
    try {
      peer.write(message);
    } catch (err) {
      console.log("⚠️ Broadcast failed:", err.message);
      failedPeers.push(peer);
    }
  }

  // Remove failed peers
  failedPeers.forEach(peer => removePeer(peer));
}

module.exports = { createServer, connectToPeer, broadcast, publicKeys };
