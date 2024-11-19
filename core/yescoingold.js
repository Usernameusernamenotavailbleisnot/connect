const nacl = require('tweetnacl');
const { Address } = require('@ton/core');
const { sha256_sync } = require('@ton/crypto');
const axios = require('axios');
const { Buffer } = require('buffer');
const { HttpsProxyAgent } = require('https-proxy-agent');

const API = {
    BASE_URL: "https://bi.yescoin.gold",
    MANIFEST: "https://www.yescoin.gold/tonconnect-manifest.json"
};

class YesCoinService {
    constructor() {
        this.baseHeaders = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            'content-type': 'application/json',
            'origin': 'https://www.yescoin.gold',
            'referer': 'https://www.yescoin.gold/',
            'sec-ch-ua': '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99", "Microsoft Edge WebView2";v="130"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
        };
        this.token = null;
        this.wallet = null;
    }

    formatLoginPayload(encodedData) {
        const decodedData = decodeURIComponent(encodedData);
        return { code: decodedData };
    }

    async login(encodedData, proxy = null) {
        const url = `${API.BASE_URL}/user/login`;
        const formattedPayload = this.formatLoginPayload(encodedData);

        try {
            const config = {
                headers: this.baseHeaders
            };

            if (proxy) {
                config.httpsAgent = new HttpsProxyAgent(proxy);
            }

            const response = await axios.post(url, formattedPayload, config);
            
            if (response.data.code === 0) {
                const token = response.data.data.token;
                this.token = token;
                return token;
            } else {
                throw new Error(`Login failed: ${response.data.message}`);
            }
        } catch (error) {
            console.error('Login error:', error.response?.data || error.message);
            return null;
        }
    }

    init(token, wallet) {
        this.token = token;
        this.wallet = wallet;
        return this;
    }

    getAuthHeaders() {
        return this.token
            ? { ...this.baseHeaders, token: this.token }
            : this.baseHeaders;
    }

    async connectWallet() {
        return this.bindWallet();
    }

    formatAddresses(address) {
        const parsedAddress = Address.parse(address);
        return {
            friendlyAddress: parsedAddress.toString({ urlSafe: true, bounceable: false }),
            rawAddress: `0:${parsedAddress.hash.toString('hex')}`
        };
    }
    
    async bindWallet() {
        if (!this.wallet || !this.token) {
            throw new Error("Wallet or token not provided");
        }

        try {
            const url = `${API.BASE_URL}/wallet/bind`;
            const parsedAddress = Address.parse(this.wallet.address);
            
            const payload = {
                walletType: 1,
                publicKey: this.wallet.publicKey || Buffer.from(this.wallet.private_key, 'hex').slice(32).toString('hex'),
                friendlyAddress: parsedAddress.toString({ urlSafe: true, bounceable: false }),
                rawAddress: `0:${parsedAddress.hash.toString('hex')}`
            };

            // console.log('Binding wallet with payload:', JSON.stringify(payload, null, 2));

            const response = await axios.post(url, payload, {
                headers: this.getAuthHeaders()
            });

            if (response.data.code === 0) {
                return true;
            }
            
            console.error('Bind response:', response.data);
            throw new Error(response.data.message || 'Bind failed');
        } catch (error) {
            console.error('Bind wallet error:', error.response?.data || error.message);
            return false;
        }
    }

    async disconnectWallet() {
        return this.unbindWallet();
    }

    async unbindWallet() {
        if (!this.token) {
            throw new Error("Token not provided");
        }

        try {
            const url = `${API.BASE_URL}/wallet/unbind`;
            const response = await axios.post(url, {}, {
                headers: this.getAuthHeaders()
            });

            if (response.data.code === 0) {
                return true;
            }
            throw new Error(response.data.message || 'Unbind failed');
        } catch (error) {
            console.error('Unbind wallet error:', error.response?.data || error.message);
            return false;
        }
    }

    async getWalletStatus() {
        if (!this.token) {
            throw new Error("Token not provided");
        }

        try {
            const url = `${API.BASE_URL}/wallet/status`;
            const response = await axios.get(url, {
                headers: this.getAuthHeaders()
            });

            if (response.data.code === 0) {
                return response.data.data;
            }
            throw new Error(response.data.message || 'Status check failed');
        } catch (error) {
            console.error('Get wallet status error:', error.response?.data || error.message);
            return null;
        }
    }
}

module.exports = {
    YesCoinService,
    API
};
