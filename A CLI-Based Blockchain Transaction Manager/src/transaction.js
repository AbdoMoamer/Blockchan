const crypto = require('crypto');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

class Transaction {
  constructor(fromAddress, toAddress, amount) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = Date.now();
    this.signature = null;
  }

  calculateHash() {
    return crypto.createHash('sha256')
      .update(this.fromAddress + this.toAddress + this.amount + this.timestamp)
      .digest('hex');
  }

  signTransaction(signingKey) {
    if (!signingKey || !signingKey.getPublic) {
      throw new Error('No signing key provided!');
    }

    const publicKey = signingKey.getPublic('hex');
    if (publicKey !== this.fromAddress) {
      throw new Error('You cannot sign transactions for other wallets!');
    }

    const hashTx = this.calculateHash();
    const sig = signingKey.sign(hashTx, 'base64');
    this.signature = sig.toDER('hex');
    return true;
  }

  isValid() {
    // معاملات التعدين (المكافآت) لا تحتاج إلى توقيع
    if (this.fromAddress === null) return true;

    // التحقق من وجود التوقيع
    if (!this.signature || this.signature.length === 0) {
      throw new Error('No signature in this transaction');
    }

    // التحقق من صحة التوقيع
    try {
      const publicKey = ec.keyFromPublic(this.fromAddress, 'hex');
      const hashTx = this.calculateHash();
      return publicKey.verify(hashTx, this.signature);
    } catch (error) {
      throw new Error('Invalid transaction signature');
    }
  }

  static fromJSON(json) {
    const tx = new Transaction(json.fromAddress, json.toAddress, json.amount);
    tx.timestamp = json.timestamp;
    tx.signature = json.signature;
    return tx;
  }
}

module.exports = Transaction;
