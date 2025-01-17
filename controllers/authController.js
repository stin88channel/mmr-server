const User = require("../models/User");
const { comparePassword } = require("../helpers/auth");
const jwt = require("jsonwebtoken");

const test = (req, res) => {
  res.json("test is working");
};

// Register EndPoint
const registerUser = async (req, res) => {
  try {
    const { login, email, password } = req.body;

    // Проверка входных данных
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

    // Создание нового пользователя
    const user = await User.create({
      login,
      email,
      password,
      auth: false,
    });

    res.status(201).json({
      message: "Регистрация успешна",
      user: {
        _id: user._id,
        login: user.login,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Ошибка при регистрации:", error);
    res.status(500).json({ error: "Ошибка сервера при регистрации" });
  }
};

// Login EndPoint
const loginUser = async (req, res) => {
  try {
    const { login, password } = req.body;

    console.log("Получены данные для входа:", {
      login,
      passwordLength: password ? password.length : 0,
    });

    // Проверка наличия обязательных полей
    if (!login || !password) {
      console.log("Отсутствуют обязательные поля");
      return res.status(400).json({
        error: "Все поля обязательны для заполнения",
      });
    }

    // Проверка минимальной длины пароля
    if (password.length < 6) {
      console.log("Пароль слишком короткий");
      return res.status(400).json({
        error: "Пароль должен содержать минимум 6 символов",
      });
    }

    // Поиск пользователя
    const user = await User.findOne({ login: login.trim() });

    console.log("Результат поиска пользователя:", {
      found: !!user,
      userId: user ? user._id : null,
      userLogin: user ? user.login : null,
    });

    if (!user) {
      return res.status(400).json({
        error: "Неверный логин или пароль",
      });
    }

    // Проверка блокировки пользователя
    if (user.isBlocked && user.blockedUntil > new Date()) {
      console.log("Попытка входа в заблокированный аккаунт");
      return res.status(403).json({
        error: "Аккаунт заблокирован",
        reason: user.blockReason,
        unblockTime: user.blockedUntil,
      });
    }

    // Проверка пароля
    const isMatch = await user.comparePassword(password);
    console.log("Результат проверки пароля:", isMatch);

    if (!isMatch) {
      // Увеличиваем счетчик неудачных попыток
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

      if (user.failedLoginAttempts >= 5) {
        user.isBlocked = true;
        user.blockedUntil = new Date(Date.now() + 30 * 60000); // блокировка на 30 минут
        user.blockReason = "Превышено количество попыток входа";
        await user.save();

        return res.status(403).json({
          error:
            "Аккаунт временно заблокирован из-за множества неудачных попыток входа",
        });
      }

      await user.save();
      return res.status(400).json({
        error: "Неверный логин или пароль",
        attemptsLeft: 5 - user.failedLoginAttempts,
      });
    }

    // Сброс счетчика неудачных попыток при успешном входе
    user.failedLoginAttempts = 0;

    // Создание токена
    const token = jwt.sign(
      {
        id: user._id,
        login: user.login,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Обновление статуса auth и времени последнего входа
    user.auth = 1;
    user.lastLoginAt = new Date();
    await user.save();

    // Отправка ответа
    res.json({
      _id: user._id,
      login: user.login,
      role: user.role,
      auth: user.auth,
      walletStatus: user.walletStatus,
      token,
      lastLogin: user.lastLoginAt,
    });

    console.log("Успешный вход пользователя:", {
      userId: user._id,
      userLogin: user.login,
      userRole: user.role,
    });
  } catch (error) {
    console.error("Критическая ошибка при входе:", error);
    res.status(500).json({
      error: "Ошибка сервера при входе",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const logoutUser = async (req, res) => {
  try {
    const { token } = req.cookies;
    if (!token) {
      return res.status(400).json({ error: "Не авторизован" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (user) {
      user.auth = false;
      await user.save();
    }

    res.clearCookie("token");
    res.json({ message: "Выход выполнен успешно" });
  } catch (error) {
    console.error("Ошибка при выходе:", error);
    res.status(500).json({ error: "Ошибка сервера при выходе" });
  }
};

module.exports = {
  test,
  registerUser,
  loginUser,
  getProfile,
  logoutUser,
};
