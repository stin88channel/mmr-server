const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const UserSchema = new mongoose.Schema({
  login: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: (v) => /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(v),
      message: (props) => `${props.value} не является корректным email!`,
    },
  },
  password: {
    type: String,
    required: true,
  },
  oldPasswords: {
    type: [String],
    default: [],
  },
  auth: {
    type: Number,
    default: 0,
  },
  walletStatus: {
    type: Number,
    default: 0,
  },
  usdtBalance: {
    type: Number,
    default: 0,
  },
  rubBalance: {
    type: Number,
    default: 0,
  },
  frozenBalanceRub: {
    type: Number,
    default: 0,
  },
  frozenBalanceUsdt: {
    type: Number,
    default: 0,
  },
  balance: {
    type: Number,
    default: 0,
  },
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },
  unreadNotifications: {
    type: Number,
    default: 0,
  },
  failedLoginAttempts: {
    type: Number,
    default: 0,
  },
  lastLoginDevice: {
    deviceType: String,
    os: String,
    browser: String,
    ip: String,
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
  },
  loginHistory: [
    {
      deviceType: String,
      os: String,
      browser: String,
      ip: String,
      timestamp: {
        type: Date,
        default: Date.now,
      },
      status: {
        type: String,
        enum: ["success", "failed"],
        default: "success",
      },
    },
  ],
  cryptoAddresses: [
    {
      address: {
        type: String,
        required: true,
      },
      currency: {
        type: String,
        required: true,
        enum: ["USDT"],
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  paymentOptions: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentOption",
    },
  ],
  transactions: [
    {
      type: {
        type: String,
        enum: ["deposit", "withdrawal"],
        required: true,
      },
      amount: {
        type: Number,
        required: true,
      },
      currency: {
        type: String,
        enum: ["RUB", "USDT"],
        required: true,
      },
      status: {
        type: String,
        enum: ["pending", "completed", "failed"],
        default: "pending",
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
      paymentOptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PaymentOption",
      },
      description: {
        type: String,
      },
    },
  ],
  isBlocked: {
    type: Boolean,
    default: false,
  },
  blockReason: String,
  blockedUntil: Date,
  twoFAEnabled: {
    type: Boolean,
    default: false,
  },
  twoFASecret: {
    type: String,
    default: null,
  },
});

// Хук перед сохранением для хеширования пароля
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(this.password, salt);

    // Проверка на количество старых паролей
    if (this.oldPasswords.length >= 15) {
      this.oldPasswords.shift(); // Удаляем самый старый пароль, если их больше 15
    }

    // Добавляем новый хеш пароля в массив старых паролей
    this.oldPasswords.push(newPasswordHash);

    this.password = newPasswordHash; // Обновляем пароль на хешированный
    next();
  } catch (error) {
    return next(error);
  }
});

// Метод для сравнения паролей
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Метод для проверки, не совпадает ли новый пароль с одним из старых
UserSchema.methods.isOldPassword = async function (newPassword) {
  for (const oldPassword of this.oldPasswords) {
    if (await bcrypt.compare(newPassword, oldPassword)) {
      return true; // Новый пароль совпадает с одним из старых
    }
  }
  return false; // Новый пароль не совпадает с ни одним из старых
};

// Метод для обновления баланса
UserSchema.methods.updateBalance = async function (
  amount,
  currency = "RUB",
  type = "deposit"
) {
  const oldBalance = this[`${currency.toLowerCase()}Balance`] || 0;
  if (type === "deposit") {
    this[`${currency.toLowerCase()}Balance`] = oldBalance + amount;
  } else if (type === "withdrawal") {
    if (oldBalance < amount) {
      throw new Error("Недостаточно средств");
    }
    this[`${currency.toLowerCase()}Balance`] = oldBalance - amount;
  }

  // Обновляем общий баланс
  this.balance = this.usdtBalance * 90 + this.rubBalance;

  await this.save();
  return this[`${currency.toLowerCase()}Balance`];
};

// Метод для добавления транзакции
UserSchema.methods.addTransaction = async function (
  type,
  amount,
  currency,
  paymentOptionId = null,
  description = ""
) {
  const transaction = {
    type,
    amount,
    currency,
    paymentOptionId,
    description,
    status: "pending",
  };

  this.transactions.push(transaction);
  await this.save();
  return this.transactions[this.transactions.length - 1];
};

// Метод для обновления статуса транзакции
UserSchema.methods.updateTransactionStatus = async function (
  transactionId,
  status
) {
  const transaction = this.transactions.id(transactionId);
  if (!transaction) {
    throw new Error("Транзакция не найдена");
  }
  transaction.status = status;
  await this.save();
  return transaction;
};

// Метод для получения истории транзакций
UserSchema.methods.getTransactionHistory = function (filter = {}) {
  return this.transactions
    .filter((t) => {
      for (let key in filter) {
        if (t[key] !== filter[key]) return false;
      }
      return true;
    })
    .sort((a, b) => b.timestamp - a.timestamp);
};

// Метод для подсчета общего баланса
UserSchema.methods.calculateTotalBalance = function () {
  return this.usdtBalance * 90 + this.rubBalance;
};

// Метод для добавления криптоадреса
UserSchema.methods.addCryptoAddress = async function (
  address,
  currency = "USDT"
) {
  const existingAddress = this.cryptoAddresses.find(
    (addr) => addr.address === address && addr.currency === currency
  );

  if (!existingAddress) {
    this.cryptoAddresses.push({
      address,
      currency,
      createdAt: new Date(),
    });
    await this.save();
  }

  return this.cryptoAddresses;
};

// Метод для получения криптоадресов
UserSchema.methods.getCryptoAddresses = function (currency) {
  return currency
    ? this.cryptoAddresses.filter((addr) => addr.currency === currency)
    : this.cryptoAddresses;
};

// Метод для получения USDT адреса
UserSchema.methods.getUsdtAddress = function () {
  const usdtAddress = this.cryptoAddresses.find(
    (addr) => addr.currency === "USDT"
  );
  return usdtAddress ? usdtAddress.address : null;
};

// Метод для обновления USDT адреса
UserSchema.methods.updateUsdtAddress = async function (newAddress) {
  const existingAddress = this.cryptoAddresses.find(
    (addr) => addr.currency === "USDT"
  );
  if (existingAddress) {
    existingAddress.address = newAddress;
  } else {
    this.cryptoAddresses.push({
      address: newAddress,
      currency: "USDT",
      createdAt: new Date(),
    });
  }
  await this.save();
  return this.getUsdtAddress();
};

// Метод для проверки устройства
UserSchema.methods.isDeviceAllowed = function (deviceInfo) {
  return (
    !this.lastLoginDevice ||
    (this.lastLoginDevice.deviceType === deviceInfo.deviceType &&
      this.lastLoginDevice.os === deviceInfo.os &&
      this.lastLoginDevice.browser === deviceInfo.browser)
  );
};

// Метод для обновления информации об устрой стве
UserSchema.methods.updateLoginDevice = async function (deviceInfo) {
  this.lastLoginDevice = {
    ...deviceInfo,
    lastLoginAt: new Date(),
  };

  this.loginHistory.push({
    ...deviceInfo,
    timestamp: new Date(),
    status: "success",
  });

  // Храним только последние 10 записей
  if (this.loginHistory.length > 10) {
    this.loginHistory = this.loginHistory.slice(-10);
  }

  await this.save();
};

// Метод для записи неудачной попытки входа
UserSchema.methods.recordFailedLogin = async function (deviceInfo) {
  this.loginHistory.push({
    ...deviceInfo,
    timestamp: new Date(),
    status: "failed",
  });

  // Проверка на подозрительную активность
  const recentFailures = this.loginHistory.filter(
    (log) => log.status === "failed" && new Date() - log.timestamp < 3600000 // последний час
  );

  if (recentFailures.length >= 5) {
    this.isBlocked = true;
    this.blockReason = "Слишком много неудачных попыток входа";
    this.blockedUntil = new Date(Date.now() + 3600000); // блокировка на час
  }

  await this.save();
};

// Индексы для оптимизации запросов
UserSchema.index({ login: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ "cryptoAddresses.currency": 1 });
UserSchema.index({ "cryptoAddresses.address": 1 });
UserSchema.index({ "lastLoginDevice.lastLoginAt": 1 });
UserSchema.index({ isBlocked: 1 });

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
