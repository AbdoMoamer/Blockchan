const fs = require('fs');
const path = require('path');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

class MinerManager {
  constructor() {
    this.minersFile = path.join(__dirname, 'miners.json');
    this.miners = this.loadMiners();
    
    // إضافة مراقب للملف للتحديث التلقائي
    this.setupFileWatcher();
  }

  setupFileWatcher() {
    fs.watch(this.minersFile, (eventType, filename) => {
      if (eventType === 'change') {
        this.reloadMiners();
      }
    });
  }

  reloadMiners() {
    try {
      const data = fs.readFileSync(this.minersFile, 'utf8');
      const newMiners = JSON.parse(data).miners;
      
      // تحديث البيانات في الذاكرة
      this.miners = newMiners;
      
      // إرسال إشعار بالتحديث
      console.log('⛏️ Miner data updated automatically');
    } catch (error) {
      console.error('Error reloading miners:', error);
    }
  }

  loadMiners() {
    try {
      if (fs.existsSync(this.minersFile)) {
        const data = fs.readFileSync(this.minersFile, 'utf8');
        return JSON.parse(data).miners;
      }
      return [];
    } catch (error) {
      console.error('Error loading miners:', error);
      return [];
    }
  }

  saveMiners() {
    try {
      const data = JSON.stringify({ miners: this.miners }, null, 2);
      fs.writeFileSync(this.minersFile, data);
      
      // تحديث البيانات في الذاكرة مباشرة
      this.reloadMiners();
    } catch (error) {
      console.error('Error saving miners:', error);
    }
  }

  createMiner(minerId) {
    const keyPair = ec.genKeyPair();
    const publicKey = keyPair.getPublic('hex');
    const privateKey = keyPair.getPrivate('hex');

    const miner = {
      id: minerId,
      address: publicKey,
      privateKey: privateKey,
      clientAddress: null,
      status: 'available',
      balance: 0,
      stats: {
        totalMined: 0,
        blocksMined: 0,
        lastMinedBlock: null,
        efficiency: 100,
        uptime: 0
      },
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };

    this.miners.push(miner);
    this.saveMiners();
    return miner;
  }

  getMiner(minerId) {
    return this.miners.find(miner => miner.id === minerId);
  }

  getMinerByAddress(address) {
    return this.miners.find(miner => miner.address === address);
  }

  updateMinerStats(minerId, stats, miningReward = 0) {
    const miner = this.getMiner(minerId);
    if (miner) {
      // تحديث الإحصائيات
      miner.stats = {
        ...miner.stats,
        ...stats,
        lastMinedBlock: new Date().toISOString()
      };

      // تحديث إجمالي المعدن دائماً، بغض النظر عن حالة الارتباط
      miner.stats.totalMined = (miner.stats.totalMined || 0) + miningReward;
      
      // إذا كان المعدن غير مرتبط بعميل، أضف المكافأة إلى رصيده
      if (!miner.clientAddress && miningReward > 0) {
        miner.balance = (miner.balance || 0) + miningReward;
      }

      miner.lastActive = new Date().toISOString();
      this.saveMiners();
      return true;
    }
    return false;
  }

  assignClientToMiner(minerId, clientAddress) {
    const miner = this.getMiner(minerId);
    if (miner) {
      miner.clientAddress = clientAddress;
      miner.status = 'assigned';
      miner.lastActive = new Date().toISOString();
      this.saveMiners();
      return true;
    }
    return false;
  }

  unassignMiner(minerId) {
    const miner = this.getMiner(minerId);
    if (miner) {
      // Reset miner's client association
      miner.clientAddress = null;
      miner.status = 'available';
      miner.lastActive = new Date().toISOString();
      
      // Save changes
      this.saveMiners();
      return true;
    }
    return false;
  }

  getAvailableMiners() {
    return this.miners.filter(miner => miner.status === 'available');
  }

  getAssignedMiners() {
    return this.miners.filter(miner => miner.status === 'assigned');
  }

  getMinersByClient(clientAddress) {
    return this.miners.filter(miner => miner.clientAddress === clientAddress);
  }

  deleteMiner(minerId) {
    const index = this.miners.findIndex(miner => miner.id === minerId);
    if (index !== -1) {
      this.miners.splice(index, 1);
      this.saveMiners();
      return true;
    }
    return false;
  }

  getActiveMiners() {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    return this.miners.filter(miner => miner.lastActive > oneHourAgo);
  }

  getMinerStats(minerId) {
    const miner = this.getMiner(minerId);
    if (!miner) return null;

    return {
      totalMined: miner.stats.totalMined || 0,
      blocksMined: miner.stats.blocksMined || 0,
      lastMinedBlock: miner.stats.lastMinedBlock,
      efficiency: miner.stats.efficiency || 100,
      uptime: miner.stats.uptime || 0,
      balance: miner.balance || 0
    };
  }

  updateMinerBalance(minerId, amount) {
    const miner = this.getMiner(minerId);
    if (miner) {
      miner.balance = (miner.balance || 0) + amount;
      miner.lastActive = new Date().toISOString();
      this.saveMiners();
      return true;
    }
    return false;
  }
}

module.exports = MinerManager; 