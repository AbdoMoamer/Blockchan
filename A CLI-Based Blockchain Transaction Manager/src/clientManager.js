const fs = require('fs');
const path = require('path');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const UserData = require('./userData');
const MinerManager = require('./minerManager');

class ClientManager {
  constructor() {
    this.userData = new UserData();
    this.minerManager = new MinerManager();
    this.clientsFile = path.join(__dirname, 'clients.json');
    this.clients = this.loadClients();
    
    // إضافة مراقب للملف للتحديث التلقائي
    this.setupFileWatcher();
  }

  setupFileWatcher() {
    fs.watch(this.clientsFile, (eventType, filename) => {
      if (eventType === 'change') {
        this.reloadClients();
      }
    });
  }

  reloadClients() {
    try {
      const data = fs.readFileSync(this.clientsFile, 'utf8');
      const newClients = JSON.parse(data).clients;
      
      // تحديث البيانات في الذاكرة
      this.clients = newClients;
      
      // إرسال إشعار بالتحديث
      console.log('💫 Client data updated automatically');
    } catch (error) {
      console.error('Error reloading clients:', error);
    }
  }

  loadClients() {
    try {
      if (fs.existsSync(this.clientsFile)) {
        const data = fs.readFileSync(this.clientsFile, 'utf8');
        return JSON.parse(data).clients;
      }
      return [];
    } catch (error) {
      console.error('Error loading clients:', error);
      return [];
    }
  }

  saveClients() {
    try {
      const data = JSON.stringify({ clients: this.clients }, null, 2);
      fs.writeFileSync(this.clientsFile, data);
      
      // تحديث البيانات في الذاكرة مباشرة
      this.reloadClients();
    } catch (error) {
      console.error('Error saving clients:', error);
    }
  }

  createClient(clientId) {
    const keyPair = ec.genKeyPair();
    const publicKey = keyPair.getPublic('hex');
    const privateKey = keyPair.getPrivate('hex');

    const client = {
      clientId,
      address: publicKey,
      privateKey: privateKey,
      balance: 0,
      pendingBalance: 0,
      transactions: [],
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      stats: {
        totalSent: 0,
        totalReceived: 0,
        totalMined: 0,
        blocksMined: 0,
        pendingTransactions: 0
      },
      assignedMiners: []
    };

    this.clients.push(client);
    this.saveClients();
    return client;
  }

  getClient(address) {
    return this.clients.find(client => client.address === address);
  }

  getAllClients() {
    return this.clients;
  }

  assignMinerToClient(clientAddress, minerId) {
    const client = this.getClient(clientAddress);
    if (client) {
      if (!client.assignedMiners.includes(minerId)) {
        client.assignedMiners.push(minerId);
        client.lastActive = new Date().toISOString();
        this.saveClients();
        return true;
      }
    }
    return false;
  }

  unassignMinerFromClient(clientAddress, minerId) {
    const client = this.getClient(clientAddress);
    if (client) {
      const index = client.assignedMiners.indexOf(minerId);
      if (index !== -1) {
        client.assignedMiners.splice(index, 1);
        client.lastActive = new Date().toISOString();
        this.saveClients();
        return true;
      }
    }
    return false;
  }

  getClientMiners(clientAddress) {
    const client = this.getClient(clientAddress);
    return client ? client.assignedMiners : [];
  }

  updateClientBalance(clientAddress, amount) {
    const client = this.getClient(clientAddress);
    if (client) {
      // تحديث الرصيد
      client.balance = amount;
      client.lastActive = new Date().toISOString();
      
      // تحديث العميل بالكامل
      return this.updateClient(client);
    }
    return false;
  }

  addClientTransaction(clientAddress, transaction) {
    const client = this.getClient(clientAddress);
    if (client) {
      if (!client.transactions) {
        client.transactions = [];
      }
      client.transactions.push(transaction);
      
      // Update statistics based on transaction type
      if (transaction.fromAddress === clientAddress) {
        // تحديث إحصائيات الإرسال
        client.stats.totalSent = (client.stats.totalSent || 0) + transaction.amount;
      } else if (transaction.toAddress === clientAddress) {
        if (transaction.fromAddress === null) {
          // معاملة تعدين
          client.stats.totalMined = (client.stats.totalMined || 0) + transaction.amount;
          client.stats.blocksMined = (client.stats.blocksMined || 0) + 1;
          client.balance += transaction.amount;
        } else {
          // معاملة استلام عادية
          client.stats.totalReceived = (client.stats.totalReceived || 0) + transaction.amount;
          client.balance += transaction.amount;
        }
      }

      client.lastActive = new Date().toISOString();
      
      // تحديث العميل بالكامل
      return this.updateClient(client);
    }
    return false;
  }

  getClientTransactions(clientAddress) {
    const client = this.getClient(clientAddress);
    return client ? client.transactions : [];
  }

  getClientStats(clientAddress) {
    const client = this.getClient(clientAddress);
    return client ? client.stats : null;
  }

  updateClientStats(address, stats) {
    const client = this.getClient(address);
    if (client) {
      client.stats = {
        ...client.stats,
        ...stats,
      };
      client.lastActive = new Date().toISOString();
      return this.updateClient(client);
    }
    return false;
  }

  deleteClient(clientAddress) {
    const index = this.clients.findIndex(client => client.address === clientAddress);
    if (index !== -1) {
      this.clients.splice(index, 1);
      this.saveClients();
      return true;
    }
    return false;
  }

  getActiveClients() {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    return this.clients.filter(client => client.lastActive > oneHourAgo);
  }

  getClientMiningStats(clientAddress) {
    const client = this.getClient(clientAddress);
    if (!client) return null;

    return {
      totalMiners: client.assignedMiners.length,
      totalMined: client.stats.totalMined,
      totalBlocks: client.stats.blocksMined,
      averageEfficiency: client.stats.blocksMined > 0 ? 
        (client.stats.totalMined / client.stats.blocksMined) : 0
    };
  }

  getSystemOverview() {
    const totalClients = this.clients.length;
    const activeClients = this.getActiveClients().length;
    const totalBalance = this.clients.reduce((sum, client) => sum + client.balance, 0);
    const totalTransactions = this.clients.reduce((sum, client) => sum + client.transactions.length, 0);
    const totalMiners = this.clients.reduce((sum, client) => sum + client.assignedMiners.length, 0);

    return {
      totalClients,
      activeClients,
      totalBalance,
      totalTransactions,
      totalMiners,
      averageBalance: totalClients > 0 ? totalBalance / totalClients : 0,
      averageTransactions: totalClients > 0 ? totalTransactions / totalClients : 0,
      averageMiners: totalClients > 0 ? totalMiners / totalClients : 0
    };
  }

  importUserAsClient(userData) {
    const client = {
      clientId: `client${this.clients.length + 1}`,
      address: userData.address,
      privateKey: userData.privateKey,
      balance: userData.balance,
      transactions: userData.transactions,
      createdAt: userData.createdAt,
      lastActive: userData.lastActive,
      stats: userData.stats,
      assignedMiners: []
    };

    this.clients.push(client);
    this.saveClients();
    return client;
  }

  migrateUsersToClients(users) {
    users.forEach(user => {
      if (!this.getClient(user.address)) {
        this.importUserAsClient(user);
      }
    });
    this.saveClients();
  }

  updateClient(client) {
    const index = this.clients.findIndex(c => c.address === client.address);
    if (index !== -1) {
      // تحديث البيانات مع الحفاظ على الهيكل الأساسي
      const updatedClient = {
        ...this.clients[index],
        ...client,
        stats: {
          ...this.clients[index].stats,
          ...client.stats
        },
        lastActive: new Date().toISOString()
      };

      // تحديث في المصفوفة
      this.clients[index] = updatedClient;

      // حفظ وتحديث الملف
      this.saveClients();

      return true;
    }
    return false;
  }
}

module.exports = ClientManager; 