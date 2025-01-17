const mongoose = require('mongoose');

const TransactionsHistorySchema = new mongoose.Schema({
    amount: {
        type: Number,
        required: true
    },
    paymentOptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PaymentOption',
        required: true
    },
    bank: {
        type: String,
        required: true
    },
    botRequisites: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'canceled', 'active'],
        default: 'active'
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
});

// Индексы для оптимизации запросов
TransactionsHistorySchema.index({ userId: 1, timestamp: -1 });
TransactionsHistorySchema.index({ paymentOptionId: 1 });

const SuccessfulDeposit = mongoose.model('SuccessfulDeposit', TransactionsHistorySchema);

module.exports = SuccessfulDeposit;