const readline = require('readline');
const fs = require('fs');
const { mnemonicToWalletKey } = require('@ton/crypto');
const { 
    WalletContractV4,
    WalletContractV3R2,
    WalletContractV5R1
} = require('@ton/ton');
const { Buffer } = require('buffer');
const { BlumService } = require('./core/blum');
const { YesCoinService } = require('./core/yescoingold');
const { TsubasaService } = require('./core/tsubasa');
const { PawsService } = require('./core/paws');
const { SeedDaoService } = require('./core/seeddao');
const { ClaytonService } = require('./core/clayton');


process.noDeprecation = true;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const DEFAULT_WALLET_ID = 698983191;

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
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

async function selectPlatform() {
    console.log("\n" + "=".repeat(50));
    console.log("Select Platform".padStart(30));
    console.log("=".repeat(50));
    
    const platform = await askQuestion(
        "Choose platform:\n" +
        "1. Blum\n" +
        "2. YesCoin\n" +
        "3. Tsubasa\n" +
        "4. PAWS\n" +
        "5. SeedDAO\n" + 
        "6. Clayton\n" + // Tambahkan ini
        "Select (1-6): " // Update range
    );

    switch (platform) {
        case "2": return "yescoin";
        case "3": return "tsubasa";
        case "4": return "paws";
        case "5": return "seeddao";
        case "6": return "clayton"; // Tambahkan ini
        default: return "blum";
    }
}

async function getServiceInstance(platform, token, wallet) {
    switch (platform) {
        case "yescoin":
            const yesService = new YesCoinService();
            return yesService.init(token, wallet);
        case "tsubasa":
            const tsubasaService = new TsubasaService();
            return tsubasaService.init(token, wallet);
        case "paws":
            const pawsService = new PawsService();
            return pawsService.init(token, wallet);
        case "seeddao":
            const seedDaoService = new SeedDaoService();
            return seedDaoService.init(token, wallet);
        case "clayton": // Tambahkan ini
            const claytonService = new ClaytonService();
            return claytonService.init(token, wallet);
        default:
            const blumService = new BlumService();
            return blumService.init(token, wallet);
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

function loadData(platform) {
    try {
        if (platform === 'paws' || platform === 'clayton') {
            const wallets = fs.readFileSync('wallet.txt', 'utf8')
                .split('\n')
                .filter(line => line.trim());

            const queryIds = fs.readFileSync('query.txt', 'utf8')
                .split('\n')
                .filter(line => line.trim());

            if (wallets.length !== queryIds.length) {
                throw new Error(
                    `Mismatch between wallets (${wallets.length}) and query (${queryIds.length}) count`
                );
            }

            const walletData = wallets.map(address => ({
                address: address.trim()
            }));

            console.log(`Loaded ${wallets.length} wallet(s) with matching queries`);
            return { walletData, queryIds };
        } else {
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

            const walletData = seeds.map(seed => ({
                mnemonic: seed
            }));

            console.log(`Loaded ${seeds.length} wallet(s) with matching queries`);
            return { walletData, queryIds };
        }
    } catch (error) {
        console.error(`❌ Error loading data: ${error.message}`);
        return null;
    }
}

async function processWallets(action, queryIds, walletData, version, platform) {
    console.log("\n" + "=".repeat(90));
    console.log(`${action === "1" ? "Connecting" : action === "2" ? "Disconnecting" : "Displaying"} ${platform === "paws" || platform === "clayton" ? "" : version.toUpperCase() + " "}Wallets on ${platform.toUpperCase()}`.padStart(55));
    console.log("=".repeat(90) + "\n");

    let totalBalance = 0;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < queryIds.length; i++) {
        console.log(`\nProcessing Wallet ${i + 1}/${queryIds.length}`);
        console.log("-".repeat(30));

        try {
            let processedWallet;
            let service;

            if (platform === 'paws') {
                const walletAddress = walletData[i].address;
                if (!walletAddress) {
                    console.log(`❌ Account ${i + 1} - Invalid wallet address`);
                    failCount++;
                    continue;
                }

                processedWallet = { address: walletAddress };
                service = new PawsService();
                const pawsToken = await service.login(queryIds[i]);
                
                if (!pawsToken) {
                    console.log(`❌ Account ${i + 1} - Failed to login`);
                    failCount++;
                    continue;
                }

                const initialized = await service.init(pawsToken, processedWallet);
                if (!initialized) {
                    console.log(`❌ Account ${i + 1} - Failed to initialize service`);
                    failCount++;
                    continue;
                }
            } else if (platform === 'clayton') {
                const walletAddress = walletData[i].address;
                if (!walletAddress) {
                    console.log(`❌ Account ${i + 1} - Invalid wallet address`);
                    failCount++;
                    continue;
                }

                processedWallet = { address: walletAddress };
                service = new ClaytonService();
                const initialized = await service.init(queryIds[i], processedWallet);
                
                if (!initialized) {
                    console.log(`❌ Account ${i + 1} - Failed to initialize Clayton service`);
                    failCount++;
                    continue;
                }
            } else if (platform === 'seeddao') {
                try {
                    if (!version) {
                        console.log(`❌ Account ${i + 1} - No wallet version specified`);
                        failCount++;
                        continue;
                    }

                    const mnemonic = walletData[i].mnemonic.trim();
                    if (!mnemonic) {
                        console.log(`❌ Account ${i + 1} - Invalid mnemonic`);
                        failCount++;
                        continue;
                    }

                    console.log(`Processing ${version.toUpperCase()} wallet...`);
                    processedWallet = await processWalletData({ mnemonic }, version);
                    
                    service = new SeedDaoService();
                    const initialized = await service.init(queryIds[i], {
                        ...processedWallet,
                        mnemonic
                    }, version);

                    if (!initialized) {
                        console.log(`❌ Account ${i + 1} - Failed to initialize SeedDAO service`);
                        failCount++;
                        continue;
                    }

                } catch (error) {
                    console.log(`❌ Account ${i + 1} - Error processing wallet: ${error.message}`);
                    failCount++;
                    continue;
                }
            } else if (platform === "tsubasa") {
                processedWallet = await processWalletData(walletData[i], version);
                service = new TsubasaService();
                await service.init(queryIds[i], processedWallet);
            } else if (platform === "yescoin") {
                processedWallet = await processWalletData(walletData[i], version);
                service = new YesCoinService();
                const token = await service.login(queryIds[i]);
                if (!token) {
                    console.log(`❌ Account ${i + 1} - Failed to login`);
                    failCount++;
                    continue;
                }
                await service.init(token, processedWallet);
            } else {
                processedWallet = await processWalletData(walletData[i], version);
                service = new BlumService();
                const token = await service.getNewToken(queryIds[i]);
                if (!token) {
                    console.log(`❌ Account ${i + 1} - Failed to get token`);
                    failCount++;
                    continue;
                }
                await service.init(token, processedWallet);
            }

            if (action === "1") {
                console.log('Attempting to connect wallet...');
                const connected = await service.connectWallet();
                if (connected) {
                    console.log(`✅ Account ${i + 1} - Wallet connection successful`);
                    if (platform === 'paws' || platform === 'clayton') {
                        console.log(`   Address: ${processedWallet.address}`);
                    } else {
                        console.log(`   Seed: ${walletData[i].mnemonic.substring(0, 20)}...`);
                        console.log(`   Address: ${processedWallet.address}`);
                    }

                    if (platform === "blum" && typeof service.getBalance === 'function') {
                        const balanceInfo = await service.getBalance();
                        if (balanceInfo) {
                            const balance = parseFloat(balanceInfo.availableBalance);
                            totalBalance += balance;
                            console.log(`   Balance: ${balance}`);
                        }
                    }
                    successCount++;
                } else {
                    console.log(`❌ Account ${i + 1} - Failed to connect wallet`);
                    failCount++;
                }
            } else if (action === "2") {
                console.log('Attempting to disconnect wallet...');
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
                if (platform === 'paws' || platform === 'clayton') {
                    console.log(`Address: ${processedWallet.address}`);
                } else {
                    console.log(`Seed: ${walletData[i].mnemonic.substring(0, 20)}...`);
                    console.log(`   Address: ${processedWallet.address}`);
                }
                successCount++;
            }

            // Add delay between processing wallets
            if (i < queryIds.length - 1) {
                const delay = Math.floor(Math.random() * (3000 - 1000 + 1)) + 1000;
                console.log(`Waiting ${delay}ms before processing next wallet...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }

        } catch (error) {
            console.error(`❌ Account ${i + 1} - Error:`, error);
            console.error('Stack trace:', error.stack);
            failCount++;
        }
    }

    // Print summary
    console.log("\n" + "=".repeat(50));
    if (action === "1" && platform === "blum") {
        console.log(`Total Balance: ${totalBalance.toFixed(2)}`.padStart(35));
    }
    console.log(`Success: ${successCount} | Failed: ${failCount}`.padStart(35));
    console.log("=".repeat(50));

    return { successCount, failCount, totalBalance };
}

async function main() {
    try {
        // Platform Selection
        const platform = await selectPlatform();
        console.log(`Selected platform: ${platform.toUpperCase()}`);

        // Version Selection (skip for PAWS only)
        let version = null;
        if (platform !== 'paws') {
            version = await selectWalletVersion();
            console.log(`Selected version: ${version.toUpperCase()}`);
        }

        // Load data from files
        const data = loadData(platform);
        if (!data) {
            throw new Error('Failed to load data');
        }

        const { walletData, queryIds } = data;
        console.log(`Loaded ${walletData.length} wallet(s) with matching queries`);

        // Main loop
        while (true) {
            const action = await mainMenu();
            
            if (action === "0") {
                console.log("Exiting program. Goodbye!");
                break;
            }

            if (["1", "2", "3"].includes(action)) {
                // Process wallets based on selected action
                await processWallets(action, queryIds, walletData, version, platform);
                
                // Post-action menu
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
if (require.main === module) {
    main();
}

// Export functions for testing/importing
module.exports = {
    getWalletAddressFromSeed,
    processWalletData,
    selectWalletVersion,
    mainMenu,
    loadData,
    processWallets,
    main
};
