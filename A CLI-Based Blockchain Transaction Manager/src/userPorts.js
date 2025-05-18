const fs = require('fs');
const path = require('path');
const EC = require('elliptic').ec;

const ec = new EC('secp256k1');

class UserPorts {
  constructor() {
    this.portsFile = path.join(__dirname, 'userPorts.json');
    this.users = this.loadUsers();
    this.usedPorts = new Set();
    this.initializeUsedPorts();
    this.validateAndCleanUsers();
  }

  loadUsers() {
    try {
      if (fs.existsSync(this.portsFile)) {
        const data = fs.readFileSync(this.portsFile, 'utf8');
        const users = JSON.parse(data);
        // Validate each user
        Object.keys(users).forEach(userName => {
          if (!users[userName].userName || !users[userName].port || !users[userName].publicKey) {
            delete users[userName];
          }
        });
        return users;
      }
    } catch (error) {
      console.log('❌ Error loading users:', error.message);
    }
    return {};
  }

  validateAndCleanUsers() {
    const validUsers = {};
    Object.entries(this.users).forEach(([userName, user]) => {
      if (user.userName && user.port && user.publicKey) {
        validUsers[userName] = {
          ...user,
          createdAt: user.createdAt || new Date().toISOString(),
          lastActive: user.lastActive || new Date().toISOString()
        };
      }
    });
    this.users = validUsers;
    this.saveUsers();
  }

  saveUsers() {
    try {
      const data = JSON.stringify(this.users, null, 2);
      fs.writeFileSync(this.portsFile, data);
    } catch (error) {
      console.log('❌ Error saving users:', error.message);
      throw new Error('Failed to save user data');
    }
  }

  initializeUsedPorts() {
    this.usedPorts.clear();
    Object.values(this.users).forEach(user => {
      if (user.port) {
        this.usedPorts.add(user.port);
      }
    });
  }

  findAvailablePort(startPort = 6001) {
    let port = startPort;
    while (this.usedPorts.has(port)) {
      port++;
    }
    return port;
  }

  addUser(userName, publicKey = null) {
    if (!userName) {
      throw new Error('Username is required');
    }

    if (this.users[userName]) {
      throw new Error('User already exists');
    }

    const port = this.findAvailablePort();
    this.usedPorts.add(port);

    // Generate new key pair if not provided
    if (!publicKey) {
      const key = ec.genKeyPair();
      publicKey = key.getPublic('hex');
    }

    this.users[userName] = {
      userName,
      port,
      publicKey,
      privateKey: null,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };

    this.saveUsers();
    return this.users[userName];
  }

  getUser(userName) {
    return this.users[userName];
  }

  getUserByPublicKey(publicKey) {
    return Object.values(this.users).find(user => user.publicKey === publicKey);
  }

  getAllUsers() {
    return Object.values(this.users).map(user => ({
      userName: user.userName,
      port: user.port,
      publicKey: user.publicKey,
      lastActive: user.lastActive || new Date().toISOString()
    }));
  }

  updateUserActivity(userName) {
    if (this.users[userName]) {
      this.users[userName].lastActive = new Date().toISOString();
      this.saveUsers();
    }
  }

  removeUser(userName) {
    if (this.users[userName]) {
      const port = this.users[userName].port;
      this.usedPorts.delete(port);
      delete this.users[userName];
      this.saveUsers();
      return true;
    }
    return false;
  }

  isPortInUse(port) {
    return this.usedPorts.has(port);
  }

  setUserPrivateKey(userName, privateKey) {
    if (this.users[userName]) {
      this.users[userName].privateKey = privateKey;
      this.saveUsers();
      return true;
    }
    return false;
  }
}

// Initialize with default users if none exist
const userPorts = new UserPorts();
if (Object.keys(userPorts.users).length === 0) {
  const defaultUsers = [
    { name: 'node1', port: 6001 },
    { name: 'node2', port: 6002 },
    { name: 'node3', port: 6003 },
    { name: 'node4', port: 6004 }
  ];

  defaultUsers.forEach(user => {
    try {
      const key = ec.genKeyPair();
      const publicKey = key.getPublic('hex');
      userPorts.addUser(user.name, publicKey);
    } catch (error) {
      console.log(`❌ Error adding default user ${user.name}:`, error.message);
    }
  });
}

module.exports = userPorts; 