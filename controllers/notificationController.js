const Notification = require("../models/notification");
const User = require("../models/user");

exports.createNotification = async (req, res) => {
  try {
    const { title, message } = req.body;
    console.log("Received notification data:", { title, message });

    if (!title || !message) {
      return res
        .status(400)
        .json({ error: "Заголовок и текст уведомления обязательны" });
    }

    let imageUrl = null;
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
      console.log("Image uploaded:", imageUrl);
    }

    const notification = new Notification({
      title,
      message,
      image: imageUrl,
      createdBy: req.user._id,
    });

    const savedNotification = await notification.save();
    console.log("Notification saved successfully:", savedNotification);

    // Отправляем полные данные уведомления в ответе
    res.status(201).json({
      message: "Уведомление создано успешно",
      notification: savedNotification,
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({
      error: "Ошибка при создании уведомления",
      details: error.message,
    });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find()
      .sort({ createdAt: -1 })
      .populate("createdBy", "login"); // Предполагая, что у вас есть поле 'login' в модели User

    res.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      error: "Ошибка при получении уведомлений",
      details: error.message,
    });
  }
};

// Добавляем функцию для сброса счетчика уведомлений
exports.resetNotificationCounter = async (req, res) => {
  try {
    const userId = req.user._id; // Получаем ID пользователя из объекта req.user
    await User.findByIdAndUpdate(userId, { $set: { unreadNotifications: 0 } });
    res.json({
      success: true,
      message: "Notification counter reset successfully",
    });
  } catch (error) {
    console.error("Error resetting notification counter:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
