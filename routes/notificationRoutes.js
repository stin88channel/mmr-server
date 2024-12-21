const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { requireAuth } = require('../middleware/authMiddleware');
const { 
    getNotifications, 
    createNotification, 
    resetNotificationCounter 
} = require('../controllers/notificationController');

// Настраиваем multer для сохранения файлов
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/') // Убедитесь, что эта папка существует
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
    }
});

const upload = multer({ storage: storage });

// Защищаем все маршруты middleware авторизации
router.get('/notifications', requireAuth, getNotifications);
router.post('/notifications', requireAuth, upload.single('image'), createNotification);
router.post('/notifications/reset-counter', requireAuth, resetNotificationCounter);

module.exports = router;