const jwt = require("jsonwebtoken");
const User = require("../models/user");

exports.requireAuth = async (req, res, next) => {
  try {
    // Получаем токен из cookies
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ error: "Не авторизован" });
    }

    // Проверяем токен
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Находим пользователя
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: "Пользователь не найден" });
    }

    // Проверяем статус авторизации
    if (!user.auth) {
      return res.status(401).json({ error: "Сессия истекла" });
    }

    // Добавляем пользователя в объект запроса
    req.user = user;
    next();
  } catch (error) {
    console.error("Ошибка аутентификации:", error);
    res.status(401).json({ error: "Недействительный токен" });
  }
};
