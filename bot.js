const readline = require('readline');
const fs = require('fs');
const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');
const { Int64LE } = require('int64-buffer');
const { mnemonicToWalletKey } = require('@ton/crypto');
const { 
    TonClient4,
    WalletContractV4,
    WalletContractV3R2,
    WalletContractV5R1
} = require('@ton/ton');
const { Address } = require('@ton/core');
const { sha256_sync } = require('@ton/crypto');
const fetch = require('node-fetch');
const { Buffer } = require('buffer');

process.noDeprecation = true;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const DEFAULT_WALLET_ID = 698983191;
const API = {
    WALLET: "https://wallet-domain.blum.codes/api/v1",
    USER: "https://user-domain.blum.codes/api/v1",
    GAME: "https://game-domain.blum.codes/api/v1",
    MANIFEST: "https://telegram.blum.codes/tonconnect-manifest.json"
};

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

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

function getPublicKey(privateKeyHex) {
    const privateKeyBytes = hexToUint8Array(privateKeyHex);
    const keyPair = nacl.sign.keyPair.fromSecretKey(privateKeyBytes);
    return Buffer.from(keyPair.publicKey).toString('hex');
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
                    // If error text is not JSON, throw original error
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
        console.error('Detailed error:', error);
        throw new Error(`Error generating wallet address: ${error.message}`);
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
        throw new Error(`Error processing wallet data: ${error.message}`);
    }
}

async function selectWalletVersion() {
    console.log("\n" + "=".repeat(50));
    console.log("Select Wallet Version".padStart(30));
    console.log("=".repeat(50));
    
    const version = await askQuestion(
        "Choose wallet version:\n" +
        "1. V3R2\n" +
        "2. V4\n" +
        "3. V5\n" +
        "Select (1-3): "
    );

    switch (version) {
        case "1": return "v3r2";
        case "2": return "v4";
        case "3": return "v5";
        default: return "v4"; // Default to v4 if invalid selection
    }
}

async function mainMenu() {
    console.log("\n" + "=".repeat(50));
    console.log("Main Menu".padStart(30));
    console.log("=".repeat(50));
    return askQuestion(
        "Choose an action:\n" +
        "1. Connect wallets\n" +
        "2. Disconnect wallets\n" +
        "3. Display all wallets\n" +
        "0. Exit\n" +
        "Enter choice (1-3, 0): "
    );
}

function loadData() {
    try {
        // Read seeds from seed.txt
        const seeds = fs.readFileSync('seed.txt', 'utf8')
            .split('\n')
            .filter(line => line.trim());

        const queryIds = fs.readFileSync('query.txt', 'utf8')
            .split('\n')
            .filter(line => line.trim());

        if (seeds.length !== queryIds.length) {
            throw new Error(
                `Mismatch between seeds (${seeds.length}) and query (${queryIds.length}) count`
            );
        }

        // Convert seeds to wallet data format
        const walletData = seeds.map(seed => ({
            mnemonic: seed
        }));

        return { walletData, queryIds };
    } catch (error) {
        console.error(`❌ Error loading data: ${error.message}`);
        return null;
    }
}

async function processWallets(action, queryIds, walletData, version) {
    console.log("\n" + "=".repeat(90));
    console.log(`${action === "1" ? "Connecting" : action === "2" ? "Disconnecting" : "Displaying"} ${version.toUpperCase()} Wallets`.padStart(55));
    console.log("=".repeat(90) + "\n");

    let totalBalance = 0;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < queryIds.length; i++) {
        console.log(`\nProcessing Wallet ${i + 1}/${queryIds.length}`);
        console.log("-".repeat(30));

        const blumService = new BlumService();
        const token = await blumService.getNewToken(queryIds[i]);

        if (!token) {
            console.log(`❌ Account ${i + 1} - Failed to get token`);
            failCount++;
            continue;
        }

        try {
            const processedWallet = await processWalletData(walletData[i], version);
            const service = blumService.init(token, processedWallet);

            if (action === "1") {
                const connected = await service.connectWallet();
                if (connected) {
                    console.log(`✅ Account ${i + 1} - Wallet connection successful`);
                    console.log(`   Seed: ${walletData[i].mnemonic.substring(0, 20)}...`);
                    console.log(`   Address: ${processedWallet.address}`);

                    const balanceInfo = await service.getBalance();
                    if (balanceInfo) {
                        const balance = parseFloat(balanceInfo.availableBalance);
                        totalBalance += balance;
                        console.log(`   Balance: ${balance}`);
                    }
                    successCount++;
                } else {
                    console.log(`❌ Account ${i + 1} - Failed to connect wallet`);
                    failCount++;
                }
            } else if (action === "2") {
                const disconnected = await service.disconnectWallet();
                if (disconnected) {
                    console.log(`✅ Account ${i + 1} - Wallet disconnected successfully`);
                    successCount++;
                } else {
                    console.log(`❌ Account ${i + 1} - Failed to disconnect wallet`);
                    failCount++;
                }
            } else {
                console.log(`Account ${i + 1}:`);
                console.log(`Seed: ${walletData[i].mnemonic.substring(0, 20)}...`);
                console.log(`Address: ${processedWallet.address}`);
                const balanceInfo = await service.getBalance();
                if (balanceInfo) {
                    console.log(`Balance: ${balanceInfo.availableBalance}`);
                }
                successCount++;
            }
        } catch (error) {
            console.error(`❌ Account ${i + 1} - Error: ${error.message}`);
            failCount++;
        }
    }

    // Print summary
    console.log("\n" + "=".repeat(50));
    if (action === "1") {
        console.log(`Total Balance: ${totalBalance.toFixed(2)}`.padStart(35));
    }
    console.log(`Success: ${successCount} | Failed: ${failCount}`.padStart(35));
    console.log("=".repeat(50));
}

async function main() {
    try {
        const version = await selectWalletVersion();
        console.log(`Selected version: ${version.toUpperCase()}`);

        const data = loadData();
        if (!data) {
            throw new Error('Failed to load data');
        }

        const { walletData, queryIds } = data;
        console.log(`Loaded ${walletData.length} wallet(s) with matching queries`);

        while (true) {
            const action = await mainMenu();
            
            if (action === "0") {
                console.log("Exiting program. Goodbye!");
                break;
            }

            if (["1", "2", "3"].includes(action)) {
                await processWallets(action, queryIds, walletData, version);
                
                const postAction = await askQuestion(
                    "\nChoose an action:\n" +
                    "1. Back to main menu\n" +
                    "2. Exit\n" +
                    "Enter choice (1-2): "
                );
                
                if (postAction === "2") {
                    console.log("Exiting program. Goodbye!");
                    break;
                }
            } else {
                console.log("Invalid option. Please try again.");
            }
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
    } finally {
        rl.close();
    }
}

// Start the program
main();

// Export all necessary functions
module.exports = {
    generateTonProof,
    BlumService,
    getWalletAddressFromSeed,
    processWalletData,
    selectWalletVersion,
    mainMenu,
    loadData,
    processWallets,
    main
};