const nacl = require('tweetnacl');
const { Address } = require('@ton/core');
const { sha256_sync } = require('@ton/crypto');
const axios = require('axios');
const { Buffer } = require('buffer');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const readline = require('readline');
const { mnemonicToWalletKey } = require('@ton/crypto');
const { 
    WalletContractV4,
    WalletContractV3R2,
    WalletContractV5R1
} = require('@ton/ton');

const API = {
    BASE_URL: "https://bi.yescoin.gold",
    MANIFEST: "https://www.yescoin.gold/tonconnect-manifest.json"
};

// Constants
const DEFAULT_WALLET_ID = 698983191;
const MAX_RETRIES = 3;
const BASE_DELAY = 2000;
const TIMEOUT = 10000;

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
        this.logFile = 'yescoin_errors.log';
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    logError(error, context = '') {
        const timestamp = new Date().toISOString();
        const errorMessage = `[${timestamp}] ${context}: ${error.message}\n`;
        fs.appendFileSync(this.logFile, errorMessage);
    }

    formatLoginPayload(encodedData) {
        try {
            const decodedData = decodeURIComponent(encodedData.trim());
            if (!decodedData) {
                throw new Error('Empty login code after decoding');
            }
            return { code: decodedData };
        } catch (error) {
            this.logError(error, 'formatLoginPayload');
            throw new Error(`Invalid login code format: ${error.message}`);
        }
    }

    async login(encodedData, proxy = null) {
        if (!encodedData) {
            throw new Error('Login code is required');
        }

        const url = `${API.BASE_URL}/user/login`;
        let retries = MAX_RETRIES;
        let lastError;

        while (retries > 0) {
            try {
                // Random delay between 1-3 seconds before each attempt
                await this.delay(Math.random() * 2000 + 1000);

                const formattedPayload = this.formatLoginPayload(encodedData);
                const config = {
                    headers: this.baseHeaders,
                    timeout: TIMEOUT
                };

                if (proxy) {
                    config.httpsAgent = new HttpsProxyAgent(proxy);
                }

                const response = await axios.post(url, formattedPayload, config);

                if (response.data.code === 0 && response.data.data?.token) {
                    this.token = response.data.data.token;
                    return this.token;
                } else {
                    throw new Error(response.data.message || 'Invalid response format');
                }
            } catch (error) {
                lastError = error;
                retries--;
                
                if (retries > 0) {
                    const backoffDelay = BASE_DELAY * (MAX_RETRIES - retries);
                    await this.delay(backoffDelay);
                    continue;
                }
                
                this.logError(error, `Login attempt for code: ${encodedData}`);
                break;
            }
        }

        throw new Error(`Login failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
    }

    init(token, wallet) {
        if (!token || !wallet) {
            throw new Error('Token and wallet are required for initialization');
        }
        this.token = token;
        this.wallet = wallet;
        return this;
    }

    getAuthHeaders() {
        if (!this.token) {
            throw new Error('No token available');
        }
        return { ...this.baseHeaders, token: this.token };
    }

    async connectWallet() {
        return this.bindWallet();
    }

    formatAddresses(address) {
        try {
            const parsedAddress = Address.parse(address);
            return {
                friendlyAddress: parsedAddress.toString({ urlSafe: true, bounceable: false }),
                rawAddress: `0:${parsedAddress.hash.toString('hex')}`
            };
        } catch (error) {
            this.logError(error, 'formatAddresses');
            throw new Error(`Failed to format addresses: ${error.message}`);
        }
    }

    async bindWallet() {
        if (!this.wallet || !this.token) {
            throw new Error("Wallet or token not provided");
        }

        let retries = MAX_RETRIES;
        while (retries > 0) {
            try {
                const url = `${API.BASE_URL}/wallet/bind`;
                const parsedAddress = Address.parse(this.wallet.address);
                
                const payload = {
                    walletType: 1,
                    publicKey: this.wallet.publicKey || 
                              Buffer.from(this.wallet.private_key, 'hex')
                                    .slice(32)
                                    .toString('hex'),
                    friendlyAddress: parsedAddress.toString({ 
                        urlSafe: true, 
                        bounceable: false 
                    }),
                    rawAddress: `0:${parsedAddress.hash.toString('hex')}`
                };

                const response = await axios.post(url, payload, {
                    headers: this.getAuthHeaders(),
                    timeout: TIMEOUT
                });

                if (response.data.code === 0) {
                    return true;
                }

                throw new Error(response.data.message || 'Bind failed');
            } catch (error) {
                retries--;
                if (retries > 0) {
                    await this.delay(BASE_DELAY * (MAX_RETRIES - retries));
                    continue;
                }
                this.logError(error, 'bindWallet');
                return false;
            }
        }
        return false;
    }

    async disconnectWallet() {
        return this.unbindWallet();
    }

    async unbindWallet() {
        if (!this.token) {
            throw new Error("Token not provided");
        }

        let retries = MAX_RETRIES;
        while (retries > 0) {
            try {
                const url = `${API.BASE_URL}/wallet/unbind`;
                const response = await axios.post(url, {}, {
                    headers: this.getAuthHeaders(),
                    timeout: TIMEOUT
                });

                if (response.data.code === 0) {
                    return true;
                }
                throw new Error(response.data.message || 'Unbind failed');
            } catch (error) {
                retries--;
                if (retries > 0) {
                    await this.delay(BASE_DELAY * (MAX_RETRIES - retries));
                    continue;
                }
                this.logError(error, 'unbindWallet');
                return false;
            }
        }
        return false;
    }

    async getWalletStatus() {
        if (!this.token) {
            throw new Error("Token not provided");
        }

        let retries = MAX_RETRIES;
        while (retries > 0) {
            try {
                const url = `${API.BASE_URL}/wallet/status`;
                const response = await axios.get(url, {
                    headers: this.getAuthHeaders(),
                    timeout: TIMEOUT
                });

                if (response.data.code === 0) {
                    return response.data.data;
                }
                throw new Error(response.data.message || 'Status check failed');
            } catch (error) {
                retries--;
                if (retries > 0) {
                    await this.delay(BASE_DELAY * (MAX_RETRIES - retries));
                    continue;
                }
                this.logError(error, 'getWalletStatus');
                return null;
            }
        }
        return null;
    }
}

// Helper functions for wallet processing
async function getWalletAddressFromSeed(mnemonic, version) {
    try {
        const keyPair = await mnemonicToWalletKey(mnemonic);
        const workchain = 0;
        let wallet;

        switch (version.toLowerCase()) {
            case 'v3r2':
                wallet = WalletContractV3R2.create({
                    workchain,
                    publicKey: keyPair.publicKey,
                    walletId: DEFAULT_WALLET_ID
                });
                break;
            case 'v4':
                wallet = WalletContractV4.create({
                    workchain,
                    publicKey: keyPair.publicKey,
                    walletId: DEFAULT_WALLET_ID
                });
                break;
            case 'v5':
                wallet = WalletContractV5R1.create({
                    workchain,
                    publicKey: keyPair.publicKey,
                    walletId: DEFAULT_WALLET_ID
                });
                break;
            default:
                throw new Error('Unsupported wallet version');
        }

        return wallet.address.toString({ urlSafe: true, bounceable: false });
    } catch (error) {
        console.error('Error generating wallet address:', error);
        throw error;
    }
}

async function processWalletData(walletData, version) {
    try {
        const mnemonicArray = walletData.mnemonic.trim().split(' ');
        if (mnemonicArray.length !== 24) {
            throw new Error('Invalid seed phrase length - must be 24 words');
        }

        const keyPair = await mnemonicToWalletKey(mnemonicArray);
        const address = await getWalletAddressFromSeed(mnemonicArray, version);

        return {
            address: address,
            private_key: Buffer.from(keyPair.secretKey).toString('hex')
        };
    } catch (error) {
        console.error('Error processing wallet data:', error);
        throw error;
    }
}

// Export all necessary components
module.exports = {
    YesCoinService,
    API,
    getWalletAddressFromSeed,
    processWalletData
};
