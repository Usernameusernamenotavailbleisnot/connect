const axios = require('axios');
const { Address } = require('@ton/core');

class TsubasaService {
    constructor() {
        this.baseUrl = 'https://api.app.ton.tsubasa-rivals.com/api'; // Fixed URL
        this.headers = null;
        this.initData = null;
        this.wallet = null;
        this.masterHash = null;
    }

    async init(initData, wallet) {
        this.initData = initData;
        this.wallet = wallet;
        try {
            console.log('Initializing TsubasaService...');
            
            // Initialize basic headers first without master hash
            this.headers = this.initBasicHeaders();
            
            // Start session to get master hash
            const startResponse = await this.start(true);
            if (!startResponse || !startResponse.game_data) {
                throw new Error('Invalid start response');
            }

            // Update headers with master hash from response
            this.masterHash = startResponse.master_hash;
            if (this.masterHash) {
                this.headers = {
                    ...this.headers,
                    "X-Masterhash": this.masterHash // Note the case change here
                };
            }
            
            //console.log('Master hash obtained:', this.masterHash);
            return this;
        } catch (error) {
            console.error('Init error:', error.message);
            throw error;
        }
    }

    initBasicHeaders() {
        try {
            const userDataPart = this.initData.split('user=')[1];
            if (!userDataPart) {
                throw new Error('Invalid initData format - no user data found');
            }
            
            const userJson = decodeURIComponent(userDataPart.split('&')[0]);
            const userData = JSON.parse(userJson);

            if (!userData.id) {
                throw new Error('Invalid user data - no user ID found');
            }

            return {
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Content-Type": "application/json",
                "Origin": "https://app.ton.tsubasa-rivals.com",
                "Referer": "https://app.ton.tsubasa-rivals.com/",
                "Sec-Ch-Ua": '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99", "Microsoft Edge WebView2";v="130"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Windows"',
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
                "X-Player-Id": userData.id.toString()
            };
        } catch (error) {
            console.error('Header initialization error:', error);
            throw error;
        }
    }

    formatAddress(address) {
        try {
            const parsedAddress = Address.parse(address);
            return `0:${parsedAddress.hash.toString('hex')}`;
        } catch (error) {
            console.error('Address parsing error:', error);
            throw error;
        }
    }

    async start(isInitial = false) {
        try {
            //console.log('Making start request...');
            const response = await axios.post(
                `${this.baseUrl}/start`,
                {
                    lang_code: "en",
                    initData: this.initData
                },
                { 
                    headers: this.headers,
                    timeout: 10000
                }
            );

            if (!response.data.game_data) {
                console.error('Invalid start response:', response.data);
                return null;
            }

            // If not initial start and master hash changed, update it
            if (!isInitial && response.data.master_hash !== this.masterHash) {
                this.masterHash = response.data.master_hash;
                this.headers = {
                    ...this.headers,
                    "X-Masterhash": this.masterHash
                };
            }

            return response.data;
        } catch (error) {
            console.error('Start error:', error.message);
            return null;
        }
    }

    async connectWallet() {
        try {
            const startData = await this.start();
            if (!startData) {
                throw new Error('Failed to initialize session');
            }

            // Check if wallet is already connected
            const walletList = startData.user_wallet_list || [];
            const formattedAddress = this.formatAddress(this.wallet.address);
            
            if (walletList.some(w => w.address.toLowerCase() === formattedAddress.toLowerCase())) {
                console.log(`Wallet ${formattedAddress} is already connected!`);
                return true;
            }

            const response = await axios.post(
                `${this.baseUrl}/wallet/register`,
                {
                    address: formattedAddress,
                    wallet_name: "Tonkeeper",
                    task_id: 5,
                    initData: this.initData
                },
                { 
                    headers: this.headers,
                    timeout: 10000
                }
            );

            if (!response.data.success) {
                throw new Error('Wallet registration failed');
            }

            console.log('Wallet connected successfully');
            return true;
        } catch (error) {
            console.error('Connect wallet error:', error.message);
            return false;
        }
    }

    async disconnectWallet() {
        try {
            const startData = await this.start();
            if (!startData) {
                throw new Error('Failed to initialize session');
            }

            const formattedAddress = this.formatAddress(this.wallet.address);
            const walletList = startData.user_wallet_list || [];

            if (!walletList.some(w => w.address.toLowerCase() === formattedAddress.toLowerCase())) {
                console.log(`Wallet ${formattedAddress} is not connected!`);
                return true;
            }

            const response = await axios.post(
                `${this.baseUrl}/wallet/unregister`,
                {
                    task_id: 5,
                    initData: this.initData
                },
                { 
                    headers: this.headers,
                    timeout: 10000
                }
            );

            if (!response.data.success) {
                throw new Error('Wallet unregistration failed');
            }

            console.log('Wallet disconnected successfully');
            return true;
        } catch (error) {
            console.error('Disconnect wallet error:', error.message);
            return false;
        }
    }
}

module.exports = { TsubasaService };
