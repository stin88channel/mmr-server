const express = require('express');
const router = express.Router();
const PaymentOption = require('../models/paymentOption'); // Импортируйте модель платежной опции

// Обработчик для создания платежной опции
router.post('/api/create-payment-option', async (req, res) => {
    const { amount, customUrl } = req.body;

    // Проверка наличия обязательных полей и их корректности
    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Сумма должна быть положительным числом" });
    }
    
    if (!customUrl || typeof customUrl !== 'string' || customUrl.trim().length === 0) {
        return res.status(400).json({ error: "URL обязателен для заполнения" });
    }

    try {
        // Создание новой платежной опции
        const newPaymentOption = new PaymentOption({
            amount,
            customUrl,
            // Добавьте другие необходимые поля, если это требуется
        });

        const savedPaymentOption = await newPaymentOption.save();

        // Проверка успешного сохранения
        if (!savedPaymentOption) {
            return res.status(500).json({ error: "Не удалось сохранить платежную опцию" });
        }

        res.status(201).json({ message: "Платежная опция успешно создана", paymentOption: savedPaymentOption });
    } catch (error) {
        console.error("Ошибка при создании платежной опции:", error);
        
        // Обработка различных типов ошибок
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: "Ошибка валидации данных", details: error.message });
        }
        
        res.status(500).json({ error: "Ошибка сервера при создании платежной опции" });
    }
});

module.exports = router;