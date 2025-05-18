const fs = require('fs');
const path = require('path');

class UserData {
  constructor() {
    this.usersFile = path.join(__dirname, 'users.json');
    this.users = this.loadUsers();
  }

  loadUsers() {
    try {
      if (fs.existsSync(this.usersFile)) {
        const data = fs.readFileSync(this.usersFile, 'utf8');
        return JSON.parse(data).users;
      }
      return [];
    } catch (error) {
      console.error('Error loading users:', error);
      return [];
    }
  }

  saveUsers() {
    try {
      fs.writeFileSync(this.usersFile, JSON.stringify({ users: this.users }, null, 2));
    } catch (error) {
      console.error('Error saving users:', error);
    }
  }

  createUser(address, type = 'client') {
    const user = {
      address,
      type,
      balance: 0,
      transactions: [],
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      stats: {
        totalSent: 0,
        totalReceived: 0,
        totalMined: 0,
        blocksMined: 0
      }
    };

    this.users.push(user);
    this.saveUsers();
    return user;
  }

  getUser(address) {
    return this.users.find(user => user.address === address);
  }

  getAllUsers() {
    return this.users;
  }

  getClients() {
    return this.users.filter(user => user.type === 'client');
  }

  updateBalance(address, amount) {
    const user = this.getUser(address);
    if (user) {
      user.balance += amount;
      user.lastActive = new Date().toISOString();
      
      if (amount > 0) {
        user.stats.totalReceived += amount;
      } else {
        user.stats.totalSent += Math.abs(amount);
      }
      
      this.saveUsers();
      return true;
    }
    return false;
  }

  addTransaction(address, transaction) {
    const user = this.getUser(address);
    if (user) {
      user.transactions.push(transaction);
      user.lastActive = new Date().toISOString();
      this.saveUsers();
      return true;
    }
    return false;
  }

  updateUserStats(address, stats) {
    const user = this.getUser(address);
    if (user) {
      user.stats = { ...user.stats, ...stats };
      user.lastActive = new Date().toISOString();
      this.saveUsers();
      return true;
    }
    return false;
  }

  deleteUser(address) {
    const index = this.users.findIndex(user => user.address === address);
    if (index !== -1) {
      this.users.splice(index, 1);
      this.saveUsers();
      return true;
    }
    return false;
  }

  getBalance(address) {
    const user = this.getUser(address);
    return user ? user.balance : 0;
  }

  getUserTransactions(address) {
    const user = this.getUser(address);
    return user ? user.transactions : [];
  }

  getUserStats(address) {
    const user = this.getUser(address);
    return user ? user.stats : null;
  }

  getSystemStats() {
    const stats = {
      totalUsers: this.users.length,
      totalClients: this.users.filter(u => u.type === 'client').length,
      totalTransactions: this.users.reduce((acc, user) => acc + user.transactions.length, 0),
      totalBalance: this.users.reduce((acc, user) => acc + user.balance, 0),
      activeUsers: this.users.filter(u => {
        const lastActive = new Date(u.lastActive);
        const now = new Date();
        return now - lastActive < 24 * 60 * 60 * 1000; // Active in last 24 hours
      }).length
    };
    return stats;
  }
}

module.exports = UserData; 