const express = require("express");
const router = express.Router();
const cors = require("cors");
const User = require("../models/user");
const UsdtService = require("../UsdtService");
const {
  test,
  loginUser,
  getProfile,
  logoutUser,
} = require("../controllers/authController");
const jwt = require("jsonwebtoken");
const UAParser = require("ua-parser-js");

const usdtService = new UsdtService(process.env.USDT_PRIVATE_KEY);

// Middleware
router.use(
  cors({
    credentials: true,
    origin: "https://mmr-pay.trade",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Функция для получения информации об устройстве
const getDeviceInfo = (req) => {
  const ua = UAParser(req.headers["user-agent"]);
  return {
    deviceType: ua.device.type || "unknown",
    os: `${ua.os.name} ${ua.os.version}`,
    browser: `${ua.browser.name} ${ua.browser.version}`,
    ip: req.ip,
  };
};

// Middleware для проверки токена и устройства
const verifyTokenAndDevice = async (req, res, next) => {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ error: "Необходима авторизация" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      res.clearCookie("token");
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    if (user.isBlocked && user.blockedUntil > new Date()) {
      return res.status(403).json({
        error: "Аккаунт заблокирован",
        reason: user.blockReason,
        unblockTime: user.blockedUntil,
      });
    }

    if (!user.auth) {
      res.clearCookie("token");
      return res.status(401).json({ error: "Сессия истекла" });
    }

    // Проверка устройства
    const currentDevice = getDeviceInfo(req);
    if (!user.isDeviceAllowed(currentDevice)) {
      // Записываем неудачную попытку входа
      await user.recordFailedLogin(currentDevice);
      res.clearCookie("token");
      return res
        .status(401)
        .json({
          error: "Доступ с нового устройства. Требуется повторная авторизация.",
        });
    }

    // Обновляем информацию о последнем входе
    await user.updateLoginDevice(currentDevice);

    req.user = {
      _id: user._id,
      login: user.login,
      role: user.role,
      auth: user.auth,
    };

    next();
  } catch (error) {
    console.error("Ошибка верификации токена:", error);
    res.clearCookie("token");
    res.status(401).json({ error: "Недействительный токен" });
  }
};

// Обработчик регистрации
const registerUser = async (req, res) => {
  try {
    const { login, email, password } = req.body;

    // Валидация входных данных
    if (!login || !email || !password) {
      return res
        .status(400)
        .json({ error: "Все поля обязательны для заполнения" });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Пароль должен содержать минимум 8 символов" });
    }

    // Проверка существующего пользователя
    const existingUser = await User.findOne({ $or: [{ email }, { login }] });
    if (existingUser) {
      return res.status(400).json({
        error:
          existingUser.email === email
            ? "Пользователь с таким email уже существует"
            : "Пользователь с таким логином уже существует",
      });
    }

    // Генерируем USDT адрес
    const usdtWallet = usdtService.generateNewAddress();

    // Создаем пользователя с USDT адресом
    const newUser = new User({
      login,
      email,
      password,
      auth: false,
      cryptoAddresses: [
        {
          address: usdtWallet.address,
          currency: "USDT",
          createdAt: new Date(),
        },
      ],
    });

    await newUser.save();

    res.status(201).json({
      message: "Регистрация успешна",
      user: {
        _id: newUser._id,
        login: newUser.login,
        email: newUser.email,
        usdtAddress: usdtWallet.address,
      },
    });
  } catch (error) {
    console.error("Ошибка при регистрации:", error);
    res.status(500).json({
      error: "Ошибка сервера при регистрации",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Эндпоинт для изменения пароля
router.put("/api/user/change-password", verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  try {
    // Находим пользователя по ID из токена
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем текущий пароль
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ error: "Неверный текущий пароль" });
    }

    // Проверка на минимальную длину нового пароля
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Новый пароль должен содержать минимум 6 символов" });
    }

    // Обновляем пароль пользователя
    user.password = newPassword; // Новый пароль будет хеширован в хуке pre-save
    await user.save(); // Сохраняем изменения в базе данных

    res.status(200).json({ message: "Пароль успешно изменен" });
  } catch (error) {
    console.error("Ошибка при изменении пароля:", error);
    res.status(500).json({ error: "Ошибка сервера при изменении пароля" });
  }
});

// Маршруты
router.get("/", test);
router.post("/signup", registerUser);
router.post("/signin", loginUser);
router.get("/settings", verifyTokenAndDevice, getProfile);
router.post("/logout", verifyTokenAndDevice, logoutUser);

// Дополнительный маршрут для проверки статуса аутентификации
router.get("/check-auth", verifyTokenAndDevice, (req, res) => {
  res.json({
    isAuthenticated: true,
    user: req.user,
  });
});

module.exports = router;
