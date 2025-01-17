const mongoose = require('mongoose');

const cryptoAddressSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    address: {
        type: String,
        required: true
    },
    currency: {
        type: String,
        required: true,
        enum: ['USDT'] // Ограничиваем значения только USDT
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Создаем уникальный индекс для комбинации userId и currency
cryptoAddressSchema.index({ userId: 1, currency: 1 }, { unique: true });

module.exports = mongoose.model('CryptoAddress', cryptoAddressSchema);