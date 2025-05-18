const crypto = require('crypto');

class SmartContract {
    constructor(address, code, creator) {
        this.address = address;
        this.code = code;
        this.creator = creator;
        this.state = {};
        this.createdAt = Date.now();
        this.lastExecuted = null;
    }

    // تنفيذ العقد الذكي
    async execute(input, caller) {
        try {
            // التحقق من صحة المدخلات
            if (!this.validateInput(input)) {
                throw new Error('Invalid input');
            }

            // تنفيذ الكود
            const result = await this.runCode(input, caller);
            
            // تحديث حالة العقد
            this.state = { ...this.state, ...result };
            this.lastExecuted = Date.now();
            
            return {
                success: true,
                result,
                state: this.state
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    // التحقق من صحة المدخلات
    validateInput(input) {
        // يمكن إضافة قواعد التحقق هنا
        return true;
    }

    // تنفيذ كود العقد
    async runCode(input, caller) {
        // محاكاة تنفيذ الكود
        // في الواقع، سيتم تنفيذ الكود في بيئة آمنة
        return {
            executed: true,
            caller,
            timestamp: Date.now()
        };
    }

    // الحصول على حالة العقد
    getState() {
        return this.state;
    }

    // تحديث حالة العقد
    updateState(newState) {
        this.state = { ...this.state, ...newState };
    }
}

// مدير العقود الذكية
class ContractManager {
    constructor() {
        this.contracts = new Map();
        this.cache = new Map(); // تخزين مؤقت للعقود
    }

    // إنشاء عقد جديد
    createContract(code, creator) {
        const address = this.generateContractAddress(creator);
        const contract = new SmartContract(address, code, creator);
        this.contracts.set(address, contract);
        this.cache.set(address, contract);
        return contract;
    }

    // تنفيذ عقد
    async executeContract(address, input, caller) {
        let contract = this.cache.get(address);
        
        if (!contract) {
            contract = this.contracts.get(address);
            if (contract) {
                this.cache.set(address, contract);
            } else {
                throw new Error('Contract not found');
            }
        }

        return await contract.execute(input, caller);
    }

    // توليد عنوان للعقد
    generateContractAddress(creator) {
        const data = `${creator}${Date.now()}`;
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    // الحصول على قائمة العقود
    getContracts() {
        return Array.from(this.contracts.values());
    }

    // مسح التخزين المؤقت
    clearCache() {
        this.cache.clear();
    }
}

module.exports = {
    SmartContract,
    ContractManager
}; 