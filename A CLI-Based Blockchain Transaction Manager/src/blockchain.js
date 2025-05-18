const crypto = require('crypto');
const Transaction = require('./transaction');
const UserData = require('./userData');
const MinerManager = require('./minerManager');
const ClientManager = require('./clientManager');

class Block {
  constructor(timestamp, transactions, previousHash = '') {
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.hash = this.calculateHash();
    this.nonce = 0;
  }

  calculateHash() {
    return crypto.createHash('sha256')
      .update(this.previousHash + this.timestamp + JSON.stringify(this.transactions) + this.nonce)
      .digest('hex');
  }

  mineBlock(difficulty) {
    while (this.hash.substring(0, difficulty) !== Array(difficulty + 1).join('0')) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
    console.log(`🧱 Block mined: ${this.hash}`);
  }

  hasValidTransactions() {
    return this.transactions.every(tx => {
      try {
        const txObj = typeof tx === 'object' && !(tx instanceof Transaction) ? Transaction.fromJSON(tx) : tx;
        return txObj.isValid();
      } catch (err) {
        console.log(`❌ Invalid transaction: ${err.message}`);
        return false;
      }
    });
  }
}

class Blockchain {
  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.difficulty = 2;
    this.pendingTransactions = [];
    this.miningReward = 100;
    this.userData = new UserData();
    this.minerManager = new MinerManager();
    this.minerStats = new Map();
    this.transactionStats = new Map();
    this.blockStats = new Map();
    this.userActivity = new Map();
    this.clientManager = new ClientManager();
  }

  createGenesisBlock() {
    return new Block(Date.parse('2024-01-01'), [], '0');
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  minePendingTransactions(minerId) {
    // Get miner information
    const miners = this.minerManager.loadMiners();
    const miner = miners.find(m => m.id === minerId);
    if (!miner) {
      throw new Error('Miner not found');
    }

    // Check if there are pending transactions
    if (this.pendingTransactions.length === 0) {
      console.log('No pending transactions to mine, only mining reward will be included');
    }

    let rewardAddress;
    let client = null;

    // Determine who gets the reward
    if (miner.clientAddress) {
      // If miner is assigned to a client, reward goes to client
      client = this.clientManager.getClient(miner.clientAddress);
      if (!client) {
        throw new Error('Associated client not found');
      }
      rewardAddress = client.address;
      console.log(`Mining as client: ${client.clientId} (${client.address})`);
    } else {
      // If miner is not assigned, reward goes to miner
      rewardAddress = miner.address;
      console.log(`Mining as independent miner: ${miner.id}`);
    }

    // Sort pending transactions by timestamp (oldest first)
    const sortedTransactions = [...this.pendingTransactions].sort((a, b) => {
      const txA = typeof a === 'object' && !(a instanceof Transaction) ? Transaction.fromJSON(a) : a;
      const txB = typeof b === 'object' && !(b instanceof Transaction) ? Transaction.fromJSON(b) : b;
      return txA.timestamp - txB.timestamp;
    });

    // Take up to 10 transactions for this block
    const MAX_TRANSACTIONS_PER_BLOCK = 10;
    const transactionsForBlock = sortedTransactions.slice(0, MAX_TRANSACTIONS_PER_BLOCK);
    
    console.log(`Processing ${transactionsForBlock.length} out of ${this.pendingTransactions.length} pending transactions`);

    // Create and mine the block
    const block = new Block(Date.now(), transactionsForBlock, this.getLatestBlock().hash);
    block.mineBlock(this.difficulty);
    console.log('Block mined successfully!');
    
    // Add the block to the chain
    this.chain.push(block);

    // Process all transactions in the block and update balances
    for (const tx of block.transactions) {
      const txObj = typeof tx === 'object' && !(tx instanceof Transaction) ? Transaction.fromJSON(tx) : tx;
      
      if (txObj.fromAddress) { // Regular transaction
        const sender = this.clientManager.getClient(txObj.fromAddress);
        const recipient = this.clientManager.getClient(txObj.toAddress);

        if (sender) {
          // Update sender's balance and stats
          sender.balance = Math.max(0, sender.balance - txObj.amount);
          sender.stats.totalSent = (sender.stats.totalSent || 0) + txObj.amount;
          sender.stats.pendingTransactions = Math.max(0, (sender.stats.pendingTransactions || 0) - 1);
          this.clientManager.updateClient(sender);
        }

        if (recipient) {
          // Update recipient's balance and stats
          recipient.balance = (recipient.balance || 0) + txObj.amount;
          recipient.stats.totalReceived = (recipient.stats.totalReceived || 0) + txObj.amount;
          recipient.lastActive = new Date().toISOString();
          this.clientManager.updateClient(recipient);
        }
      }
    }

    // Create mining reward transaction
    const rewardTx = new Transaction(null, rewardAddress, this.miningReward);

    // Update statistics based on who received the reward
    if (client) {
      // If reward went to client
      client.balance = (client.balance || 0) + this.miningReward;
      client.stats.totalMined = (client.stats.totalMined || 0) + this.miningReward;
      client.stats.blocksMined = (client.stats.blocksMined || 0) + 1;
      client.lastActive = new Date().toISOString();
      this.clientManager.updateClient(client);
      console.log(`\n💰 Mining reward (${this.miningReward} coins) sent to client: ${client.clientId}`);
    } else {
      // If reward went to miner directly
      const minerStats = {
        totalMined: (miner.stats.totalMined || 0) + this.miningReward,
        blocksMined: (miner.stats.blocksMined || 0) + 1
      };
      
      // تحديث إحصائيات وأرصدة المعدن
      this.minerManager.updateMinerStats(miner.id, minerStats, this.miningReward);
      console.log(`\n💰 Mining reward (${this.miningReward} coins) sent to miner: ${miner.id}`);
    }

    // Remove processed transactions from pending list
    this.pendingTransactions = sortedTransactions.slice(MAX_TRANSACTIONS_PER_BLOCK);

    // Save all changes
    this.clientManager.saveClients();
    this.minerManager.saveMiners();

    return block;
  }

  addTransaction(transaction) {
    if (!transaction.fromAddress || !transaction.toAddress) {
      throw new Error('Transaction must include from and to address');
    }

    if (!transaction.isValid()) {
      throw new Error('Cannot add invalid transaction to chain');
    }

    if (transaction.amount <= 0) {
      throw new Error('Transaction amount should be higher than 0');
    }

    // Get sender and recipient clients
    const sender = this.clientManager.getClient(transaction.fromAddress);
    const recipient = this.clientManager.getClient(transaction.toAddress);

    if (!sender) {
      throw new Error('Sender client not found');
    }

    if (!recipient) {
      throw new Error('Recipient client not found');
    }

    // Check balance
    if (sender.balance < transaction.amount) {
      throw new Error('Not enough balance');
    }

    // Check pending transactions
    const pendingAmount = this.pendingTransactions
      .filter(tx => {
        const txObj = typeof tx === 'object' && !(tx instanceof Transaction) ? Transaction.fromJSON(tx) : tx;
        return txObj.fromAddress === transaction.fromAddress;
      })
      .reduce((total, tx) => {
        const txObj = typeof tx === 'object' && !(tx instanceof Transaction) ? Transaction.fromJSON(tx) : tx;
        return total + txObj.amount;
      }, 0);

    if (sender.balance < pendingAmount + transaction.amount) {
      throw new Error('Pending transactions for this address are higher than balance');
    }

    // خصم المبلغ مباشرة من رصيد المرسل
    const newSenderBalance = sender.balance - transaction.amount;
    sender.balance = newSenderBalance;
    
    // تحديث إحصائيات المعاملات المعلقة
    sender.stats.pendingTransactions = (sender.stats.pendingTransactions || 0) + 1;
    sender.lastActive = new Date().toISOString();
    
    // حفظ التغييرات للمرسل
    this.clientManager.updateClient(sender);

    // Add transaction to pending
    this.pendingTransactions.push(transaction);

    console.log('Transaction added to pending:', transaction);
    console.log(`Balance updated - New balance for ${sender.clientId}: ${sender.balance}`);

    return transaction;
  }

  getBalanceOfAddress(address) {
    const balance = this.userData.getBalance(address);
    
    // تحديث رصيد العميل
    const client = this.clientManager.getClient(address);
    if (client) {
      this.clientManager.updateClientBalance(address, balance);
    }

    return balance;
  }

  getAllTransactionsForAddress(address) {
    const transactions = [];

    for (const block of this.chain) {
      for (const transaction of block.transactions) {
        if (transaction.fromAddress === address || transaction.toAddress === address) {
          transactions.push(transaction);
        }
      }
    }

    return transactions;
  }

  isChainValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      if (!currentBlock.hasValidTransactions()) {
        return false;
      }

      if (currentBlock.hash !== currentBlock.calculateHash()) {
        return false;
      }

      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }
    }
    return true;
  }

  getBlockByHash(hash) {
    return this.chain.find(block => block.hash === hash);
  }

  getBlockByIndex(index) {
    return index >= 0 && index < this.chain.length ? this.chain[index] : null;
  }

  getPendingTransactions() {
    return this.pendingTransactions;
  }

  getChainLength() {
    return this.chain.length;
  }

  getDifficulty() {
    return this.difficulty;
  }

  setDifficulty(difficulty) {
    this.difficulty = difficulty;
  }

  getMiningReward() {
    return this.miningReward;
  }

  setMiningReward(reward) {
    this.miningReward = reward;
  }

  printBlockInfo(block, minerAddress) {
    console.log('\n🔷 ====== Block Information ====== 🔷');
    console.log(`📦 Block Hash: ${block.hash}`);
    console.log(`⏰ Timestamp: ${new Date(block.timestamp).toLocaleString()}`);
    console.log(`🔗 Previous Hash: ${block.previousHash}`);
    console.log(`💎 Miner: ${minerAddress}`);
    console.log(`⚡ Difficulty: ${this.difficulty}`);
    console.log(`🔢 Nonce: ${block.nonce}`);
    
    console.log('\n📊 Transactions in Block:');
    block.transactions.forEach((tx, index) => {
      console.log(`\n  Transaction #${index + 1}:`);
      if (tx.fromAddress === null) {
        console.log(`  💰 Mining Reward: ${tx.amount} to ${tx.toAddress}`);
      } else {
        console.log(`  💸 From: ${tx.fromAddress}`);
        console.log(`  📥 To: ${tx.toAddress}`);
        console.log(`  💵 Amount: ${tx.amount}`);
      }
    });

    console.log('\n📈 Network Status:');
    console.log(`  Total Blocks: ${this.chain.length}`);
    console.log(`  Pending Transactions: ${this.pendingTransactions.length}`);
    console.log('🔷 ================================ 🔷\n');
  }

  printTransactionInfo(tx) {
    console.log('\n🔷 ====== Transaction Information ====== 🔷');
    if (tx.fromAddress === null) {
      console.log('💰 Mining Reward Transaction');
      console.log(`📥 To: ${tx.toAddress}`);
      console.log(`💵 Amount: ${tx.amount}`);
    } else {
      console.log('💸 Regular Transaction');
      console.log(`📤 From: ${tx.fromAddress}`);
      console.log(`📥 To: ${tx.toAddress}`);
      console.log(`💵 Amount: ${tx.amount}`);
      console.log(`⏰ Timestamp: ${new Date(tx.timestamp).toLocaleString()}`);
    }
    console.log('🔷 ====================================== 🔷\n');
  }

  printUserInfo(address) {
    const userData = this.userData.getUserData(address);
    if (!userData) {
      console.log(`\n❌ No data found for address: ${address}`);
      return;
    }

    console.log('\n🔷 ====== User Information ====== 🔷');
    console.log(`👤 Address: ${address}`);
    console.log(`💰 Balance: ${userData.balance}`);
    console.log(`📊 Total Transactions: ${userData.transactions.length}`);
    
    if (this.minerStats.has(address)) {
      const minerStats = this.getMinerStats(address);
      console.log('\n⛏️ Mining Statistics:');
      console.log(`  Total Blocks Mined: ${minerStats.totalBlocks}`);
      console.log(`  Total Mining Rewards: ${minerStats.totalRewards}`);
    }

    console.log('\n📜 Recent Transactions:');
    const recentTxs = userData.transactions.slice(-5).reverse();
    recentTxs.forEach((tx, index) => {
      console.log(`\n  Transaction #${index + 1}:`);
      if (tx.fromAddress === null) {
        console.log(`  💰 Mining Reward: ${tx.amount}`);
      } else {
        console.log(`  💸 ${tx.fromAddress === address ? 'Sent' : 'Received'}: ${tx.amount}`);
        console.log(`  📥 To: ${tx.toAddress}`);
      }
      console.log(`  ⏰ Time: ${new Date(tx.timestamp).toLocaleString()}`);
    });
    console.log('🔷 ================================ 🔷\n');
  }

  getMinerStats(minerAddress) {
    return {
      totalBlocks: this.minerStats.get(minerAddress) || 0,
      totalRewards: this.chain.reduce((sum, block) => {
        const minerReward = block.transactions.find(tx => 
          tx.toAddress === minerAddress && tx.fromAddress === null
        );
        return sum + (minerReward ? minerReward.amount : 0);
      }, 0)
    };
  }

  getBlockchainStats() {
    return {
      totalBlocks: this.chain.length,
      totalTransactions: this.chain.reduce((acc, block) => acc + block.transactions.length, 0),
      pendingTransactions: this.pendingTransactions.length,
      miningDifficulty: this.difficulty,
      miningReward: this.miningReward,
      averageBlockTime: this.calculateAverageBlockTime(),
      topMiners: this.getTopMiners(5),
      transactionVolume: this.calculateTransactionVolume()
    };
  }

  calculateAverageBlockTime() {
    if (this.chain.length < 2) return 0;
    const times = [];
    for (let i = 1; i < this.chain.length; i++) {
      times.push(this.chain[i].timestamp - this.chain[i-1].timestamp);
    }
    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  getTopMiners(limit = 5) {
    const minerStats = new Map();
    this.chain.forEach(block => {
      const rewardTx = block.transactions.find(tx => tx.fromAddress === null);
      if (rewardTx) {
        const count = minerStats.get(rewardTx.toAddress) || 0;
        minerStats.set(rewardTx.toAddress, count + 1);
      }
    });
    return [...minerStats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([address, blocks]) => ({ address, blocks }));
  }

  calculateTransactionVolume() {
    return this.chain.reduce((volume, block) => {
      return volume + block.transactions.reduce((blockVolume, tx) => {
        return blockVolume + (tx.amount || 0);
      }, 0);
    }, 0);
  }

  getTransactionByHash(hash) {
    // Search in all blocks
    for (const block of this.chain) {
      if (block.transactions) {
        for (const tx of block.transactions) {
          let txObj;
          if (typeof tx === 'object' && !(tx instanceof Transaction)) {
            txObj = Transaction.fromJSON(tx);
          } else {
            txObj = tx;
          }
          const txHash = txObj.calculateHash();
          if (txHash === hash) {
            return txObj;
          }
        }
      }
    }
    
    // Search in pending transactions
    for (const tx of this.pendingTransactions) {
      let txObj;
      if (typeof tx === 'object' && !(tx instanceof Transaction)) {
        txObj = Transaction.fromJSON(tx);
      } else {
        txObj = tx;
      }
      const txHash = txObj.calculateHash();
      if (txHash === hash) {
        return txObj;
      }
    }
    
    return null;
  }

  getTransactionDetails(hash) {
    const tx = this.getTransactionByHash(hash);
    if (!tx) return null;

    return {
      hash: tx.calculateHash(),
      type: tx.fromAddress === null ? 'mining_reward' : 'transfer',
      amount: tx.amount,
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      timestamp: tx.timestamp,
      blockHash: this.chain.find(block => 
        block.transactions.some(t => t.calculateHash() === hash)
      )?.hash,
      blockIndex: this.chain.findIndex(block => 
        block.transactions.some(t => t.calculateHash() === hash)
      ),
      reason: tx.fromAddress === null ? 'Block mining reward' : 'Transfer between users'
    };
  }

  getRecentTransactions(limit = 10) {
    return this.chain
      .flatMap(block => block.transactions)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getUserTransactions(address) {
    return this.chain
      .flatMap(block => block.transactions)
      .filter(tx => tx.fromAddress === address || tx.toAddress === address)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getUserTransactionHistory(address) {
    const userData = this.userData.getUserData(address);
    if (!userData) return [];

    return userData.transactions.map(tx => ({
      type: tx.fromAddress === null ? 'mining_reward' : 
            tx.fromAddress === address ? 'sent' : 'received',
      amount: tx.amount,
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      timestamp: tx.timestamp,
      hash: tx.calculateHash(),
      reason: tx.fromAddress === null ? 'Block mining reward' :
              tx.fromAddress === address ? 'Transfer to another user' :
              'Transfer from another user'
    }));
  }

  getUserStatistics(address) {
    const client = this.clientManager.getClient(address);
    if (!client) return null;

    const transactions = client.transactions;
    const sentTxs = transactions.filter(tx => tx.fromAddress === address);
    const receivedTxs = transactions.filter(tx => tx.toAddress === address);
    const minedTxs = transactions.filter(tx => tx.fromAddress === null);

    return {
      address: address,
      balance: client.balance,
      totalTransactions: transactions.length,
      sentTransactions: sentTxs.length,
      receivedTransactions: receivedTxs.length,
      minedBlocks: minedTxs.length,
      totalSent: sentTxs.reduce((sum, tx) => sum + tx.amount, 0),
      totalReceived: receivedTxs.reduce((sum, tx) => sum + tx.amount, 0),
      totalMined: minedTxs.reduce((sum, tx) => sum + tx.amount, 0),
      netBalanceChange: receivedTxs.reduce((sum, tx) => sum + tx.amount, 0) +
                       minedTxs.reduce((sum, tx) => sum + tx.amount, 0) -
                       sentTxs.reduce((sum, tx) => sum + tx.amount, 0),
      createdAt: client.createdAt,
      lastActive: client.lastActive,
      isActive: new Date(client.lastActive).getTime() > Date.now() - 60 * 60 * 1000
    };
  }

  getTopUsers(limit = 10) {
    const users = this.userData.getAllUsers();
    return users
      .map(user => this.getUserStatistics(user.address))
      .filter(stats => stats !== null)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);
  }

  getActiveUsers() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return this.userData.getAllUsers()
      .filter(user => new Date(user.lastActive).getTime() > oneHourAgo)
      .map(user => this.getUserStatistics(user.address));
  }

  getTransactionVolume() {
    return this.chain.reduce((volume, block) => {
      return volume + block.transactions.reduce((blockVolume, tx) => {
        return blockVolume + (tx.amount || 0);
      }, 0);
    }, 0);
  }
}

module.exports = Blockchain;