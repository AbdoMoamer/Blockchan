const crypto = require('crypto');

class DNSManager {
    constructor() {
        this.records = new Map();
        this.cache = new Map();
    }

    // تسجيل اسم جديد
    registerName(name, address, owner) {
        if (this.records.has(name)) {
            throw new Error('Name already registered');
        }

        const record = {
            name,
            address,
            owner,
            registeredAt: Date.now(),
            lastUpdated: Date.now()
        };

        this.records.set(name, record);
        this.cache.set(name, record);
        return record;
    }

    // تحديث سجل DNS
    updateRecord(name, newAddress, owner) {
        const record = this.records.get(name);
        if (!record) {
            throw new Error('Name not found');
        }

        if (record.owner !== owner) {
            throw new Error('Unauthorized');
        }

        record.address = newAddress;
        record.lastUpdated = Date.now();
        this.cache.set(name, record);
        return record;
    }

    // البحث عن عنوان باستخدام الاسم
    resolveName(name) {
        let record = this.cache.get(name);
        
        if (!record) {
            record = this.records.get(name);
            if (record) {
                this.cache.set(name, record);
            }
        }

        return record ? record.address : null;
    }

    // الحصول على معلومات الاسم
    getNameInfo(name) {
        return this.records.get(name);
    }

    // مسح التخزين المؤقت
    clearCache() {
        this.cache.clear();
    }

    // التحقق من توفر الاسم
    isNameAvailable(name) {
        return !this.records.has(name);
    }

    // الحصول على جميع السجلات
    getAllRecords() {
        return Array.from(this.records.values());
    }
}

module.exports = DNSManager; 