const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid"); // Импортируем uuid для генерации уникальных ссылок

const paymentOptionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    bank: {
        type: String,
        required: true,
    },
    limit: {
        type: Number,
        required: true,
    },
    usedAmount: {
        type: Number,
        default: 0,
    },
    timeout: {
        type: Number,
        required: true,
    },
    maxRequests: {
        type: Number,
        required: true,
    },
    currentRequests: {
        type: Number,
        default: 0
    },
    botRequisites: {
        type: String,
        required: true,
    },
    comment: {
        type: String,
    },
    isActive: {
        type: Boolean,
        default: false,
    },
    addedBy: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    lastUsed: {
        type: Date,
        default: null
    },
    status: {
        type: String,
        enum: ['available', 'in_use', 'completed', 'disabled'],
        default: 'available'
    },
    amount: {
        type: Number,
        required: true,
    },
    uniqueLink: { // Добавляем поле uniqueLink
        type: String,
        unique: true, // Устанавливаем уникальность
        required: true,
    },
    transactions: [{
        amount: {
            type: Number,
            required: true,
        },
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed'],
            default: 'pending'
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        externalResponse: {
            status: String,
            message: String,
            timestamp: Date
        }
    }]
});

// Метод для проверки доступности платежной опции
paymentOptionSchema.methods.isAvailable = function(amount) {
    const remainingLimit = this.limit - this.usedAmount;
    return (
        this.isActive &&
        remainingLimit >= amount &&
        this.currentRequests < this.maxRequests &&
        this.status === 'available'
    );
};

// Метод для обновления использованной суммы
paymentOptionSchema.methods.updateUsedAmount = async function(amount) {
    const currentUsedAmount = this.usedAmount || 0;
    const newUsedAmount = currentUsedAmount + amount;
    
    if (newUsedAmount > this.limit) {
        throw new Error('Превышен лимит реквизита');
    }
    
    this.usedAmount = newUsedAmount;
    this.currentRequests += 1;
    this.lastUsed = new Date();
    
    if (this.usedAmount >= this.limit || this.currentRequests >= this.maxRequests) {
        this.status = 'completed';
        this.isActive = false;
    }

    return this.save();
};

// Виртуальное поле для получения доступного лимита
paymentOptionSchema.virtual('availableLimit').get(function() {
    return Math.max(this.limit - (this.usedAmount || 0), 0);
});

// Метод для добавления транзакции
paymentOptionSchema.methods.addTransaction = async function(amount) {
    const transaction = {
        amount: amount,
        timestamp: new Date(),
        status: 'pending'
    };
    this.transactions.push(transaction);
    await this.save();
    return this.transactions[this.transactions.length - 1];
};

// Метод для обновления статуса транзакции
paymentOptionSchema.methods.updateTransactionStatus = async function(transactionId, status, externalResponse = null) {
    const transaction = this.transactions.id(transactionId);
    if (!transaction) {
        throw new Error('Транзакция не найдена');
    }
    transaction.status = status;
    if (externalResponse) {
        transaction.externalResponse = externalResponse;
    }
    return this.save();
};

// Статический метод для создания новой платежной опции
paymentOptionSchema.statics.createPaymentOption = async function(data) {
    const newPaymentOption = new this({
        ...data,
        uniqueLink: uuidv4(), // Генерация уникального значения для uniqueLink
    });
    return await newPaymentOption.save();
};

// Статический метод для проверки общего лимита пользователя
paymentOptionSchema.statics.checkTotalLimits = async function(userId) {
    const totalLimits = await this.aggregate([
        { $match: { userId: mongoose.Types.ObjectId(userId), isActive: true } },
        { $group: { _id: null, total: { $sum: "$limit" } } }
    ]);
    
    return totalLimits.length > 0 ? totalLimits[0].total : 0;
};

// Индексы для оптимизации запросов
paymentOptionSchema.index({ userId: 1, isActive: 1 });
paymentOptionSchema.index({ createdAt: 1 });
paymentOptionSchema.index({ status: 1 });
paymentOptionSchema.index({ uniqueLink: 1 }); // Индекс для уникального поля uniqueLink

const PaymentOption = mongoose.model("PaymentOption", paymentOptionSchema);

module.exports = PaymentOption;