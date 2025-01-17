const express = require("express");
const dotenv = require("dotenv").config();
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const UsdtService = require("./UsdtService");

// 2FA GOOGLE
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");

const checkAllowedAdmin = require("./middleware/authAdmin");

// MODELS
const User = require("./models/User");
const Notification = require("./models/notification");
const PaymentOption = require("./models/paymentOption");
const SuccessfulDeposit = require("./models/successfulDeposit");

// ROUTES
const paymentRoutes = require("./routes/paymentRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

// CUSTOM URL
const { v4: uuidv4 } = require("uuid");

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use("/api", notificationRoutes);
app.use("/api", paymentRoutes);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const usdtService = new UsdtService(process.env.USDT_PRIVATE_KEY);

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("База данных подключена"))
  .catch((err) => console.error("Ошибка подключения к базе данных:", err));

const verifyToken = async (req, res, next) => {
  try {
    const token = req.cookies.token; // Получаем токен из cookies

    // Проверка наличия токена
    if (!token) {
      return res.status(401).json({ error: "Необходима авторизация" });
    }

    // Декодируем токен
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Находим пользователя по ID из декодированного токена
    const user = await User.findById(decoded.id).select("-password"); // Исключаем пароль из результата

    // Проверка существования пользователя
    if (!user) {
      res.clearCookie("token"); // Очищаем токен в cookies
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем статус авторизации пользователя
    if (!user.auth) {
      res.clearCookie("token"); // Очищаем токен в cookies
      return res.status(401).json({ error: "Сессия истекла" });
    }

    // Устанавливаем пользователя в объект запроса
    req.user = {
      _id: user._id,
      login: user.login,
      role: user.role,
      auth: user.auth,
    };

    next(); // Переходим к следующему middleware или обработчику
  } catch (error) {
    console.error("Ошибка верификации токена:", error);
    res.clearCookie("token"); // Очищаем токен в cookies
    return res.status(401).json({ error: "Недействительный токен" });
  }
};

// Проверка
app.get("/api/check-admin", verifyToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ isAdmin: false });
    }
    res.json({ isAdmin: true });
  } catch (error) {
    console.error("Ошибка при проверке прав администратора:", error);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Отправка уведомления (только для админов)
app.post(
  "/api/notifications",
  verifyToken,
  checkAllowedAdmin,
  async (req, res) => {
    try {
      let { message } = req.body;

      if (!message || message.trim().length === 0) {
        return res
          .status(400)
          .json({ error: "Сообщение не может быть пустым" });
      }

      // Trim the message and replace multiple newlines with two newlines
      message = message.trim().replace(/\n{3,}/g, "\n\n");

      // Replace newlines with <br> tags
      message = message.replace(/\n/g, "<br>");

      // Replace multiple spaces with a single space
      message = message.replace(/ +(?= )/g, "");

      const notification = new Notification({
        message: message,
        createdBy: req.user._id,
      });

      await notification.save();

      // Увеличиваем счетчик непрочитанных уведомлений для всех пользователей
      await User.updateMany({}, { $inc: { unreadNotifications: 1 } });

      res.status(201).json({ message: "Уведомление успешно создано" });
    } catch (error) {
      console.error("Ошибка при создании уведомления:", error);
      res.status(500).json({ error: "Ошибка при создании уведомления" });
    }
  }
);

// Получение всех уведомлений
app.get("/api/notifications", verifyToken, async (req, res) => {
  try {
    const notifications = await Notification.find()
      .sort({ createdAt: -1 })
      .populate("createdBy", "login");
    res.json(notifications);
  } catch (error) {
    console.error("Ошибка при получении уведомлений:", error);
    res.status(500).json({ error: "Ошибка при получении уведомлений" });
  }
});

app.post("/api/notifications/reset-counter", verifyToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { unreadNotifications: 0 });
    res.json({ message: "Счетчик уведомлений сброшен" });
  } catch (error) {
    console.error("Ошибка при сбросе счетчика уведомлений:", error);
    res.status(500).json({ error: "Ошибка при сбросе счетчика уведомлений" });
  }
});

// Регистрация
app.post("/account/signup", async (req, res) => {
  const { login, email, password } = req.body;

  try {
    console.log("Получены данные для регистрации:", { login, email });

    // Валидация входных данных
    if (!login || !email || !password) {
      return res
        .status(400)
        .json({ error: "Все поля обязательны для заполнения" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Пароль должен содержать минимум 6 символов" });
    }

    // Проверка существующего пользователя
    console.log("Проверка существующего пользователя...");
    const existingUser = await User.findOne({ $or: [{ email }, { login }] });
    console.log("Результат проверки:", existingUser);

    if (existingUser) {
      return res.status(400).json({
        error:
          existingUser.email === email
            ? "Пользователь с таким email уже существует"
            : "Пользователь с таким логином уже существует",
      });
    }

    // Получение существующего или генерация нового USDT адреса
    console.log("Получение/генерация USDT адреса...");
    let usdtAddress;
    const existingAddress = await User.findOne({
      "cryptoAddresses.address": { $exists: true },
    });

    if (existingAddress && existingAddress.cryptoAddresses[0]) {
      usdtAddress = existingAddress.cryptoAddresses[0].address;
      console.log("Использован существующий USDT адрес:", usdtAddress);
    } else {
      const usdtWallet = usdtService.generateNewAddress();
      usdtAddress = usdtWallet.address;
      console.log("Сгенерирован новый USDT адрес:", usdtAddress);
    }

    // Создание нового пользователя
    console.log("Создание нового пользователя...");
    const newUser = new User({
      login,
      email,
      password, // Пароль будет хэширован в pre-save хуке
      auth: 0,
      cryptoAddresses: [
        {
          address: usdtAddress,
          currency: "USDT",
          createdAt: new Date(),
        },
      ],
    });

    await newUser.save();
    console.log("Новый пользователь создан:", {
      _id: newUser._id,
      login: newUser.login,
      usdtAddress: usdtAddress,
    });

    // Отправка успешного ответа
    res.status(201).json({
      message: "Регистрация успешна",
      _id: newUser._id,
      usdtAddress: usdtAddress,
    });
  } catch (error) {
    console.error("Ошибка при регистрации:", error);

    // Обработка различных типов ошибок
    if (error.name === "ValidationError") {
      return res.status(400).json({
        error: "Ошибка валидации данных",
        details: error.message,
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        error: "Дублирование уникальных полей",
        details: "Email или логин уже используются",
      });
    }

    // Общая ошибка сервера
    res.status(500).json({
      error: "Ошибка сервера при регистрации",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Авторизация
app.post("/account/signin", async (req, res) => {
  const { login, password } = req.body;

  try {
    // Проверка наличия обязательных полей
    if (!login || !password) {
      return res
        .status(400)
        .json({ error: "Все поля обязательны для заполнения" });
    }

    // Поиск пользователя по логину
    const user = await User.findOne({ login });
    if (!user) {
      return res.status(400).json({ error: "Неверный логин или пароль" });
    }

    // Проверка пароля
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: "Неверный логин или пароль" });
    }

    // Создание токена
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "24h",
    });

    // Обновление статуса авторизации
    user.auth = 1;
    await user.save();

    // Если 2FA включена, не устанавливаем токен в cookies
    if (user.twoFAEnabled) {
      return res.status(200).json({
        message: "Вход выполнен успешно, требуется 2FA",
        user: {
          _id: user._id,
          login: user.login,
          auth: user.auth,
          walletStatus: user.walletStatus,
          twoFAEnabled: user.twoFAEnabled,
        },
        token, // Возвращаем токен для дальнейшего использования
      });
    }

    // Установка cookie с токеном, если 2FA не включена
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 24 * 60 * 60 * 1000, // 24 часа
    });

    // Отправка ответа с данными пользователя
    return res.status(200).json({
      message: "Вход выполнен успешно",
      user: {
        _id: user._id,
        login: user.login,
        auth: user.auth,
        walletStatus: user.walletStatus,
        twoFAEnabled: user.twoFAEnabled,
      },
    });
  } catch (error) {
    console.error("Ошибка при входе:", error);
    return res.status(500).json({
      error: "Ошибка сервера при входе",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Выход из системы
app.post("/account/logout", async (req, res) => {
  try {
    // Проверяем, существует ли токен в cookies
    const token = req.cookies.token;

    // Если токен отсутствует, просто возвращаем успешный ответ
    if (!token) {
      return res.status(200).json({ message: "Выход выполнен успешно" });
    }

    // Проверяем и декодируем токен
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error("Ошибка верификации токена:", err);
      return res.status(401).json({ error: "Недействительный токен" });
    }

    const userId = decoded.id;

    // Обновляем статус auth пользователя на 0 (выход)
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { auth: 0 },
      { new: true }
    );

    // Проверяем, был ли пользователь найден и обновлен
    if (!updatedUser) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Очищаем куки с токеном
    res.clearCookie("token");

    // Возвращаем успешный ответ
    return res.status(200).json({ message: "Выход выполнен успешно" });
  } catch (error) {
    console.error("Ошибка при выходе из системы:", error);
    return res
      .status(500)
      .json({ error: "Ошибка сервера при выходе из системы" });
  }
});

// Получение данных пользователя
app.get("/user/settings", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    res.json(user);
  } catch (error) {
    console.error("Ошибка при получении данных пользователя:", error);
    res
      .status(500)
      .json({ error: "Ошибка сервера при получении данных пользователя" });
  }
});

// Изменение статуса кошелька
app.post("/user/toggle-wallet", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    console.log("Current wallet status:", user.walletStatus);
    const newWalletStatus = user.walletStatus === 1 ? 0 : 1;
    user.walletStatus = newWalletStatus;
    await user.save();
    console.log("New wallet status:", newWalletStatus);

    if (newWalletStatus === 0) {
      console.log("Deactivating payment options...");
      const updateResult = await PaymentOption.updateMany(
        {
          userId: req.user._id,
          isActive: true,
        },
        { $set: { isActive: false } }
      );
      console.log("Update result:", updateResult);

      // Проверим, действительно ли обновились опции
      const updatedOptions = await PaymentOption.find({ userId: req.user._id });
      console.log("Updated options:", updatedOptions);
    }

    res.json({ walletStatus: user.walletStatus });
  } catch (error) {
    console.error("Ошибка при изменении статуса кошелька:", error);
    res
      .status(500)
      .json({ error: "Ошибка сервера при изменении статуса кошелька" });
  }
});

// Обработчик для получения платежных опций для вывода
app.get("/api/payment-options/withdraw", async (req, res) => {
  try {
    console.log("Запрос на получение платежных опций для вывода");
    const paymentOptions = await PaymentOption.find({ isActive: true });
    console.log("Платежные опции найдены:", paymentOptions);
    res.json(paymentOptions);
  } catch (error) {
    console.error("Ошибка при получении реквизитов:", error);
    res.status(500).json({ error: "Ошибка сервера при получении реквизитов" });
  }
});

// Обработчик для получения платежных опций для авторизованных пользователей
app.get("/api/payment-options", verifyToken, async (req, res) => {
  try {
    console.log("Запрос на получение платежных опций для пользователя");
    const paymentOptions = await PaymentOption.find({ userId: req.user._id });
    console.log("Платежные опции найдены:", paymentOptions);
    res.json(paymentOptions);
  } catch (error) {
    console.error("Ошибка при получении реквизитов:", error);
    res.status(500).json({ error: "Ошибка сервера при получении реквизитов" });
  }
});

// Создание новой платежной опции
// Функция для проверки доступного лимита пользователя
const checkAvailableLimit = async (
  userId,
  requestedLimit,
  excludeOptionId = null
) => {
  const user = await User.findById(userId);
  const usdtInRub = user.usdtBalance * 90; // Конвертация USDT в рубли

  // Получаем все активные реквизиты пользователя
  const existingOptions = await PaymentOption.find({
    userId,
    _id: { $ne: excludeOptionId }, // Исключаем текущий реквизит при обновлении
    isActive: true,
  });

  // Считаем сумму всех установленных лимитов
  const totalExistingLimits = existingOptions.reduce(
    (sum, option) => sum + option.limit,
    0
  );

  // Проверяем, не превышает ли новый лимит доступный баланс
  const availableLimit = usdtInRub - totalExistingLimits;

  return {
    isAvailable: requestedLimit <= availableLimit,
    availableLimit,
    totalExistingLimits,
  };
};

app.post("/api/payment-options", verifyToken, async (req, res) => {
  try {
    const {
      name,
      bank,
      limit,
      timeout,
      maxRequests,
      botRequisites, // Реквизиты для бота
      comment,
      customUrl, // customUrl теперь необязательный параметр
    } = req.body;

    // Валидация данных
    const errors = validatePaymentOptionData({
      name,
      bank,
      limit,
      timeout,
      maxRequests,
      botRequisites,
    });

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(", ") });
    }

    // Проверка доступного лимита
    const user = await User.findById(req.user._id);
    const usdtInRub = user.usdtBalance * 90; // Конвертация USDT в рубли
    const existingOptions = await PaymentOption.find({
      userId: req.user._id,
      isActive: true,
    });
    const totalExistingLimits = existingOptions.reduce(
      (sum, option) => sum + option.limit,
      0
    );
    const availableLimit = usdtInRub - totalExistingLimits;

    if (Number(limit) > availableLimit) {
      return res.status(400).json({
        error: `Превышен доступный лимит. Доступно: ${availableLimit.toFixed(
          2
        )} RUB`,
      });
    }

    // Генерация уникального customUrl, если он не был предоставлен
    const finalCustomUrl = await generateUniqueCustomUrl(customUrl);

    const newPaymentOption = new PaymentOption({
      userId: req.user._id,
      name: name.trim(),
      bank: bank.trim(),
      limit: Number(limit),
      timeout: Number(timeout),
      maxRequests: Number(maxRequests),
      botRequisites: botRequisites.trim(), // Сохраняем реквизиты
      comment: comment ? comment.trim() : "",
      addedBy: req.user.login,
      amount: Number(limit),
      isActive: true,
      customUrl: finalCustomUrl,
      uniqueLink: uuidv4(), // Генерация уникального значения для uniqueLink
    });

    await newPaymentOption.save();
    res.status(201).json(newPaymentOption);
  } catch (error) {
    console.error("Ошибка при создании платежной опции:", error);
    res
      .status(500)
      .json({ error: "Ошибка сервера при создании платежной опции" });
  }
});

app.put("/api/successful-deposits/:id", verifyToken, async (req, res) => {
  try {
    const deposit = await SuccessfulDeposit.findById(req.params.id);
    if (!deposit) {
      return res.status(404).json({ error: "Запись о депозите не найдена" });
    }
    deposit.status = req.body.status; // Обновляем статус
    await deposit.save();
    res.status(200).json(deposit);
  } catch (error) {
    console.error("Ошибка при обновлении депозита:", error);
    res.status(500).json({ error: "Ошибка сервера при обновлении депозита" });
  }
});

// Функция для валидации данных платежной опции
function validatePaymentOptionData(data) {
  const errors = [];
  const { name, bank, limit, timeout, maxRequests, botRequisites } = data;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    errors.push("Название является обязательным полем");
  }
  if (!bank || typeof bank !== "string" || bank.trim().length === 0) {
    errors.push("Банк является обязательным полем");
  }
  if (!limit || isNaN(Number(limit)) || Number(limit) <= 0) {
    errors.push("Лимит должен быть положительным числом");
  }
  if (!timeout || isNaN(Number(timeout)) || Number(timeout) < 0) {
    errors.push("Таймаут должен быть неотрицательным числом");
  }
  if (!maxRequests || isNaN(Number(maxRequests)) || Number(maxRequests) <= 0) {
    errors.push(
      "Максимальное количество заявок должно быть положительным числом"
    );
  }
  if (
    !botRequisites ||
    typeof botRequisites !== "string" ||
    botRequisites.trim().length === 0
  ) {
    errors.push("Реквизиты бота являются обязательным полем");
  }

  return errors;
}

// Функция для генерации уникального customUrl
async function generateUniqueCustomUrl(customUrl) {
  let finalCustomUrl = customUrl ? customUrl.trim() : `payment/${uuidv4()}`;

  // Проверка на уникальность customUrl
  const existingPaymentOption = await PaymentOption.findOne({
    customUrl: finalCustomUrl,
  });
  if (existingPaymentOption) {
    throw new Error("Кастомная ссылка уже используется.");
  }

  return finalCustomUrl;
}

// Обновление платежной опции
app.put("/api/payment-options/:id", verifyToken, async (req, res) => {
  try {
    const { limit, name, bank, timeout, maxRequests, botRequisites, comment } =
      req.body;

    // Проверка на наличие обязательных полей
    if (!name || !bank || !botRequisites) {
      return res
        .status(400)
        .json({ error: "Все обязательные поля должны быть заполнены." });
    }

    // Проверка лимита, если он передан в запросе
    if (limit) {
      const limitCheck = await checkAvailableLimit(
        req.user._id,
        Number(limit),
        req.params.id // Исключаем текущий реквизит из проверки
      );

      if (!limitCheck.isAvailable) {
        return res.status(400).json({
          error: `Превышен доступный лимит. Доступно: ${limitCheck.availableLimit} RUB`,
        });
      }
    }

    // Обновление данных платежной опции
    const updatedPaymentOption = await PaymentOption.findByIdAndUpdate(
      req.params.id,
      {
        limit: limit ? Number(limit) : undefined,
        name: name.trim(),
        bank: bank.trim(),
        timeout: timeout ? Number(timeout) : undefined,
        maxRequests: maxRequests ? Number(maxRequests) : undefined,
        botRequisites: botRequisites.trim(),
        comment: comment ? comment.trim() : undefined,
      },
      { new: true } // Возвращаем обновленный документ
    );

    if (!updatedPaymentOption) {
      return res.status(404).json({ error: "Платежная опция не найдена" });
    }

    res.json(updatedPaymentOption); // Отправляем обновленную платежную опцию в ответе
  } catch (error) {
    console.error("Ошибка при обновлении платежной опции:", error);
    res
      .status(500)
      .json({ error: "Ошибка сервера при обновлении платежной опции" });
  }
});

// Удаление платежной опции
app.delete("/api/payment-options/:id", verifyToken, async (req, res) => {
  try {
    const result = await PaymentOption.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!result) {
      return res.status(404).json({ error: "Реквизит не найден" });
    }

    res.json({ message: "Реквизит успешно удален" });
  } catch (error) {
    console.error("Ошибка при удалении платежной опции:", error);
    res
      .status(500)
      .json({ error: "Ошибка сервера при удалении платежной опции" });
  }
});

app.get("/api/payment-options/:customUrl", async (req, res) => {
  try {
    const { customUrl } = req.params; // Извлекаем customUrl из параметров
    console.log("Запрос платежной опции:", customUrl);

    // Находим платежную опцию по customUrl
    const paymentOption = await PaymentOption.findOne({ customUrl });

    console.log("Найдена платежная опция:", paymentOption);

    if (!paymentOption) {
      return res.status(404).json({ error: "Платежная опция не найдена" });
    }

    // Явно включаем поле amount в ответ
    const responseData = {
      _id: paymentOption._id,
      amount: paymentOption.amount,
      bank: paymentOption.bank,
      botRequisites: paymentOption.botRequisites,
      limit: paymentOption.limit,
      usedAmount: paymentOption.usedAmount,
      status: paymentOption.status,
      customUrl: paymentOption.customUrl, // Добавляем customUrl в ответ
    };

    console.log("Отправляемые данные:", responseData);

    res.json(responseData);
  } catch (error) {
    console.error("Ошибка при получении платежной опции:", error);
    res.status(500).json({
      error: "Ошибка сервера при получении платежной опции",
      details: error.message,
    });
  }
});

// Изменение платежной опции
app.put("/api/payment-options/:id", verifyToken, async (req, res) => {
  try {
    const { name, bank, limit, timeout, maxRequests, botRequisites, comment } =
      req.body;

    // Валидация данных
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res
        .status(400)
        .json({ error: "Название является обязательным полем" });
    }
    if (!bank || typeof bank !== "string" || bank.trim().length === 0) {
      return res
        .status(400)
        .json({ error: "Банк является обязательным полем" });
    }
    if (!limit || isNaN(Number(limit)) || Number(limit) <= 0) {
      return res
        .status(400)
        .json({ error: "Лимит должен быть положительным числом" });
    }
    if (!timeout || isNaN(Number(timeout)) || Number(timeout) < 0) {
      return res
        .status(400)
        .json({ error: "Таймаут должен быть неотрицательным числом" });
    }
    if (
      !maxRequests ||
      isNaN(Number(maxRequests)) ||
      Number(maxRequests) <= 0
    ) {
      return res.status(400).json({
        error:
          "Максимальное количество заявок должно быть положительным числом",
      });
    }
    if (
      !botRequisites ||
      typeof botRequisites !== "string" ||
      botRequisites.trim().length === 0
    ) {
      return res
        .status(400)
        .json({ error: "Реквизиты бота являются обязательным полем" });
    }

    const updatedPaymentOption = await PaymentOption.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      {
        name: name.trim(),
        bank: bank.trim(),
        limit: Number(limit),
        timeout: Number(timeout),
        maxRequests: Number(maxRequests),
        botRequisites: botRequisites.trim(),
        comment: comment ? comment.trim() : "",
      },
      { new: true }
    );

    if (!updatedPaymentOption) {
      return res.status(404).json({ error: "Реквизит не найден" });
    }

    res.json(updatedPaymentOption);
  } catch (error) {
    console.error("Ошибка при изменении платежной опции:", error);
    res
      .status(500)
      .json({ error: "Ошибка сервера при изменении платежной опции" });
  }
});

// Переключение статуса платежной опции
app.put("/api/payment-options/:id/toggle", verifyToken, async (req, res) => {
  try {
    // Проверяем валидность ID
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        error: "Некорректный ID реквизита",
      });
    }

    // Находим пользователя и проверяем статус кошелька
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        error: "Пользователь не найден",
      });
    }

    if (user.walletStatus === 0) {
      return res.status(400).json({
        error: "Невозможно активировать реквизит, когда кошелек выключен",
        walletStatus: user.walletStatus,
      });
    }

    // Находим платежную опцию
    const paymentOption = await PaymentOption.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!paymentOption) {
      return res.status(404).json({
        error: "Реквизит не найден",
      });
    }

    // Проверяем лимиты перед активацией
    if (
      !paymentOption.isActive &&
      paymentOption.limit <= paymentOption.usedAmount
    ) {
      return res.status(400).json({
        error: "Невозможно активировать реквизит с исчерпанным лимитом",
        remainingLimit: paymentOption.limit - paymentOption.usedAmount,
      });
    }

    // Начинаем транзакцию
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Обновляем статус
      paymentOption.isActive = !paymentOption.isActive;

      // Если деактивируем, обновляем статус
      if (!paymentOption.isActive) {
        paymentOption.status = "disabled";
      } else {
        paymentOption.status = "available";
      }

      await paymentOption.save({ session });
      await session.commitTransaction();

      res.json({
        isActive: paymentOption.isActive,
        message: paymentOption.isActive
          ? "Реквизит успешно активирован"
          : "Реквизит успешно деактивирован",
        status: paymentOption.status,
        remainingLimit: paymentOption.limit - (paymentOption.usedAmount || 0),
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Ошибка при изменении статуса реквизита:", error);
    res.status(500).json({
      error: "Ошибка сервера при изменении статуса реквизита",
      details: error.message,
    });
  }
});

app.post("/api/create-payment-option", verifyToken, async (req, res) => {
  try {
    const { amount, customUrl } = req.body; // Извлекаем amount и customUrl из тела запроса

    // Проверка на корректность суммы
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Некорректная сумма" });
    }

    // Проверка на наличие customUrl
    if (
      !customUrl ||
      typeof customUrl !== "string" ||
      customUrl.trim().length === 0
    ) {
      return res.status(400).json({ error: "Кастомный URL обязателен" });
    }

    // Проверка наличия пользователя
    if (!req.user || !req.user._id) {
      return res.status(401).json({ error: "Пользователь не авторизован" });
    }

    // Находим все активные платежные опции с достаточным лимитом
    const availableOptions = await PaymentOption.find({
      isActive: true,
      limit: { $gte: amount },
    });

    if (!availableOptions || availableOptions.length === 0) {
      return res.status(404).json({
        error: "Нет доступных платежных опций с достаточным лимитом",
      });
    }

    // Выбираем случайную опцию из доступных
    const randomOption =
      availableOptions[Math.floor(Math.random() * availableOptions.length)];

    // Проверка на наличие randomOption
    if (!randomOption || !randomOption._id) {
      return res
        .status(404)
        .json({ error: "Выбранная платежная опция не найдена" });
    }

    // Создаем новую запись о выплате
    const newPaymentOption = new SuccessfulDeposit({
      userId: req.user._id,
      amount,
      customUrl,
      botRequisites: randomOption.botRequisites,
      paymentOptionId: randomOption._id, // Ссылка на платежную опцию
      bank: randomOption.bank, // Добавлено поле bank
      // Добавьте другие необходимые поля для записи о выплате
    });

    // Сохраняем новую запись о выплате в базе данных
    await newPaymentOption.save();

    res.status(201).json({
      id: randomOption._id,
      bank: randomOption.bank,
      amount,
      botRequisites: randomOption.botRequisites,
      usedAmount: randomOption.usedAmount,
      limit: randomOption.limit,
      customUrl, // Возвращаем customUrl в ответе
    });
  } catch (error) {
    console.error("Ошибка при создании платежной опции:", error);

    // Обработка ошибок валидации
    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ error: "Ошибка валидации данных", details: error.message });
    }

    // Обработка ошибок при сохранении в базе данных
    if (error.code === 11000) {
      // Код ошибки для дублирования
      return res.status(400).json({ error: "Кастомный URL уже используется." });
    }

    // Общая ошибка сервера
    return res.status(500).json({
      error: "Ошибка сервера при создании платежной опции",
      details: error.message,
    });
  }
});

// Обработчик подтверждения платежа
app.post("/api/confirm-payment/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;

  console.log("ID платежной опции:", id);
  console.log("Сумма:", amount);

  try {
    // Находим активный депозит без привязки к userId
    const existingDeposit = await SuccessfulDeposit.findOne({
      paymentOptionId: id,
      status: "active", // Ищем только активные депозиты
    });

    if (!existingDeposit) {
      console.log("Активный депозит не найден для paymentOptionId:", id);
      return res.status(404).json({ error: "Активный депозит не найден" });
    }

    // Обновляем статус существующего депозита
    existingDeposit.status = "completed"; // Обновляем статус
    existingDeposit.amount = amount; // Обновляем сумму, если это необходимо
    await existingDeposit.save(); // Сохраняем изменения

    // Логика обновления платежной опции
    const paymentOption = await PaymentOption.findById(id);
    if (!paymentOption) {
      console.log("Платежная опция не найдена для ID:", id);
      return res.status(404).json({ error: "Платежная опция не найдена" });
    }

    // Обновляем использованную сумму
    paymentOption.usedAmount += amount; // Увеличиваем на сумму платежа
    await paymentOption.save(); // Сохраняем изменения

    // Находим пользователя, чьи реквизиты были использованы
    const user = await User.findById(paymentOption.userId);
    if (!user) {
      console.log("Пользователь не найден для ID:", paymentOption.userId);
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Вычитаем сумму из баланса пользователя
    user.rubBalance -= amount; // Вычитаем из баланса в USDT
    user.usdtBalance -= amount / 90; // Делим сумму на 90 и вычитаем из баланса в рублях

    await user.save(); // Сохраняем изменения в балансе пользователя

    res.json({
      success: true,
      message: "Платеж подтвержден",
      depositId: existingDeposit._id,
      updatedDeposit: existingDeposit,
    });
  } catch (error) {
    console.error("Ошибка при подтверждении платежа:", error);
    res.status(500).json({ error: "Ошибка при подтверждении платежа" });
  }
});

app.post("/api/pending-payment/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Находим активный депозит без привязки к userId
    const existingDeposit = await SuccessfulDeposit.findOne({
      paymentOptionId: id,
      status: "active", // Ищем только активные депозиты
    });

    if (!existingDeposit) {
      console.log("Активный депозит не найден для paymentOptionId:", id);
      return res.status(404).json({ error: "Активный депозит не найден" });
    }

    // Обновляем статус существующего депозита на "pending"
    existingDeposit.status = "pending"; // Обновляем статус
    await existingDeposit.save(); // Сохраняем изменения

    res.json({
      success: true,
      message: "Статус платежа обновлен на 'pending'",
      depositId: existingDeposit._id,
      updatedDeposit: existingDeposit,
    });
  } catch (error) {
    console.error("Ошибка при обновлении статуса платежа:", error);
    res.status(500).json({ error: "Ошибка при обновлении статуса платежа" });
  }
});

// Периодическая проверка лимитов для всех активных реквизитов
const checkAndUpdatePaymentOptionLimits = async () => {
  try {
    const activeOptions = await PaymentOption.find({ isActive: true });

    for (const option of activeOptions) {
      const remainingLimit = option.limit - (option.usedAmount || 0);

      if (remainingLimit <= 0.01) {
        option.isActive = false;
        option.status = "completed";
        await option.save();
        console.log(
          `Реквизит ${option._id} деактивирован из-за исчерпания лимита`
        );
      }
    }
  } catch (error) {
    console.error("Ошибка при проверке лимитов реквизитов:", error);
  }
};

// Запускаем проверку каждые 2 минуты
setInterval(checkAndUpdatePaymentOptionLimits, 2 * 60 * 1000);

// Эндпоинт для получения успешных депозитов
app.get("/api/successful-deposits", verifyToken, async (req, res) => {
  try {
    console.log("Запрос на получение депозитов для пользователя:", req.user._id);

    // Находим все paymentOptionId, связанные с текущим пользователем
    const paymentOptions = await PaymentOption.find({ userId: req.user._id });
    const paymentOptionIds = paymentOptions.map(option => option._id);

    // Находим депозиты, связанные с этими paymentOptionIds
    const deposits = await SuccessfulDeposit.find({
      paymentOptionId: { $in: paymentOptionIds }, // Ищем депозиты с paymentOptionId из списка
      status: "completed",
    })
      .sort({ timestamp: -1 })
      .limit(10);

    console.log("Найдены депозиты:", deposits);
    res.json(deposits);
  } catch (error) {
    console.error("Ошибка при получении депозитов:", error);
    res.status(500).json({
      error: "Ошибка при получении депозитов",
      details: error.message,
    });
  }
});

// Функция для получения случайной платежной опции
async function getRandomPaymentOption(amount) {
  const availableOptions = await PaymentOption.find({
    isActive: true,
    limit: { $gte: amount },
  });

  if (availableOptions.length === 0) {
    return null;
  }

  return availableOptions[Math.floor(Math.random() * availableOptions.length)];
}

app.post("/api/payment-options/:id/toggle", verifyToken, async (req, res) => {
  try {
    const option = await PaymentOption.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!option) {
      return res.status(404).json({ error: "Реквизит не найден" });
    }

    option.isActive = !option.isActive;
    await option.save();

    res.json({
      message: `Реквизит ${option.isActive ? "активирован" : "деактивирован"}`,
      isActive: option.isActive,
    });
  } catch (error) {
    console.error("Ошибка при изменении статуса реквизита:", error);
    res
      .status(500)
      .json({ error: "Ошибка сервера при изменении статуса реквизита" });
  }
});

// Получение USDT адреса
app.post("/api/crypto/get-usdt-address", verifyToken, async (req, res) => {
  try {
    // Сначала ищем существующий адрес пользователя
    const user = await User.findById(req.user._id);
    let usdtAddress = user.getUsdtAddress(); // Используем метод из модели User

    if (!usdtAddress) {
      // Если адреса нет, генерируем новый
      const newWallet = usdtService.generateNewAddress();
      await user.updateUsdtAddress(newWallet.address);
      usdtAddress = newWallet.address;
    }

    // Получаем баланс
    const balance = await usdtService.getBalance(usdtAddress);

    res.json({
      address: usdtAddress,
      balance: balance,
    });
  } catch (error) {
    console.error("Ошибка при получении USDT адреса:", error);
    res.status(500).json({
      error: "Не удалось получить адрес. Попробуйте позже.",
    });
  }
});

// Обновление баланса пользователя
app.post("/api/update-balance", verifyToken, async (req, res) => {
  try {
    const { usdtBalance, rubBalance } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { usdtBalance, rubBalance },
      { new: true }
    );
    res.json({ usdtBalance: user.usdtBalance, rubBalance: user.rubBalance });
  } catch (error) {
    console.error("Ошибка при обновлении баланса:", error);
    res.status(500).json({ error: "Ошибка при обновлении баланса" });
  }
});

// Получение баланса пользователя
app.get("/api/get-balance", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({
      usdtBalance: parseFloat(user.usdtBalance || 0),
      rubBalance: parseFloat(user.rubBalance || 0),
    });
  } catch (error) {
    console.error("Ошибка при получении баланса:", error);
    res.status(500).json({ error: "Ошибка при получении баланса" });
  }
});

app.get("/api/user/usdt-address", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const usdtAddress = user.getUsdtAddress();
    if (!usdtAddress) {
      // Если адрес не найден, генерируем новый
      const newAddress = usdtService.generateNewAddress();
      await user.updateUsdtAddress(newAddress.address);

      return res.json({
        address: newAddress.address,
        isNew: true,
      });
    }

    // Получаем баланс адреса
    const balance = await usdtService.getBalance(usdtAddress);

    res.json({
      address: usdtAddress,
      balance: balance,
      isNew: false,
    });
  } catch (error) {
    console.error("Ошибка при получении USDT адреса:", error);
    res.status(500).json({ error: "Ошибка при получении USDT адреса" });
  }
});

app.get("/api/payment-options/random", async (req, res) => {
  console.log("Received request for random payment option");
  console.log("Query parameters:", req.query);

  try {
    const amount = parseFloat(req.query.amount);
    console.log("Parsed amount:", amount);

    if (isNaN(amount) || amount <= 0) {
      console.log("Invalid amount detected");
      return res.status(400).json({ error: "Некорректная сумма" });
    }

    // Получаем все реквизиты всех пользователей
    const allOptions = await PaymentOption.find({}).lean();
    console.log(`Total options found: ${allOptions.length}`);

    // Фильтруем активные реквизиты с достаточным лимитом
    const availableOptions = allOptions.filter((option) => {
      const remainingLimit = option.limit - (option.usedAmount || 0);
      const isAvailable =
        option.isActive && option.limit >= amount && remainingLimit >= amount;

      console.log(`Option ${option._id}:`, {
        name: option.name,
        isActive: option.isActive,
        limit: option.limit,
        usedAmount: option.usedAmount,
        remainingLimit,
        isAvailable,
      });

      return isAvailable;
    });

    console.log(`Available options: ${availableOptions.length}`);

    if (availableOptions.length === 0) {
      console.log("No available options found");
      return res.status(404).json({
        error: "Нет доступных реквизитов с достаточным остатком лимита",
        debug: {
          totalOptions: allOptions.length,
          activeOptions: allOptions.filter((o) => o.isActive).length,
          sufficientLimitOptions: allOptions.filter((o) => o.limit >= amount)
            .length,
        },
      });
    }

    const randomOption =
      availableOptions[Math.floor(Math.random() * availableOptions.length)];
    console.log("Selected random option:", randomOption);

    res.json(randomOption);
  } catch (error) {
    console.error("Ошибка при получении случайных реквизитов:", error);
    res.status(500).json({
      error: "Ошибка сервера при получении реквизитов",
      details: error.message,
    });
  }
});

app.get("/api/applications", verifyToken, async (req, res) => {
  console.log("Запрос на получение заявок:", req.query);
  try {
    const { type } = req.query;

    // Получаем платежные опции текущего пользователя
    const paymentOptions = await PaymentOption.find({ userId: req.user._id });
    const paymentOptionIds = paymentOptions.map((option) => option._id); // Получаем массив ID платежных опций

    // Базовые фильтры для запроса
    let query = { paymentOptionId: { $in: paymentOptionIds } }; // Фильтруем по ID платежных опций

    // Фильтрация в зависимости от типа
    switch (type) {
      case "all":
        // Получаем все заявки без фильтрации по статусу
        break; // Здесь ничего не меняем, так как уже фильтруем по paymentOptionId
      case "active":
        query.status = "active"; // Фильтруем по статусу "active"
        break;
      case "processing":
        query.status = "pending"; // Фильтруем по статусу "pending"
        break;
      case "closed":
        query.status = "completed"; // Фильтруем по статусу "completed"
        break;
      case "canceled":
        query.status = "canceled"; // Фильтруем по статусу "canceled"
        break;
      default:
        return res.status(400).json({
          error: "Некорректный тип заявки",
        });
    }

    // Получаем заявки с пагинацией и сортировкой
    const applications = await SuccessfulDeposit.find(query) // Используем правильную модель
      .sort({ createdAt: -1 }); // Сортировка по дате создания (новые первые)

    console.log("Найденные заявки:", applications); // Логируем найденные заявки

    const formattedApplications = applications.map((app) => ({
      id: app._id,
      sum: app.amount,
      status:
        app.status === "pending"
          ? "На проверке"
          : app.status === "canceled"
          ? "Отменено"
          : app.status === "completed"
          ? "Закрыто"
          : app.status,
      course: calculateCourse(app.amount),
      bank: app.bank,
      botRequisites: app.botRequisites,
      createdAt: app.createdAt,
      timestamp: app.timestamp,
    }));

    res.json(formattedApplications);
  } catch (error) {
    console.error("Ошибка при получении заявок:", error);
    res.status(500).json({
      error: "Ошибка сервера при получении заявок",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

app.patch("/api/applications/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    // Получаем платежные опции текущего пользователя
    const paymentOptions = await PaymentOption.find({ userId: req.user._id });
    const paymentOptionIds = paymentOptions.map((option) => option._id); // Получаем массив ID платежных опций

    // Проверяем, существует ли заявка и принадлежит ли она пользователю
    const application = await SuccessfulDeposit.findOneAndUpdate(
      { _id: id, paymentOptionId: { $in: paymentOptionIds } }, // Фильтруем по ID платежных опций
      { status },
      { new: true }
    );

    if (!application) {
      return res
        .status(404)
        .json({ error: "Заявка не найдена или не принадлежит вам" });
    }
    res.json(application);
  } catch (error) {
    console.error("Ошибка при обновлении заявки:", error);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Вспомогательная функция для преобразования статусов
function getStatusLabel(status) {
  const statusMap = {
    active: "Активно",
    processing: "Проверки",
    closed: "Закрыто",
    canceled: "Отменено",
  };
  return statusMap[status] || "Неизвестный статус";
}

// Функция для расчета курса (пример)
function calculateCourse(amount) {
  // Простой пример расчета курса
  // В реальном приложении это может быть более сложный алгоритм
  const baseRate = 90; // Курс рубля к доллару или другой логике
  return `$${(amount / baseRate).toFixed(2)}`;
}

// Дополнительный эндпоинт для получения количества заявок по статусам
app.get("/api/applications/count", verifyToken, async (req, res) => {
  try {
    const counts = await PaymentOption.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Преобразуем результат в более удобный формат
    const statusCounts = counts.reduce((acc, item) => {
      acc[getStatusLabel(item._id)] = item.count;
      return acc;
    }, {});

    res.json(statusCounts);
  } catch (error) {
    console.error("Ошибка при подсчете заявок:", error);
    res.status(500).json({
      error: "Ошибка сервера при подсчете заявок",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

function verify2FAToken(secret, token) {
  return speakeasy.totp.verify({
    secret: secret,
    encoding: "base32",
    token: token,
  });
}

// Эндпоинт для изменения пароля
app.put("/api/user/change-password", verifyToken, async (req, res) => {
  const { currentPassword, newPassword, token } = req.body;

  try {
    // Находим пользователя по ID из токена
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем текущий пароль
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: "Неверный текущий пароль" });
    }

    // Проверка на минимальную длину нового пароля
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Новый пароль должен содержать минимум 6 символов" });
    }

    // Проверка, что новый пароль не совпадает с текущим
    if (newPassword === currentPassword) {
      return res
        .status(400)
        .json({ error: "Новый пароль не может совпадать с текущим паролем" });
    }

    // Проверка на совпадение с предыдущими паролями
    const isOldPassword = await user.isOldPassword(newPassword);
    if (isOldPassword) {
      return res.status(400).json({
        error: "Новый пароль не может совпадать с одним из старых паролей",
      });
    }

    // Проверка кода 2FA, если он включен
    if (user.twoFAEnabled) {
      const isTokenValid = token && verify2FAToken(user.twoFASecret, token);
      if (!isTokenValid) {
        return res.status(400).json({ error: "Неверный код 2FA" });
      }
    }

    // Обновляем пароль пользователя
    user.password = newPassword; // Новый пароль будет хеширован в хуке pre-save
    await user.save(); // Сохраняем изменения в базе данных

    return res.status(200).json({ message: "Пароль успешно изменен" });
  } catch (error) {
    console.error("Ошибка при изменении пароля:", error);
    return res
      .status(500)
      .json({ error: "Ошибка сервера при изменении пароля" });
  }
});

// Эндпоинт для генерации секрета 2FA
app.get("/api/generate-2fa", verifyToken, async (req, res) => {
  const twoFASecret = speakeasy.generateSecret({ length: 20 });

  // Генерация QR-кода
  const otpauth = `otpauth://totp/${req.user.login}?secret=${twoFASecret.base32}&issuer=MMR-PAY`;
  const qrCodeUrl = await QRCode.toDataURL(otpauth);

  res.json({ qrCodeUrl, secret: twoFASecret.base32 }); // Возвращаем секрет и QR-код
});

app.post("/api/verify-2fa", verifyToken, async (req, res) => {
  const { token } = req.body; // Получаем токен из запроса

  try {
    // Проверка на наличие токена
    if (!token) {
      return res.status(400).json({ error: "Токен не предоставлен" });
    }

    // Проверка на длину токена
    if (token.length !== 6 || isNaN(token)) {
      return res.status(400).json({ error: "Код 2FA должен содержать 6 цифр" });
    }

    // Проверка на повторяющиеся цифры
    const isRepeated = /^(\d)\1{5}$/.test(token); // Проверка на 111111, 222222 и т.д.
    if (isRepeated) {
      return res
        .status(400)
        .json({ error: "Код не должен состоять из одинаковых цифр" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем, активирована ли 2FA
    if (!user.twoFAEnabled) {
      return res
        .status(400)
        .json({ error: "2FA не активирована для этого пользователя" });
    }

    // Проверка токена
    const verified = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: "base32",
      token: token,
    });

    if (!verified) {
      // Увеличиваем счетчик неудачных попыток
      user.failed2FAAttempts = (user.failed2FAAttempts || 0) + 1;
      await user.save();

      // Проверка на количество неудачных попыток
      if (user.failed2FAAttempts >= 5) {
        return res.status(403).json({
          error:
            "Слишком много неудачных попыток. Пожалуйста, попробуйте позже.",
        });
      }

      return res.status(400).json({ error: "Неверный код 2FA" });
    }

    // Сброс счетчика неудачных попыток при успешной проверке
    user.failed2FAAttempts = 0;
    await user.save();

    res.json({ message: "Код 2FA подтвержден" });
  } catch (error) {
    console.error("Ошибка при проверке кода 2FA:", error);
    res.status(500).json({ error: "Ошибка сервера при проверке кода 2FA" });
  }
});

// Эндпоинт для активации 2FA
app.post("/api/enable-2fa", verifyToken, async (req, res) => {
  const { token, secret } = req.body; // Получаем токен и секрет из запроса

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем, активирована ли 2FA
    if (user.twoFAEnabled) {
      return res.status(400).json({ error: "2FA уже активирована" });
    }

    // Проверяем токен
    const verified = speakeasy.totp.verify({
      secret: secret, // Используем секрет, переданный из клиента
      encoding: "base32",
      token: token,
    });

    if (!verified) {
      return res.status(400).json({ error: "Неверный код 2FA" });
    }

    // Если токен верный, активируем 2FA
    user.twoFAEnabled = true; // Устанавливаем 2FA как активированную
    user.twoFASecret = secret; // Сохраняем секрет
    await user.save();

    res.json({ message: "Двухфакторная аутентификация активирована" });
  } catch (error) {
    console.error("Ошибка при активации 2FA:", error);
    res.status(500).json({ error: "Ошибка сервера при активации 2FA" });
  }
});

app.post("/api/disable-2fa", verifyToken, async (req, res) => {
  const { token } = req.body; // Получаем токен из запроса

  try {
    // Проверка на наличие токена
    if (!token) {
      return res.status(400).json({ error: "Токен не предоставлен" });
    }

    // Проверка на длину токена
    if (!token || token.length !== 6 || !/^\d{6}$/.test(token)) {
      return res.status(400).json({ error: "Код 2FA должен содержать 6 цифр" });
    }

    // Получаем пользователя
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // Проверяем, активирована ли 2FA
    if (!user.twoFAEnabled) {
      return res
        .status(400)
        .json({ error: "2FA не активирована для этого пользователя" });
    }

    // Проверка токена
    const verified = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: "base32",
      token: token,
    });

    if (!verified) {
      return res.status(400).json({ error: "Неверный код 2FA" });
    }

    // Отключаем 2FA
    user.twoFAEnabled = false;
    user.twoFASecret = null; // Удаляем секрет, если это необходимо
    await user.save();

    res.json({ message: "2FA успешно отключена" });
  } catch (error) {
    console.error("Ошибка при отключении 2FA:", error);
    res.status(500).json({ error: "Ошибка сервера при отключении 2FA" });
  }
});

app.get("/api/user/twofa-status", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({ twoFAEnabled: user.twoFAEnabled });
  } catch (error) {
    console.error("Ошибка при получении статуса 2FA:", error);
    res.status(500).json({ error: "Ошибка сервера при получении статуса 2FA" });
  }
});

// Пример эндпоинта для получения данных пользователя
app.get("/api/user/settings", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password"); // Не возвращаем пароль
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json({
      _id: user._id,
      login: user.login,
      email: user.email,
      role: user.role,
      walletStatus: user.walletStatus,
      usdtBalance: user.usdtBalance,
      rubBalance: user.rubBalance,
      twoFAEnabled: user.twoFAEnabled,
      // Добавьте другие необходимые поля
    });
  } catch (error) {
    console.error("Ошибка при получении данных пользователя:", error);
    res
      .status(500)
      .json({ error: "Ошибка сервера при получении данных пользователя" });
  }
});

app.post("/account/verify-2fa", verifyToken, async (req, res) => {
  const { token, userId } = req.body;

  try {
    console.log("Проверка кода 2FA для пользователя:", userId);
    console.log("Отправленный токен:", token);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    if (!user.twoFAEnabled) {
      return res
        .status(400)
        .json({ error: "2FA не активирована для этого пользователя" });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: "base32",
      token: token,
      window: 1, // Увеличьте окно, если есть временные расхождения
    });

    console.log("Результат проверки кода 2FA:", verified);

    if (!verified) {
      return res.status(400).json({ error: "Неверный код 2FA" });
    }

    res.json({ success: true, message: "Код 2FA подтвержден" });
  } catch (error) {
    console.error("Ошибка при проверке кода 2FA:", error);
    res.status(500).json({ error: "Ошибка сервера при проверке кода 2FA" });
  }
});

// Маршрут для получения статистики закрытых заявок за день
app.get("/api/statistics/daily", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id; // Получаем userId из токена (предположим, что verifyToken добавляет его в req.user)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0); // Устанавливаем время на 00:00

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999); // Устанавливаем время на 23:59:59

    // Получаем все заявки за текущий день для конкретного пользователя
    const allTransactions = await SuccessfulDeposit.find({
      userId: userId, // Фильтруем по userId
      timestamp: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    });

    // Фильтруем закрытые и отмененные заявки
    const closedTransactions = allTransactions.filter(
      (transaction) => transaction.status === "completed"
    );
    const canceledTransactions = allTransactions.filter(
      (transaction) => transaction.status === "canceled"
    );

    // Суммируем суммы закрытых заявок
    const totalAmount = closedTransactions.reduce(
      (acc, transaction) => acc + transaction.amount,
      0
    );

    // Получаем статистику
    const totalClosedCount = closedTransactions.length; // Количество закрытых заявок
    const totalCanceledCount = canceledTransactions.length; // Количество отмененных заявок
    const totalAllCount = allTransactions.length; // Общее количество всех заявок

    res.status(200).json({
      totalAmount,
      totalClosedCount,
      totalCanceledCount,
      totalAllCount,
    });
  } catch (error) {
    console.error("Ошибка при получении статистики:", error);
    res.status(500).json({ error: "Ошибка сервера при получении статистики" });
  }
});

// Маршрут для получения статистики закрытых заявок за неделю
app.get("/api/statistics/weekly", async (req, res) => {
  try {
    const today = new Date();
    const dayOfWeek = today.getDay(); // Получаем текущий день недели (0 - воскресенье, 1 - понедельник, ..., 6 - суббота)

    // Устанавливаем начало недели (понедельник)
    const startOfWeek = new Date(today);
    startOfWeek.setDate(
      today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1)
    );
    startOfWeek.setHours(0, 0, 0, 0); // Устанавливаем время на 00:00

    // Устанавливаем конец недели (воскресенье)
    const endOfWeek = new Date(today);
    endOfWeek.setDate(startOfWeek.getDate() + 6); // Устанавливаем на 6 дней позже
    endOfWeek.setHours(23, 59, 59, 999); // Устанавливаем время на 23:59:59

    // Получаем все заявки за текущую неделю
    const allTransactions = await SuccessfulDeposit.find({
      timestamp: {
        $gte: startOfWeek,
        $lte: endOfWeek,
      },
    });

    // Фильтруем закрытые и отмененные заявки
    const closedTransactions = allTransactions.filter(
      (transaction) => transaction.status === "completed"
    );
    const canceledTransactions = allTransactions.filter(
      (transaction) => transaction.status === "canceled"
    );

    // Суммируем суммы закрытых заявок
    const totalAmount = closedTransactions.reduce(
      (acc, transaction) => acc + transaction.amount,
      0
    );

    // Получаем статистику
    const totalClosedCount = closedTransactions.length; // Количество закрытых заявок
    const totalCanceledCount = canceledTransactions.length; // Количество отмененных заявок
    const totalAllCount = allTransactions.length; // Общее количество всех заявок

    res.status(200).json({
      totalAmount,
      totalClosedCount,
      totalCanceledCount,
      totalAllCount,
    });
  } catch (error) {
    console.error("Ошибка при получении статистики:", error);
    res.status(500).json({ error: "Ошибка сервера при получении статистики" });
  }
});

// Маршрут для получения статистики закрытых заявок за месяц
app.get("/api/statistics/monthly", async (req, res) => {
  try {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1); // Устанавливаем на 1-е число текущего месяца
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0); // Устанавливаем на последний день текущего месяца
    endOfMonth.setHours(23, 59, 59, 999); // Устанавливаем время на 23:59:59

    // Получаем все заявки за текущий месяц
    const allTransactions = await SuccessfulDeposit.find({
      timestamp: {
        $gte: startOfMonth,
        $lte: endOfMonth,
      },
    });

    // Фильтруем закрытые и отмененные заявки
    const closedTransactions = allTransactions.filter(
      (transaction) => transaction.status === "completed"
    );
    const canceledTransactions = allTransactions.filter(
      (transaction) => transaction.status === "canceled"
    );

    // Суммируем суммы закрытых заявок
    const totalAmount = closedTransactions.reduce(
      (acc, transaction) => acc + transaction.amount,
      0
    );

    // Получаем статистику
    const totalClosedCount = closedTransactions.length; // Количество закрытых заявок
    const totalCanceledCount = canceledTransactions.length; // Количество отмененных заявок
    const totalAllCount = allTransactions.length; // Общее количество всех заявок

    res.status(200).json({
      totalAmount,
      totalClosedCount,
      totalCanceledCount,
      totalAllCount,
    });
  } catch (error) {
    console.error("Ошибка при получении статистики:", error);
    res.status(500).json({ error: "Ошибка сервера при получении статистики" });
  }
});

// Запуск сервера
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
