const TronWeb = require("tronweb");
const axios = require("axios");

class UsdtPayment {
    constructor(privateKeyHex = null) {
        this.tronWeb = new TronWeb({
            fullHost: "https://api.trongrid.io",
        });

        if (privateKeyHex == null) {
            this.privateKey = privateKeyHex;
        } else {
            this.privateKey =
                this.tronWeb.utils.accounts.generateAccount().privateKey;
        }
        this.address = this.tronWeb.address.fromPrivateKey(this.privateKey);
        console.log(this.address);
        this.TRONSCAN_API_URL = "https://apilist.tronscan.org/api/account";
    }

    getPrivateKey() {
        return {
            private_key: this.privateKey,
            public_key: this.address,
        };
    }

    getAddress() {
        return this.address;
    }

    async checkBalance() {
        const tokenSymbol = "USDT";
        const payload = { address: this.address };

        try {
            const response = await axios.get(this.TRONSCAN_API_URL, {
                params: payload,
            });
            const balances = response.data.trc20token_balances;

            const tokenBalance = balances.find(
                (item) => item.tokenAbbr === tokenSymbol,
            );
            if (tokenBalance) {
                return parseInt(tokenBalance.balance) / 1_000_000;
            }
        } catch (error) {
            console.error(error);
            return 0;
        }

        return 0;
    }
}

module.exports = UsdtPayment;