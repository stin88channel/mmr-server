const TronWeb = require('tronweb');

class UsdtService {
    constructor(privateKey) {
        this.tronWeb = new TronWeb({
            fullHost: 'https://api.trongrid.io',
            privateKey: privateKey
        });

        try {
            // Получаем основной адрес на основе предоставленного приватного ключа
            this.mainAddress = this.tronWeb.address.fromPrivateKey(privateKey);
            console.log('Сервис USDT был инициализирован:', this.mainAddress);
        } catch (error) {
            console.error('Error initializing USDT Service:', error);
            throw new Error('Failed to initialize USDT Service');
        }
    }

    // Генерация нового адреса
    generateNewAddress() {
        try {
            const account = this.tronWeb.utils.accounts.generateAccount();
            console.log('Сгенерирован новый USDT адрес:', account.address.base58);
            return {
                address: account.address.base58,
                privateKey: account.privateKey
            };
        } catch (error) {
            console.error('Произошла ошибка при создании USDT адреса:', error);
            throw new Error('Failed to generate new address');
        }
    }

    // Получение основного адреса
    getAddress() {
        return this.mainAddress;
    }

    // Получение баланса для указанного адреса
    async getBalance(address = this.mainAddress) {
        try {
            const contractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT контрактный адрес
            const contract = await this.tronWeb.contract().at(contractAddress);
            const balance = await contract.balanceOf(address).call();
            const usdtBalance = this.tronWeb.fromSun(balance.toString());

            console.log('USDT баланс:', usdtBalance);
            return usdtBalance;
        } catch (error) {
            console.error('Произошла ошибка при получении USDT баланса:', error);
            return '0';
        }
    }

    // Метод для проверки валидности адреса
    isValidAddress(address) {
        try {
            return this.tronWeb.isAddress(address);
        } catch (error) {
            console.error('Произошла ошибка при проверка на валидность адреса:', error);
            return false;
        }
    }
}

module.exports = UsdtService;