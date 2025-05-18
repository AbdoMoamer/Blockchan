const crypto = require('crypto');

class Message {
    constructor(from, to, content, type = 'text') {
        this.id = crypto.randomBytes(16).toString('hex');
        this.from = from;
        this.to = to;
        this.content = content;
        this.type = type;
        this.timestamp = Date.now();
        this.read = false;
    }
}

class MessagingSystem {
    constructor() {
        this.messages = new Map();
        this.cache = new Map();
    }

    // إرسال رسالة
    sendMessage(from, to, content, type = 'text') {
        const message = new Message(from, to, content, type);
        
        // تخزين الرسالة في صندوق الوارد للمستلم
        if (!this.messages.has(to)) {
            this.messages.set(to, []);
        }
        this.messages.get(to).push(message);
        
        // تخزين مؤقت
        if (!this.cache.has(to)) {
            this.cache.set(to, []);
        }
        this.cache.get(to).push(message);
        
        return message;
    }

    // الحصول على رسائل المستخدم
    getUserMessages(userId) {
        let messages = this.cache.get(userId);
        
        if (!messages) {
            messages = this.messages.get(userId) || [];
            this.cache.set(userId, messages);
        }
        
        return messages;
    }

    // تحديث حالة القراءة
    markAsRead(messageId, userId) {
        const messages = this.messages.get(userId) || [];
        const message = messages.find(m => m.id === messageId);
        
        if (message) {
            message.read = true;
            // تحديث التخزين المؤقت
            const cachedMessages = this.cache.get(userId) || [];
            const cachedMessage = cachedMessages.find(m => m.id === messageId);
            if (cachedMessage) {
                cachedMessage.read = true;
            }
        }
    }

    // حذف رسالة
    deleteMessage(messageId, userId) {
        let messages = this.messages.get(userId);
        if (messages) {
            messages = messages.filter(m => m.id !== messageId);
            this.messages.set(userId, messages);
        }
        
        // تحديث التخزين المؤقت
        let cachedMessages = this.cache.get(userId);
        if (cachedMessages) {
            cachedMessages = cachedMessages.filter(m => m.id !== messageId);
            this.cache.set(userId, cachedMessages);
        }
    }

    // الحصول على عدد الرسائل غير المقروءة
    getUnreadCount(userId) {
        const messages = this.messages.get(userId) || [];
        return messages.filter(m => !m.read).length;
    }

    // مسح التخزين المؤقت
    clearCache() {
        this.cache.clear();
    }

    // البحث في الرسائل
    searchMessages(userId, query) {
        const messages = this.messages.get(userId) || [];
        return messages.filter(m => 
            m.content.toLowerCase().includes(query.toLowerCase())
        );
    }
}

module.exports = MessagingSystem; 