const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');
const { Int64LE } = require('int64-buffer');
const { Address } = require('@ton/core');
const { sha256_sync } = require('@ton/crypto');
const fetch = require('node-fetch');
const { Buffer } = require('buffer');

const API = {
    WALLET: "https://wallet-domain.blum.codes/api/v1",
    USER: "https://user-domain.blum.codes/api/v1",
    GAME: "https://game-domain.blum.codes/api/v1",
    MANIFEST: "https://telegram.blum.codes/tonconnect-manifest.json"
};

function hexToUint8Array(hex) {
    if (hex.length % 2 !== 0) {
        throw new Error('Invalid hex string');
    }
    const byteArray = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        byteArray[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return byteArray;
}

function getTimeSec() {
    return Math.floor(Date.now() / 1000);
}

function getDomainFromURL(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        throw new Error(`Invalid URL: ${url}`);
    }
}

function createTonProofItem(manifest, address, secretKey, payload) {
    try {
        const addr = Address.parse(address);
        const workchain = addr.workChain;
        const addrHash = addr.hash;

        const timestamp = getTimeSec();
        const timestampBuffer = new Int64LE(timestamp).toBuffer();

        const domain = getDomainFromURL(manifest);
        const domainBuffer = Buffer.from(domain);
        const domainLengthBuffer = Buffer.allocUnsafe(4);
        domainLengthBuffer.writeInt32LE(domainBuffer.byteLength);

        const addressWorkchainBuffer = Buffer.allocUnsafe(4);
        addressWorkchainBuffer.writeInt32BE(workchain);

        const addressBuffer = Buffer.concat([
            addressWorkchainBuffer,
            addrHash
        ]);

        const messageBuffer = Buffer.concat([
            Buffer.from('ton-proof-item-v2/'),
            addressBuffer,
            domainLengthBuffer,
            domainBuffer,
            timestampBuffer,
            Buffer.from(payload),
        ]);

        const message = sha256_sync(messageBuffer);
        const bufferToSign = Buffer.concat([
            Buffer.from('ffff', 'hex'),
            Buffer.from('ton-connect'),
            message,
        ]);

        const signedMessage = sha256_sync(bufferToSign);
        const signed = nacl.sign.detached(signedMessage, secretKey);

        return {
            name: 'ton_proof',
            proof: {
                timestamp,
                domain: {
                    lengthBytes: domainBuffer.byteLength,
                    value: domain,
                },
                signature: naclUtil.encodeBase64(signed),
                payload,
            },
        };

    } catch (e) {
        console.error(`CreateTonProof Error:`, e.message);
        return null;
    }
}

function generateTonProof(manifest, wallet) {
    try {
        const payload = Date.now().toString();
        const privateKey = hexToUint8Array(wallet.private_key);
        const parsedAddress = Address.parse(wallet.address);
        return createTonProofItem(manifest, parsedAddress.toString(), privateKey, payload);
    } catch (e) {
        console.error(`GenerateTonProof Error:`, e.message);
        return null;
    }
}

class BlumService {
    constructor() {
        this.baseHeaders = {
            "accept": "application/json, text/plain, */*",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            "lang": "en",
            "origin": "https://telegram.blum.codes",
            "priority": "u=1, i",
            "sec-ch-ua": '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99", "Microsoft Edge WebView2";v="130"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
        };
        this.token = null;
        this.wallet = null;
    }

    init(token, wallet) {
        this.token = token;
        this.wallet = wallet;
        return this;
    }

    getAuthHeaders() {
        return this.token
            ? { ...this.baseHeaders, Authorization: `Bearer ${this.token}` }
            : this.baseHeaders;
    }

    async getNewToken(queryId) {
        const url = `${API.USER}/auth/provider/PROVIDER_TELEGRAM_MINI_APP`;
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: this.baseHeaders,
                body: JSON.stringify({ query: queryId }),
            });

            if (response.ok) {
                const responseJson = await response.json();
                return responseJson.token.refresh;
            }
            console.error(`Failed to get token: ${response.status}`);
            return null;
        } catch (e) {
            console.error(`Error getting token: ${e.message}`);
            return null;
        }
    }

    async checkWalletConnection() {
        if (!this.token) {
            return false;
        }

        const url = `${API.WALLET}/wallet/status`;
        try {
            const response = await fetch(url, {
                method: "GET",
                headers: this.getAuthHeaders(),
            });

            if (response.ok) {
                const data = await response.json();
                return data.isConnected || false;
            }
            return false;
        } catch (e) {
            console.error(`Error checking wallet status: ${e.message}`);
            return false;
        }
    }

    async connectWallet() {
        if (!this.wallet || !this.token) {
            console.error("Wallet or token not provided");
            return false;
        }

        try {
            // Check if wallet is already connected
            const isConnected = await this.checkWalletConnection();
            if (isConnected) {
                console.log("Wallet is already connected");
                return true;
            }

            const url = `${API.WALLET}/wallet/connect`;
            const parsedAddress = Address.parse(this.wallet.address);
            const rawAddress = parsedAddress.toString();
            const privateKeyBytes = hexToUint8Array(this.wallet.private_key);
            const keyPair = nacl.sign.keyPair.fromSecretKey(privateKeyBytes);
            const publicKey = Buffer.from(keyPair.publicKey).toString('hex');
            
            const tonProof = generateTonProof(API.MANIFEST, {
                ...this.wallet,
                address: rawAddress
            });

            if (!tonProof) {
                throw new Error("Failed to generate TON proof");
            }

            const data = {
                account: {
                    address: rawAddress,
                    chain: "-239",
                    publicKey: publicKey
                },
                tonProof
            };

            const response = await fetch(url, {
                method: "POST",
                headers: this.getAuthHeaders(),
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                const errorText = await response.text();
                try {
                    const errorJson = JSON.parse(errorText);
                    if (errorJson.message === "wallet already connected") {
                        console.log("Wallet is already connected");
                        return true;
                    }
                } catch (e) {
                    throw new Error(`Connect failed: ${errorText}`);
                }
            }

            return true;
        } catch (e) {
            if (e.message.includes("wallet already connected")) {
                console.log("Wallet is already connected");
                return true;
            }
            console.error(`Error connecting wallet:`, e);
            return false;
        }
    }

    async disconnectWallet() {
        if (!this.token) {
            console.error("Token not provided");
            return false;
        }

        const url = `${API.WALLET}/wallet/disconnect`;
        try {
            const response = await fetch(url, {
                method: "DELETE",
                headers: this.getAuthHeaders(),
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                try {
                    const errorJson = JSON.parse(errorText);
                    if (errorJson.message === "wallet not connected") {
                        console.log("Wallet is already disconnected");
                        return true;
                    }
                } catch (e) {
                    throw new Error(`Disconnect failed: ${errorText}`);
                }
            }
            
            return true;
        } catch (e) {
            console.error(`Error disconnecting wallet: ${e.message}`);
            return false;
        }
    }

    async getBalance() {
        if (!this.token) {
            console.error("Token not provided");
            return null;
        }

        const url = `${API.GAME}/user/balance`;
        try {
            const response = await fetch(url, {
                headers: this.getAuthHeaders(),
            });

            if (response.ok) {
                return await response.json();
            }
            console.error(`Failed to get balance: ${response.status}`);
            return null;
        } catch (e) {
            console.error(`Error getting balance: ${e.message}`);
            return null;
        }
    }
}

module.exports = {
    BlumService,
    generateTonProof,
    API
};
