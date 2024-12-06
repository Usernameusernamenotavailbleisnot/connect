const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');
const { Int64LE } = require('int64-buffer');
const { Address, Cell, beginCell } = require('@ton/core');
const { sha256_sync, mnemonicToWalletKey } = require('@ton/crypto');
const { WalletContractV4, WalletContractV3R2, WalletContractV5R1 } = require('@ton/ton');
const fetch = require('node-fetch');
const { Buffer } = require('buffer');

const API = {
    BASE: "https://notpx.app/api/v1",
    MANIFEST: "https://app.notpx.app/tonconnect-manifest.json"
};

const DEFAULT_WALLET_ID = 698983191;

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

class NotPixelService {
    constructor() {
        this.baseHeaders = {
            "accept": "application/json, text/plain, */*",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            "origin": "https://app.notpx.app",
            "priority": "u=1, i",
            "sec-ch-ua": '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24", "Microsoft Edge WebView2";v="131"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
            "referer": "https://app.notpx.app/"
        };
        this.initData = null;
        this.wallet = null;
        this.keyPair = null;
        this.lastError = null;
    }

    async getStateInit(walletContract) {
        try {
            const stateInitCell = beginCell()
                .storeBit(0)      // split_depth = 0
                .storeBit(0)      // special = 0
                .storeBit(1)      // code cell present
                .storeBit(1)      // data cell present
                .storeBit(0)      // no library
                .storeRef(walletContract.init.code)    
                .storeRef(walletContract.init.data)    
                .endCell();

            return stateInitCell.toBoc().toString('base64');
        } catch (error) {
            console.error('Error generating stateInit:', error);
            throw error;
        }
    }

    async init(initData, walletData) {
        try {
            this.initData = initData;
            
            const mnemonicArray = walletData.mnemonic.trim().split(' ');
            if (mnemonicArray.length !== 24) {
                throw new Error('Invalid seed phrase length - must be 24 words');
            }

            this.keyPair = await mnemonicToWalletKey(mnemonicArray);
            const workchain = 0;

            const walletContract = WalletContractV4.create({
                workchain,
                publicKey: this.keyPair.publicKey,
                walletId: DEFAULT_WALLET_ID
            });

            const stateInit = await this.getStateInit(walletContract);

            this.wallet = {
                address: walletContract.address.toString({ urlSafe: true, bounceable: false }),
                private_key: Buffer.from(this.keyPair.secretKey).toString('hex'),
                state_init: stateInit
            };

            //console.log('Wallet:', this.wallet.address);

            return true;
        } catch (error) {
            this.lastError = error.message;
            return false;
        }
    }

    getAuthHeaders() {
        let authValue = this.initData;
        if (!authValue.startsWith('initData')) {
            authValue = `initData ${authValue}`;
        }
        
        return {
            ...this.baseHeaders,
            "authorization": authValue
        };
    }

    async generateTonProof() {
        try {
            const generatePayloadUrl = `${API.BASE}/wallet/ton-proof/generate-payload`;
            const response = await fetch(generatePayloadUrl, {
                method: 'POST',
                headers: this.getAuthHeaders()
            });

            const result = await response.json();
            const payload = result.payload;

            if (!payload) {
                throw new Error('Failed to get payload from server');
            }

            const parsedAddress = Address.parse(this.wallet.address);
            const timestamp = Math.floor(Date.now() / 1000);
            const domain = "app.notpx.app";
            const domainLen = domain.length;

            const workchainBuffer = Buffer.allocUnsafe(4);
            workchainBuffer.writeInt32BE(parsedAddress.workChain);
            const addressBuffer = Buffer.concat([workchainBuffer, parsedAddress.hash]);
            
            const domainBuffer = Buffer.from(domain);
            const domainLengthBuffer = Buffer.allocUnsafe(4);
            domainLengthBuffer.writeInt32LE(domainBuffer.byteLength);
            
            const timestampBuffer = new Int64LE(timestamp).toBuffer();
            const payloadBuffer = Buffer.from(payload);

            const message = Buffer.concat([
                Buffer.from('ton-proof-item-v2/'),
                addressBuffer,
                domainLengthBuffer,
                domainBuffer,
                timestampBuffer,
                payloadBuffer
            ]);

            const messageHash = sha256_sync(message);
            const finalMessage = Buffer.concat([
                Buffer.from([0xff, 0xff]),
                Buffer.from('ton-connect'),
                messageHash
            ]);

            const signedMessage = sha256_sync(finalMessage);
            const signature = nacl.sign.detached(signedMessage, this.keyPair.secretKey);

            return {
                address: parsedAddress.toString(),
                network: "-239",
                proof: {
                    timestamp,
                    domain: {
                        lengthBytes: domainLen,
                        value: domain
                    },
                    signature: naclUtil.encodeBase64(signature),
                    payload,
                    state_init: this.wallet.state_init
                }
            };
        } catch (error) {
            this.lastError = 'Failed to generate TonProof';
            return null;
        }
    }

    async verifyTonProof(proofData) {
        try {
            const verifyUrl = `${API.BASE}/wallet/ton-proof/check-proof`;
            const response = await fetch(verifyUrl, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(proofData)
            });

            const result = await response.json();

            if (result.error && result.error.includes('duplicate key value violates unique constraint')) {
                this.lastError = 'This wallet is already connected to a Telegram account. Please use a different wallet or disconnect the existing one first.';
                return false;
            }

            if (!result.success) {
                this.lastError = result.error || 'Failed to verify proof';
                return false;
            }

            return true;
        } catch (error) {
            this.lastError = 'Failed to verify TonProof';
            return false;
        }
    }

    async checkWalletVerification() {
        try {
            const checkUrl = `${API.BASE}/mining/task/check/walletVerification`;
            const response = await fetch(checkUrl, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });

            if (!response.ok) {
                this.lastError = 'Failed to check wallet verification';
                return false;
            }

            const result = await response.json();
            return result.walletVerification || false;
        } catch (error) {
            this.lastError = 'Check wallet verification error';
            return false;
        }
    }

    async connectWallet() {
        try {
            const proofData = await this.generateTonProof();
            if (!proofData) {
                return false;
            }

            const verified = await this.verifyTonProof(proofData);
            if (!verified) {
                return false;
            }

            const isVerified = await this.checkWalletVerification();
            if (!isVerified) {
                this.lastError = 'Wallet verification failed';
                return false;
            }

            return true;
        } catch (error) {
            this.lastError = 'Failed to connect wallet';
            return false;
        }
    }

    async disconnectWallet() {
        return true;
    }

    getLastError() {
        return this.lastError;
    }
}

module.exports = {
    NotPixelService,
    API
};
