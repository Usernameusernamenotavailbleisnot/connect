const axios = require('axios');
const { Address, Cell, beginCell, storeStateInit } = require('@ton/core');
const { sha256_sync, mnemonicToWalletKey } = require('@ton/crypto');
const { Int64LE } = require('int64-buffer');
const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');
const { 
    WalletContractV4,
    WalletContractV3R2,
    WalletContractV5R1
} = require('@ton/ton');

class SeedDaoService {
    constructor() {
        this.baseUrl = 'https://alb.seeddao.org/api/v1';
        this.token = null;
        this.wallet = null;
        this.manifest = 'https://cf.seeddao.org/tonconnect-manifest.json';
        this.walletVersion = null;
        this.keyPair = null;
    }

    async init(token, wallet, version = 'v4') {
        try {
            if (!wallet.mnemonic) {
                throw new Error('No mnemonic provided in wallet data');
            }

            this.token = token;
            this.wallet = wallet;
            this.walletVersion = version;
            
            const mnemonicArray = wallet.mnemonic.trim().split(' ');
            if (mnemonicArray.length !== 24) {
                throw new Error('Invalid mnemonic length - must be 24 words');
            }
            
            this.keyPair = await mnemonicToWalletKey(mnemonicArray);
            return true;
        } catch (error) {
            console.error('Failed to initialize SeedDAO service:', error.message);
            return false;
        }
    }

    getHeaders() {
        if (!this.token) {
            throw new Error('Token is not initialized');
        }

        return {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            'content-type': 'application/json',
            'telegram-data': this.token,
            'origin': 'https://cf.seeddao.org',
            'referer': 'https://cf.seeddao.org/',
            'sec-ch-ua': '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99", "Microsoft Edge WebView2";v="130"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
        };
    }

    async getWalletContract() {
        try {
            const workchain = 0;
            
            switch (this.walletVersion.toLowerCase()) {
                case 'v3r2':
                    return WalletContractV3R2.create({
                        workchain,
                        publicKey: this.keyPair.publicKey,
                        walletId: 698983191
                    });
                case 'v4':
                    return WalletContractV4.create({
                        workchain,
                        publicKey: this.keyPair.publicKey,
                        walletId: 698983191
                    });
                case 'v5':
                    return WalletContractV5R1.create({
                        workchain,
                        publicKey: this.keyPair.publicKey,
                        walletId: 698983191
                    });
                default:
                    throw new Error(`Unsupported wallet version: ${this.walletVersion}`);
            }
        } catch (error) {
            console.error('Error creating wallet contract:', error);
            throw error;
        }
    }

    async getStateInit() {
        try {
            // Create wallet contract using the correct version and parameters
            const wallet = await this.getWalletContract();

            // Create state init cell with the specific structure from wallet contract
            const stateInitCell = beginCell()
                .storeBit(0)      // split_depth = 0
                .storeBit(0)      // special = 0
                .storeBit(1)      // code cell present
                .storeBit(1)      // data cell present
                .storeBit(0)      // no library
                .storeRef(wallet.init.code)    // Store code cell from wallet contract
                .storeRef(wallet.init.data)    // Store data cell from wallet contract
                .endCell();

            // Convert to base64 with standard TON BOC serialization
            const serializedCell = stateInitCell.toBoc().toString('base64');
            
            return serializedCell;

        } catch (error) {
            console.error('Error generating stateInit:', error);
            throw error;
        }
    }

    async createTonProofItem(initPayload) {
        try {
            if (!initPayload) {
                throw new Error('Init payload is required');
            }

            const timestamp = Math.floor(Date.now() / 1000);
            const domain = 'cf.seeddao.org';
            
            const wallet = await this.getWalletContract();
            console.log('Wallet contract created');
            
            // Get raw address buffer directly from wallet
            const workchain = wallet.address.workChain;
            const addrHash = wallet.address.hash;
            
            //console.log('Address components:', {
            //    workchain,
             //   hash: addrHash.toString('hex')
            //});
            
            // Create address buffer
            const workchainBuffer = Buffer.allocUnsafe(4);
            workchainBuffer.writeInt32BE(workchain);
            const addressBuffer = Buffer.concat([
                workchainBuffer,
                addrHash
            ]);

            // Create domain buffer
            const domainBuffer = Buffer.from(domain);
            const domainLengthBuffer = Buffer.allocUnsafe(4);
            domainLengthBuffer.writeInt32LE(domainBuffer.byteLength);

            // Create timestamp buffer
            const timestampBuffer = new Int64LE(timestamp).toBuffer();

            ////console.log('Creating message with payload:', initPayload);

            // Create message buffer
            const messageBuffer = Buffer.concat([
                Buffer.from('ton-proof-item-v2/'),
                addressBuffer,
                domainLengthBuffer,
                domainBuffer,
                timestampBuffer,
                Buffer.from(initPayload)
            ]);

            const message = sha256_sync(messageBuffer);
            const bufferToSign = Buffer.concat([
                Buffer.from('ffff', 'hex'),
                Buffer.from('ton-connect'),
                message
            ]);

            const signedMessage = sha256_sync(bufferToSign);
            const signature = nacl.sign.detached(signedMessage, this.keyPair.secretKey);
            
            // Get stateInit
            const stateInit = await this.getStateInit();
            
            return {
                timestamp,
                domain: {
                    lengthBytes: domainBuffer.byteLength,
                    value: domain,
                },
                signature: naclUtil.encodeBase64(signature),
                payload: initPayload,
                stateInit: stateInit
            };

        } catch (error) {
            console.error('CreateTonProof Error:', error);
            throw error;
        }
    }

    async connectWallet() {
        try {
            console.log('Starting wallet connection process...');
            
            const initData = await this.initWalletConnection();
            if (!initData) {
                throw new Error('Failed to initialize wallet connection');
            }
           // console.log('Got init data:', initData);

            const wallet = await this.getWalletContract();
            const proof = await this.createTonProofItem(initData);
            
            // Format address properly
            const address = `${wallet.address.workChain}:${wallet.address.hash.toString('hex')}`;
            
            // console.log('Using wallet address:', address);

            const payload = {
                address: address,
                network: "-239",
                proof: proof
            };

            // console.log('Sending connect payload:', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                `${this.baseUrl}/profile/wallets/ton`,
                payload,
                { headers: this.getHeaders() }
            );

            // console.log('Connect response:', response.data);
            return response.data.data.wallet_address_ton === address;

        } catch (error) {
            if (error.response?.data) {
                console.error('Connect wallet error:', error.response.data);
            } else {
                console.error('Connect wallet error:', error.message);
            }
            return false;
        }
    }

    async initWalletConnection() {
        try {
            console.log('Initializing wallet connection...');
            const response = await axios.post(
                `${this.baseUrl}/profile/wallets/ton/init`,
                {},
                { headers: this.getHeaders() }
            );
            
            if (!response.data || !response.data.data) {
                throw new Error('Invalid init response');
            }
            
            // console.log('Init response payload:', response.data.data);
            return response.data.data;
        } catch (error) {
            console.error('Init wallet connection error:', error.response?.data || error.message);
            return null;
        }
    }

    async disconnectWallet() {
        try {
            const response = await axios.post(
                `${this.baseUrl}/profile/wallets/ton/disconnect`,
                {},
                { headers: this.getHeaders() }
            );
            return response.data.data !== null;
        } catch (error) {
            console.error('Failed to disconnect wallet:', error.response?.data || error.message);
            return false;
        }
    }

    async checkWalletConnection() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/profile2`,
                { headers: this.getHeaders() }
            );
            return response.data.data.wallet_address_ton !== null;
        } catch (error) {
            console.error('Failed to check wallet connection:', error.response?.data || error.message);
            return false;
        }
    }
}

module.exports = { SeedDaoService };
