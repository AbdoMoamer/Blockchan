const Blockchain = require('./blockchain');
const { createServer, connectToPeer } = require('./network');

// إنشاء نسخة من البلوكتشين
const blockchain = new Blockchain();

// إنشاء خادم على المنفذ 6001
const port = 6001;
createServer(port, (message) => {
  console.log('Received message:', message);
});

console.log(`🚀 Blockchain node started on port ${port}`);
console.log('📝 Type "help" for available commands');

// بدء واجهة المستخدم
require('./cli');
